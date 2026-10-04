const Bundle = require('bare-bundle')
const { Duplex } = require('bare-stream')

const Console = require('bare-console')
const Refresh = require('bare-refresh')

const root = new URL('file:///app/')

const mounted = 'bare:/app.bundle'

const dialects = {
  commonjs: {
    extension: '.js',
    hot: 'refresh.hot(module)',
    refresh: `const refresh = require('bare-refresh')`,
    import: (name, specifier) => `const ${name} = require('${specifier}')`,
    export: (expression) => `module.exports = ${expression}`,
    read: (exports) => exports
  },

  esm: {
    extension: '.mjs',
    hot: 'refresh.hot(import.meta)',
    refresh: `import refresh from 'bare-refresh'`,
    import: (name, specifier) => `import ${name} from '${specifier}'`,
    export: (expression) => `export default ${expression}`,
    read: (exports) => exports.default
  }
}

exports.dialects = dialects

function source(dialect, name, spec) {
  const { imports = [], body = '', exports = 'null', prelude = '' } = spec

  const lines = [dialect.refresh]

  if (prelude) lines.push(prelude)

  for (const dependency of imports) {
    lines.push(dialect.import(dependency, './' + dependency + dialect.extension))
  }

  for (const specifier in spec.bare || {}) {
    lines.push(dialect.import(specifier, specifier))
  }

  lines.push(`refresh.data.ran.push('${name}')`)

  if (body) lines.push(typeof body === 'function' ? body(dialect) : body)

  lines.push(dialect.export(exports))

  return lines.join('\n') + '\n'
}

function write(dialect, bundle, modules) {
  for (const name of Object.keys(modules)) {
    const spec = modules[name]

    const key = 'file:///app/' + name + dialect.extension

    const resolutions = {
      ...(spec.resolutions ||
        Object.fromEntries((spec.imports || []).map((to) => ['./' + to + dialect.extension, to]))),
      ...spec.bare
    }

    const imports = {}

    for (const specifier in resolutions) {
      imports[specifier] = 'file:///app/' + resolutions[specifier] + dialect.extension
    }

    const carries = spec.resolved || spec.resolutions || spec.bare

    bundle.write(key, source(dialect, name, spec), { imports: carries ? imports : null })
  }

  return bundle
}

exports.fixture = function fixture(name) {
  const dialect = dialects[name]

  return {
    dialect: name,

    hot: dialect.hot,

    href(key) {
      return mounted + '/' + key + dialect.extension
    },

    key(name) {
      return '/' + name + dialect.extension
    },

    bundle(modules, opts = {}) {
      const { id = name, main = Object.keys(modules)[0] } = opts

      const bundle = new Bundle()

      bundle.id = id
      bundle.main = 'file:///app/' + main + dialect.extension

      return write(dialect, bundle, modules).unmount(root)
    },

    host(modules, opts = {}) {
      const refresh = new Refresh(this.bundle(modules, opts), { protocol: module.protocol })

      refresh.data.ran = []

      return refresh
    },

    patch(modules, opts = {}) {
      const { id = name + '-patched', removed = [] } = opts

      const bundle = new Bundle()

      bundle.id = id

      return { changed: write(dialect, bundle, modules).unmount(root).toBuffer(), removed }
    },

    read(exports) {
      return dialect.read(exports)
    },

    value(refresh) {
      return dialect.read(refresh.graph.exports)
    }
  }
}

exports.ran = function ran(refresh) {
  const names = refresh.data.ran

  refresh.data.ran = []

  return names
}

exports.pair = function pair() {
  const a = new Duplex({
    write(data, encoding, cb) {
      b.push(data)
      cb(null)
    },
    read() {}
  })

  const b = new Duplex({
    write(data, encoding, cb) {
      a.push(data)
      cb(null)
    },
    read() {}
  })

  return [a, b]
}

exports.recorder = function recorder() {
  const lines = []

  const log = {}

  for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
    log[level] = (...data) => lines.push([level, data.join(' ')])
  }

  log.clear = () => {}

  return { console: new Console(log), lines }
}
