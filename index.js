const EventEmitter = require('bare-events')
const Bundle = require('bare-bundle')
const Module = require('bare-module')
const RPC = require('bare-rpc')
const cenc = require('compact-encoding')
const { VERSION, command, intact, phase } = require('./lib/constants')
const delta = require('./lib/delta')
const messages = require('./lib/messages')
const propagate = require('./lib/propagate')

const reported = Symbol('bare.refresh.reported')

module.exports = exports = class Refresh extends EventEmitter {
  constructor(bundle, opts = {}) {
    super()

    const { protocol = null, builtins = null, entry = 'bare:/app.bundle' } = opts

    this._bundle = toBundle(bundle)
    this._protocol = protocol
    this._builtins = builtins
    this._entry = new URL(entry)
    this._data = {}
    this._graph = null
    this._loader = null
    this._main = null
    this._rpc = null
    this._generation = 0
    this._starting = null
    this._reports = []
    this._flushing = false
    this._pending = null
    this._disposers = []
    this._handlers = new Map()

    // Plugins added by a graph go with it, as what they know belongs to that
    // graph.
    this._plugins = new Set()
    this._graphPlugins = new Set()
  }

  get data() {
    return this._data
  }

  get generation() {
    return this._generation
  }

  get id() {
    return this._bundle.id
  }

  get graph() {
    return this._graph
  }

  get running() {
    return this._graph !== null
  }

  use(plugin) {
    this._plugins.add(plugin)

    return this
  }

  start() {
    if (this._graph !== null) return Promise.resolve(this._graph)

    if (this._starting === null) {
      this._starting = this._run().finally(() => {
        this._starting = null
      })
    }

    return this._starting
  }

  // The old graph is disposed before the new one is built, so that what it
  // leaves on `data` is there for the new one to read.
  async reload() {
    const disposers = this._disposers

    this._disposers = []
    this._graph = null

    for (const dispose of disposers) {
      try {
        dispose()
      } catch (err) {
        this._fail(err, phase.DISPOSE)
      }
    }

    const graph = await this._run()

    this.emit('reload', this._generation)

    return graph
  }

  connect(stream) {
    this._rpc = new RPC(stream, (req) => this._onrequest(req))

    this._rpc
      .request(command.HELLO)
      .send(cenc.encode(messages.hello, { version: VERSION, id: this._bundle.id }))

    if (this._reports.length > 0) this._flush()

    return this._rpc
  }

  report(err, where = phase.TRANSPORT, href = null) {
    return this._fail(err, where, href)
  }

  async update(message) {
    const changed = toBundle(message.changed)
    const { removed } = message

    this._bundle = delta.apply(this._bundle, { changed, removed })

    if (this._loader === null || removed.length > 0) return this.reload()

    // Modules taken out by a refresh that failed are not new.
    const known = new Set(Object.keys(this._loader.cache))

    if (this._pending !== null) for (const href of this._pending.invalidated) known.add(href)

    const patched = this._loader.patch(this._mount(changed)).map((url) => url.href)

    // A new module has no importers yet, which propagation would read as
    // having reached the top.
    const changes = patched.filter((href) => known.has(href))

    const importers = this._importers()

    const result = this._retrying(
      propagate(changes, (href) => importers.get(href) || [], this._answers()),
      changes
    )

    if (result === null) return this.reload()

    await this._accept(result, patched)

    this.emit('refresh', result.invalidated.size)

    return this._graph
  }

  async _run() {
    const generation = this._generation
    const previous = this._loader

    this._disposers = []
    this._handlers = new Map()
    this._graphPlugins = new Set()
    this._pending = null

    // Incremented first, so that the graph reads its own generation.
    this._generation++

    try {
      const loader = new Module.Loader({
        protocol: this._protocol,
        builtins: { ...this._builtins, 'bare-refresh': this._exports() },
        imports: this._bundle.imports
      })

      const mounted = this._mount(this._bundle)

      loader.patch(mounted)

      const main = new URL(mounted.main)

      // Set before the graph runs, as `accept` resolves its specifiers through
      // the loader during evaluation.
      this._loader = loader

      await loader.import(main)

      this._main = main
      this._graph = loader.get(main)

      this._evaluated(Object.keys(loader.cache))

      return this._graph
    } catch (err) {
      this._disposers = []
      this._handlers = new Map()
      this._generation = generation
      this._loader = previous

      this._fail(err, phase.EVALUATE)

      throw err
    }
  }

  _mount(bundle) {
    return bundle.mount(this._entry.href + '/')
  }

  *_speaking() {
    yield* this._plugins
    yield* this._graphPlugins
  }

  _fail(err, where, href = null) {
    const object = typeof err === 'object' && err !== null

    // An error is caught more than once on its way out, but is reported once.
    if (object && err[reported] !== undefined) return err[reported]

    const { name, message, stack = null, code } = object ? err : {}

    const report = {
      phase: where,
      href: this._unmount(where === phase.EVALUATE ? this._culprit(stack) || href : href),
      generation: this._generation,
      intact: intact[where] !== false,
      name: name || 'Error',
      message: message || String(err),
      stack: this._unmount(stack),
      code: code || null
    }

    if (object) err[reported] = report

    // An emitter throws an `error` that nobody listens for.
    if (this.listenerCount('error') > 0) this.emit('error', err, report)

    for (const plugin of this._speaking()) {
      if (plugin.failed === undefined) continue

      try {
        plugin.failed(err, report)
      } catch {
        continue
      }
    }

    this._reports.push(report)

    // Sent later, so that a failure while an update is handled is not a
    // request made before that update has been replied to.
    if (this._rpc !== null && !this._flushing) {
      this._flushing = true

      setTimeout(() => this._flush(), 0)
    }

    return report
  }

  _flush() {
    this._flushing = false

    const reports = this._reports

    this._reports = []

    for (const report of reports) {
      try {
        this._rpc.request(command.REPORT).send(cenc.encode(messages.report, report))
      } catch {
        continue
      }
    }
  }

  // The module that threw, which is the first module of the graph in the
  // stack rather than the one that was imported.
  _culprit(stack) {
    if (stack === null) return null

    const found = stack.match(new RegExp(escape(this._entry.href + '/') + '[^\\s:)]+'))

    return found === null ? null : found[0]
  }

  _unmount(text) {
    if (text === null) return null

    return text.split(this._entry.href).join('')
  }

  _exports() {
    const refresh = this

    return {
      get data() {
        return refresh._data
      },

      get generation() {
        return refresh._generation
      },

      dispose(fn) {
        refresh._disposers.push(fn)
      },

      hot(from) {
        return refresh._hot(new URL(from.url).href)
      },

      use(plugin) {
        refresh._graphPlugins.add(plugin)
      },

      report(err, opts = {}) {
        const { phase: where = phase.RUNTIME, href = null } = opts

        return refresh._fail(err, where, href)
      },

      reload() {
        return refresh.reload()
      }
    }
  }

  _hot(href) {
    let handler = this._handlers.get(href)

    if (handler === undefined) {
      handler = { self: false, deps: new Map(), disposers: [], data: {} }

      this._handlers.set(href, handler)
    }

    const refresh = this

    return {
      get data() {
        return handler.data
      },

      accept(specifiers, onchange) {
        if (typeof specifiers === 'function') {
          onchange = specifiers
          specifiers = null
        }

        if (specifiers === undefined || specifiers === null) {
          handler.self = true

          return
        }

        if (typeof specifiers === 'string') specifiers = [specifiers]

        for (const specifier of specifiers) {
          const resolved = refresh._resolve(href, specifier)

          if (resolved === null) {
            throw new Error(`Cannot accept '${specifier}', which '${href}' does not import`)
          }

          handler.deps.set(resolved, onchange || null)
        }
      },

      dispose(fn) {
        handler.disposers.push(fn)
      },

      invalidate() {
        handler.self = false
        handler.deps.clear()
      }
    }
  }

  _resolve(href, specifier) {
    const entry = this._resolutions(href)[href]?.[specifier]

    if (entry === undefined) return null

    for (const target of targets(entry)) return target

    return null
  }

  // Every record carries the same resolutions. While the graph is still being
  // built, the module asking is the one record known to exist.
  _resolutions(href = null) {
    if (this._graph !== null) return this._graph.resolutions

    if (this._loader === null || href === null) return {}

    const record = this._loader.get(new URL(href))

    return record === null ? {} : record.resolutions
  }

  async _onrequest(req) {
    if (req.command !== command.UPDATE) return req.reply()

    try {
      await this.update(cenc.decode(messages.update, req.data))
    } catch (err) {
      this._fail(err, phase.EVALUATE)
    }

    req.reply()
  }

  // What a refresh that failed took apart is folded into the next one, so
  // that the edit fixing it finds its way back to the modules that accept it.
  _retrying(result, changes) {
    const pending = this._pending

    if (pending === null) return result

    const invalidated = new Set([...pending.invalidated, ...changes])
    const roots = [...pending.roots]
    const accepted = [...pending.accepted]

    if (result !== null) {
      for (const href of result.invalidated) invalidated.add(href)
      for (const href of result.roots) if (!roots.includes(href)) roots.push(href)

      for (const entry of result.accepted) {
        if (!accepted.some((was) => was.href === entry.href && was.dep === entry.dep)) {
          accepted.push(entry)
        }
      }
    }

    return { invalidated, accepted, roots }
  }

  // A module's own handler takes precedence over the plugins.
  _answers() {
    const handlers = this._handlers
    const plugins = [...this._speaking()]

    return {
      get(href) {
        const handler = handlers.get(href)

        if (handler !== undefined && (handler.self || handler.deps.size > 0)) return handler

        for (const plugin of plugins) {
          if (plugin.accepts !== undefined && plugin.accepts(href)) {
            return { ...handler, self: true, deps: new Map() }
          }
        }

        return handler
      }
    }
  }

  _evaluated(hrefs) {
    for (const plugin of this._speaking()) {
      if (plugin.evaluated === undefined) continue

      for (const href of hrefs) {
        const record = this._loader.get(new URL(href))

        if (record === null) continue

        try {
          plugin.evaluated(href, record.exports)
        } catch (err) {
          this._fail(err, phase.PLUGIN, href)
        }
      }
    }
  }

  _settled(hrefs) {
    for (const plugin of this._speaking()) {
      if (plugin.settled === undefined) continue

      try {
        plugin.settled(hrefs)
      } catch (err) {
        this._fail(err, phase.PLUGIN)
      }
    }
  }

  _importers() {
    const importers = new Map()
    const resolutions = this._resolutions()

    for (const from in resolutions) {
      for (const specifier in resolutions[from]) {
        for (const to of targets(resolutions[from][specifier])) {
          const above = importers.get(to)

          if (above === undefined) importers.set(to, [from])
          else if (!above.includes(from)) above.push(from)
        }
      }
    }

    return importers
  }

  async _accept({ invalidated, accepted, roots }, patched) {
    // Compiled before anything is disposed or evicted, so that a syntax error
    // leaves the running graph as it was.
    for (const href of patched) {
      try {
        await this._loader.instantiate(href)
      } catch (err) {
        this._fail(err, phase.COMPILE, href)

        throw err
      }
    }

    for (const href of invalidated) {
      const handler = this._handlers.get(href)

      if (handler === undefined) continue

      for (const dispose of handler.disposers) {
        try {
          dispose(handler.data)
        } catch (err) {
          this._fail(err, phase.DISPOSE, href)
        }
      }
    }

    // The patched modules were already evicted by the patch, and evicting
    // them again would drop the resolutions the delta carried.
    const fresh = new Set(patched)

    this._loader.evict([...invalidated].filter((href) => !fresh.has(href)))

    for (const href of invalidated) {
      const handler = this._handlers.get(href)

      if (handler === undefined) continue

      handler.self = false
      handler.deps = new Map()
      handler.disposers = []
    }

    this._pending = { invalidated, accepted, roots }

    for (const href of roots) {
      try {
        await this._loader.import(new URL(href))
      } catch (err) {
        this._fail(err, phase.EVALUATE, href)

        throw err
      }
    }

    for (const { href, dep } of accepted) {
      let exports

      try {
        exports = await this._loader.import(new URL(dep))
      } catch (err) {
        this._fail(err, phase.EVALUATE, dep)

        throw err
      }

      const onchange = this._handlers.get(href)?.deps.get(dep)

      if (onchange === undefined || onchange === null) continue

      try {
        onchange(exports)
      } catch (err) {
        this._fail(err, phase.ACCEPT, href)
      }
    }

    this._pending = null
    this._graph = this._loader.get(this._main)

    const hrefs = [...invalidated]

    this._evaluated(hrefs)
    this._settled(hrefs)
  }
}

exports.constants = require('./lib/constants')
exports.delta = delta
exports.data = {}
exports.generation = 0

exports.dispose = function dispose() {}

exports.use = function use() {}

exports.report = function report() {
  return null
}

exports.hot = function hot() {
  return {
    data: {},
    accept() {},
    dispose() {},
    invalidate() {}
  }
}

exports.reload = function reload() {
  return Promise.resolve(null)
}

function* targets(entry) {
  if (typeof entry === 'string') {
    yield entry
  } else if (entry !== null && typeof entry === 'object') {
    for (const condition in entry) yield* targets(entry[condition])
  }
}

function toBundle(bundle) {
  return Bundle.isBundle(bundle) ? bundle : Bundle.from(bundle)
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
