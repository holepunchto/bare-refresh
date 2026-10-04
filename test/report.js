const test = require('brittle')

const RefreshServer = require('bare-refresh/server')
const { phase } = require('bare-refresh/constants')
const { dialects, fixture, pair } = require('./helpers')

function settled() {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

for (const name of Object.keys(dialects)) {
  const f = fixture(name)

  const { hot } = dialects[name]

  const graph = {
    a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
    b: { exports: '1' }
  }

  function reports(refresh) {
    const seen = []

    refresh.on('error', (err, report) => seen.push(report))

    return seen
  }

  test(`${name}: a source that will not compile is reported as compiling`, async (t) => {
    const refresh = f.host(graph)

    const seen = reports(refresh)

    await refresh.start()

    await t.exception.all(refresh.update(f.patch({ b: { body: 'const =' } })))

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.COMPILE)
    t.is(seen[0].href, f.key('b'), 'naming the module that would not')
    t.is(seen[0].intact, true, 'and saying the application is still running')
    t.is(seen[0].name, 'SyntaxError')
  })

  test(`${name}: a module that throws is reported as evaluating`, async (t) => {
    const refresh = f.host(graph)

    const seen = reports(refresh)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    t.is(seen.length, 1, 'once, although it is caught more than once on the way out')
    t.is(seen[0].phase, phase.EVALUATE)
    t.is(seen[0].message, 'no')
    t.is(seen[0].intact, false, 'and the graph is not what it was')
  })

  test(`${name}: a module that throws something other than an error is reported`, async (t) => {
    const refresh = f.host(graph)

    const seen = reports(refresh)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: 'throw undefined' } })))

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.EVALUATE)
    t.is(seen[0].name, 'Error')
    t.is(seen[0].message, 'undefined')
    t.is(seen[0].stack, null)
  })

  test(`${name}: a disposer that throws is reported without stopping the refresh`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { body: `${hot}.dispose(() => { throw new Error('holding on') })`, exports: '1' }
    })

    const seen = reports(refresh)

    await refresh.start()

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.DISPOSE)
    t.is(seen[0].href, f.key('b'))
    t.is(f.value(refresh), 2, 'and the refresh happened anyway')
  })

  test(`${name}: a callback given to accept is reported as accepting`, async (t) => {
    const refresh = f.host({
      a: {
        imports: ['b'],
        body: `${hot}.accept(['./b${dialects[name].extension}'], () => { throw new Error('nope') })`,
        exports: 'b'
      },
      b: { exports: '1' }
    })

    const seen = reports(refresh)

    await refresh.start()

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.ACCEPT)
    t.is(seen[0].href, f.key('a'), 'naming the module that asked to be told')
  })

  test(`${name}: a plugin that throws is reported as the plugin's`, async (t) => {
    const refresh = f.host(graph)

    const seen = reports(refresh)

    refresh.use({
      settled() {
        throw new Error('plugin')
      }
    })

    await refresh.start()

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.PLUGIN)
    t.is(f.value(refresh), 2, 'and the graph is none of its business')
  })

  test(`${name}: a plugin is told what went wrong`, async (t) => {
    const refresh = f.host(graph)

    refresh.on('error', () => {})

    const told = []

    refresh.use({
      failed(err, report) {
        told.push([err.message, report.phase, report.href])
      }
    })

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    t.alike(
      told,
      [['no', phase.EVALUATE, f.key('b')]],
      'which is how a framework puts it where it belongs'
    )
  })

  test(`${name}: a stack says where the bundle holds a module, not where the host put it`, async (t) => {
    const refresh = f.host(graph)

    const seen = reports(refresh)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    t.absent(seen[0].stack.includes('bare:/app.bundle'), 'so the other end can say where it is')
    t.ok(seen[0].stack.includes(f.key('b')), 'and it still says which module')
  })

  test(`${name}: what went wrong reaches the other end`, async (t) => {
    const refresh = f.host(graph)

    refresh.on('error', () => {})

    let packed = f.bundle(graph)

    const server = new RefreshServer(() => packed)

    const seen = []

    server.on('report', (report) => seen.push(report))

    await refresh.start()

    const [x, y] = pair()

    server.connect(x)
    refresh.connect(y)

    packed = f.bundle({ ...graph, b: { body: `throw new Error('no')` } }, { id: 'broken' })

    await server.update()

    // A report is sent a turn after the update it came out of.
    await settled()

    t.is(seen.length, 1)
    t.is(seen[0].phase, phase.EVALUATE)
    t.is(seen[0].message, 'no')
    t.is(seen[0].href, f.key('b'))
    t.is(seen[0].intact, false)
  })

  test(`${name}: a graph that never came up is reported once there is somewhere to say it`, async (t) => {
    const broken = { a: { body: `throw new Error('at once')` } }

    const refresh = f.host(broken)

    refresh.on('error', () => {})

    const server = new RefreshServer(() => f.bundle(broken))

    const seen = []

    server.on('report', (report) => seen.push(report))

    await t.exception(refresh.start(), /at once/)

    const [x, y] = pair()

    server.connect(x)
    refresh.connect(y)

    await settled()

    t.is(seen.length, 1, 'which is the failure most worth hearing about')
    t.is(seen[0].message, 'at once')
  })
}

test('an application reports what it caught itself', async (t) => {
  const f = fixture('commonjs')

  const refresh = f.host({
    a: { body: `refresh.report(new Error('a boundary caught this'))`, exports: '1' }
  })

  const seen = []

  refresh.on('error', (err, report) => seen.push(report))

  await refresh.start()

  t.is(seen.length, 1)
  t.is(seen[0].phase, phase.RUNTIME)
  t.is(seen[0].message, 'a boundary caught this')
  t.is(seen[0].intact, true, 'because nothing about the graph went wrong')
})
