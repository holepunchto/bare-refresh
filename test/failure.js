const test = require('brittle')

const RefreshServer = require('bare-refresh/server')
const { dialects, fixture, pair, ran } = require('./helpers')

for (const name of Object.keys(dialects)) {
  const f = fixture(name)

  const { hot } = dialects[name]

  const graph = {
    a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
    b: { exports: '1' }
  }

  test(`${name}: a module that throws while being read again half applies the refresh`, async (t) => {
    const refresh = f.host(graph)

    await refresh.start()

    ran(refresh)

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    t.alike(ran(refresh), ['b'], 'the module that threw is the last thing that ran')
    t.is(refresh.running, true, 'the host still says it is running')
    t.is(f.value(refresh), 1, 'but the graph it answers with is the one it just took apart')
    t.is(refresh.generation, 1, 'and nothing was rebuilt')
  })

  test(`${name}: a syntax error leaves the graph exactly as it was`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { body: `${hot}.dispose(() => { refresh.data.gone = true })`, exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await t.exception.all(refresh.update(f.patch({ b: { body: 'const =' } })), /Unexpected token/)

    t.alike(ran(refresh), [], 'nothing ran at all')
    t.absent(refresh.data.gone, 'and nothing was told to let go')
    t.is(refresh.running, true)
    t.is(f.value(refresh), 1)
  })

  test(`${name}: the good edit after a syntax error is an ordinary refresh`, async (t) => {
    const refresh = f.host(graph)

    await refresh.start()

    await t.exception.all(refresh.update(f.patch({ b: { body: 'const =' } })), /Unexpected token/)

    ran(refresh)

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(refresh.generation, 1, 'the graph was never rebuilt')
    t.is(f.value(refresh), 2, 'and a typo cost nothing')
    t.alike(ran(refresh), ['b', 'a'])
  })

  test(`${name}: the good edit after a throw is an ordinary refresh`, async (t) => {
    const refresh = f.host(graph)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    ran(refresh)

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(refresh.generation, 1, 'the graph was never built again')
    t.is(f.value(refresh), 2, 'and the mistake cost nothing but the time to fix it')
    t.alike(ran(refresh), ['b', 'a'])
  })

  test(`${name}: a throw after a throw is still one thing to fix`, async (t) => {
    const refresh = f.host(graph)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('one')` } })), /one/)
    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('two')` } })), /two/)

    ran(refresh)

    await refresh.update(f.patch({ b: { exports: '3' } }))

    t.is(refresh.generation, 1)
    t.is(f.value(refresh), 3)
    t.alike(ran(refresh), ['b', 'a'])
  })

  test(`${name}: what a throw left is not carried into the graph that replaces it`, async (t) => {
    const refresh = f.host(graph)

    await refresh.start()

    await t.exception(refresh.update(f.patch({ b: { body: `throw new Error('no')` } })), /no/)

    await t.exception(refresh.reload(), /no/)

    await refresh.update(f.patch({ b: { exports: '2' } }))

    t.is(refresh.generation, 2, 'the edit that fixes it builds a new graph')
    t.is(f.value(refresh), 2)
  })

  test(`${name}: an update that throws is reported rather than thrown at the transport`, async (t) => {
    const refresh = f.host(graph)

    let packed = f.bundle(graph)

    const server = new RefreshServer(() => packed)

    const errors = []

    refresh.on('error', (err) => errors.push(err.message))

    await refresh.start()

    const [x, y] = pair()

    server.connect(x)
    refresh.connect(y)

    packed = f.bundle({ ...graph, b: { body: `throw new Error('no')` } }, { id: 'broken' })

    await server.update()

    t.alike(errors, ['no'], 'the host reported it')
    t.is(refresh.running, true, 'and is still there to be told about the next edit')
  })
}
