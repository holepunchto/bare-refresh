const test = require('brittle')
const Bundle = require('bare-bundle')

const Refresh = require('bare-refresh')
const RefreshServer = require('bare-refresh/server')
const boot = require('bare-refresh/boot')
const delta = require('bare-refresh/delta')
const { pair } = require('./test/helpers')

const root = new URL('file:///app/')

function app(count) {
  const bundle = new Bundle()

  bundle.id = 'app-' + count
  bundle.main = 'file:///app/index.js'

  bundle.write(
    'file:///app/index.js',
    `const refresh = require('bare-refresh/hot')\n` +
      `refresh.data.runs = (refresh.data.runs || 0) + 1\n` +
      `module.exports = ${count}\n`
  )

  return bundle.unmount(root)
}

test('a delta carries only what changed', (t) => {
  const from = app(1)
  const to = app(2)

  to.write('/extra.js', 'module.exports = true\n')

  const { changed, removed } = delta.diff(from, to)

  t.alike(Array.from(changed.keys()).sort(), ['/extra.js', '/index.js'])
  t.alike(removed, [])
})

test('a delta reports what went away', (t) => {
  const from = app(1)

  from.write('/gone.js', 'module.exports = true\n')

  const { changed, removed } = delta.diff(from, app(1))

  t.alike(Array.from(changed.keys()), [])
  t.alike(removed, ['/gone.js'])
})

test('applying a delta reproduces the bundle it was taken from', (t) => {
  const from = app(1)

  from.write('/gone.js', 'module.exports = true\n')

  const to = app(2)

  to.write('/extra.js', 'module.exports = true\n')

  const applied = delta.apply(from, delta.diff(from, to))

  t.is(applied.id, to.id)
  t.is(applied.main, to.main)
  t.alike(Array.from(applied.keys()).sort(), Array.from(to.keys()).sort())

  for (const key of to.keys()) {
    t.alike(applied.read(key), to.read(key), key)
  }
})

test('a refresh runs the application it was given', async (t) => {
  const refresh = new Refresh(app(1), { protocol: module.protocol })

  const graph = await refresh.start()

  t.is(graph.exports, 1)
  t.is(refresh.generation, 1)
  t.is(refresh.data.runs, 1)
})

test('a reload builds a new graph and keeps the data', async (t) => {
  const refresh = new Refresh(app(1), { protocol: module.protocol })

  await refresh.start()

  const graph = await refresh.reload()

  t.is(graph.exports, 1)
  t.is(refresh.generation, 2)
  t.is(refresh.data.runs, 2, 'the data outlives the graph that wrote it')
})

test('an update from a server reloads the application', async (t) => {
  t.plan(4)

  let count = 1

  const server = new RefreshServer(() => app(count))
  const refresh = new Refresh(app(count), { protocol: module.protocol })

  await refresh.start()

  t.is(refresh.graph.exports, 1)

  const [a, b] = pair()

  server.connect(a)
  refresh.connect(b)

  refresh.on('reload', () => {
    t.is(refresh.graph.exports, 2, 'the new source is what runs')
    t.is(refresh.id, 'app-2', 'and the bundle is the one the server packed')
    t.is(refresh.data.runs, 2, 'and the data came across')
  })

  count = 2

  await server.update()
})

test('a reload tells the graph it replaces to let go', async (t) => {
  t.plan(3)

  const bundle = new Bundle()

  bundle.id = 'disposing'
  bundle.main = 'file:///app/index.js'
  bundle.write(
    'file:///app/index.js',
    `const refresh = require('bare-refresh/hot')\n` +
      `const generation = refresh.generation\n` +
      `refresh.dispose(() => refresh.data.disposed.push(generation))\n`
  )

  const refresh = new Refresh(bundle.unmount(root), { protocol: module.protocol })

  refresh.data.disposed = []

  await refresh.start()

  t.alike(refresh.data.disposed, [], 'nothing is disposed while it is the only graph')

  await refresh.reload()

  t.alike(refresh.data.disposed, [1], 'the graph that was replaced let go')

  await refresh.reload()

  t.alike(refresh.data.disposed, [1, 2], 'and so did the one after it')
})

test('what a graph hands forward is there for the one that replaces it', async (t) => {
  const bundle = new Bundle()

  bundle.id = 'handing-over'
  bundle.main = 'file:///app/index.js'
  bundle.write(
    'file:///app/index.js',
    `const refresh = require('bare-refresh/hot')\n` +
      `module.exports = refresh.data.carried || null\n` +
      `refresh.dispose(() => { refresh.data.carried = refresh.generation })\n`
  )

  const refresh = new Refresh(bundle.unmount(root), { protocol: module.protocol })

  const first = await refresh.start()

  t.is(first.exports, null, 'the first graph is handed nothing')

  const second = await refresh.reload()

  t.is(second.exports, 1, 'the second picks up what the first left')

  const third = await refresh.reload()

  t.is(third.exports, 2, 'and so on')
})

test('a graph that throws disposes nothing', async (t) => {
  const bundle = new Bundle()

  bundle.id = 'throwing'
  bundle.main = 'file:///app/index.js'
  bundle.write(
    'file:///app/index.js',
    `const refresh = require('bare-refresh/hot')\n` +
      `if (refresh.generation > 1) {\n` +
      `  refresh.dispose(() => refresh.data.disposed.push('never'))\n` +
      `  throw new Error('no')\n` +
      `}\n`
  )

  const refresh = new Refresh(bundle.unmount(root), { protocol: module.protocol })

  refresh.data.disposed = []

  await refresh.start()

  await t.exception(refresh.reload(), /no/)

  t.alike(refresh.data.disposed, [], 'the graph that never ran was not asked to let go')
  t.is(refresh.generation, 1, 'and the count did not move')
  t.is(refresh.running, false, 'but nothing is running, because the old graph let go first')
})

test('starting twice before the first is done builds one graph', async (t) => {
  const refresh = new Refresh(app(1), { protocol: module.protocol })

  const [one, two] = await Promise.all([refresh.start(), refresh.start()])

  t.is(refresh.data.runs, 1, 'the application ran once')
  t.is(refresh.generation, 1)
  t.is(one, two, 'and both callers were given it')
})

test('boot runs the application and hands it the transport', async (t) => {
  let count = 1

  const server = new RefreshServer(() => app(count))

  const [a, b] = pair()

  server.connect(a)

  const refresh = boot(app(1), { connect: () => b, protocol: module.protocol })

  await new Promise((resolve) => server.once('connection', resolve))

  t.is(refresh.generation, 1, 'the application is running')

  const reloaded = new Promise((resolve) => refresh.once('reload', resolve))

  count = 2

  await server.update()
  await reloaded

  t.is(refresh.graph.exports, 2, 'and an edit reaches it')
})

test('the dormant surface answers without a host', (t) => {
  const refresh = require('bare-refresh/hot')

  t.is(refresh.generation, 0, 'which is how an application tells a development build from one')
  t.alike(refresh.data, {})

  const hot = refresh.hot(module)

  t.alike(hot.data, {}, 'and what a module keeps is kept nowhere')
  t.execution(() => {
    refresh.dispose(() => {})
    refresh.use({})
    hot.accept()
    hot.dispose(() => {})
    hot.invalidate()
  })
})

test('a client that has gone does not hold up an update', async (t) => {
  const server = new RefreshServer(() => app(1))

  const [a, b] = pair()

  server.connect(a)

  b.resume()

  a.push(null)

  await t.execution(server.update(), 'the update finishes anyway')

  t.is(server.clients, 0, 'and the client is let go')
})

require('./test/propagate')
require('./test/patch')
require('./test/failure')
require('./test/plugin')
require('./test/server')
require('./test/report')
