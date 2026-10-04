const test = require('brittle')

const propagate = require('bare-refresh/propagate')
const { dialects, fixture, ran } = require('./helpers')

const chain = {
  a: { imports: ['b'], exports: 'b' },
  b: { imports: ['c'], exports: 'c' },
  c: { exports: '1' }
}

function accepting(body) {
  return { ...chain, a: { ...chain.a, body } }
}

for (const name of Object.keys(dialects)) {
  const f = fixture(name)

  const { hot } = dialects[name]

  test(`${name}: a change nobody accepts rebuilds the graph`, async (t) => {
    const refresh = f.host(chain)

    await refresh.start()

    t.is(f.value(refresh), 1)
    t.is(refresh.generation, 1)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(f.value(refresh), 2)
    t.is(refresh.generation, 2, 'the whole graph was built again')
  })

  test(`${name}: an entry that accepts is refreshed rather than rebuilt`, async (t) => {
    const refresh = f.host(accepting(`${hot}.accept()`))

    await refresh.start()

    t.is(f.value(refresh), 1)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(f.value(refresh), 2, 'the new source is what runs')
    t.is(refresh.generation, 1, 'and the graph was never rebuilt')
  })

  test(`${name}: a module keeps its own data across being read again`, async (t) => {
    const body =
      `const hot = ${hot}\n` +
      `hot.data.runs = (hot.data.runs || 0) + 1\n` +
      `refresh.data.runs = hot.data.runs\n` +
      `hot.accept()\n`

    const refresh = f.host(accepting(body))

    await refresh.start()

    t.is(refresh.data.runs, 1)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.data.runs, 2)
    t.is(refresh.generation, 1)
  })

  test(`${name}: everything up to the boundary runs again, and nothing else`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b', 'd'], body: `${hot}.accept()`, exports: 'b + d' },
      b: { imports: ['c'], exports: 'c' },
      c: { exports: '1' },
      d: { exports: '10' }
    })

    await refresh.start()

    t.alike(ran(refresh), ['c', 'b', 'd', 'a'])
    t.is(f.value(refresh), 11)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(ran(refresh), ['c', 'b', 'a'], 'the sibling below the boundary was left alone')
    t.is(f.value(refresh), 12)
    t.is(refresh.generation, 1)
  })

  test(`${name}: a change four deep runs every module above it up to the boundary`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { imports: ['c'], exports: 'c' },
      c: { imports: ['d'], exports: 'd' },
      d: { exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(f.patch({ d: { exports: '2' } }))

    t.alike(ran(refresh), ['d', 'c', 'b', 'a'])
    t.is(f.value(refresh), 2)
    t.is(refresh.generation, 1)
  })

  test(`${name}: a diamond runs the module both sides import exactly once`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b', 'c'], body: `${hot}.accept()`, exports: 'b + c' },
      b: { imports: ['d'], exports: 'd' },
      c: { imports: ['d'], exports: 'd * 10' },
      d: { exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(f.patch({ d: { exports: '2' } }))

    t.alike(ran(refresh), ['d', 'b', 'c', 'a'], 'the module below the fork ran once')
    t.is(f.value(refresh), 22)
  })

  test(`${name}: an importer that named a dependency is handed it rather than run again`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], exports: 'b' },
      b: {
        imports: ['c'],
        body: ({ hot, extension }) =>
          `${hot}.accept(['./c${extension}'], (c) => { refresh.data.handed = c })`,
        exports: 'c'
      },
      c: { exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(ran(refresh), ['c'], 'only the dependency ran')
    t.is(f.read(refresh.data.handed), 2, 'and the importer was handed what it now exports')

    t.is(typeof refresh.data.handed, name === 'esm' ? 'object' : 'number')

    t.is(f.value(refresh), 1, 'while the graph above it still holds what it captured')
    t.is(refresh.generation, 1)
  })

  test(`${name}: a module that accepts and then changes its mind is not asked to cope`, async (t) => {
    const body = `const hot = ${hot}\nhot.accept()\nhot.invalidate()\n`

    const refresh = f.host(accepting(body))

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.generation, 2, 'nothing accepted, so the graph was built again')
  })

  test(`${name}: a disposer is handed what the module kept`, async (t) => {
    const body =
      `const hot = ${hot}\n` +
      `hot.data.runs = (hot.data.runs || 0) + 1\n` +
      `hot.dispose((data) => { refresh.data.handed = data.runs })\n` +
      `hot.accept()\n`

    const refresh = f.host({ ...chain, c: { ...chain.c, body } })

    await refresh.start()

    t.is(refresh.data.handed, undefined, 'nothing has let go yet')

    await refresh.update(f.patch({ c: { ...chain.c, body, exports: '2' } }))

    t.is(refresh.data.handed, 1, 'the run that was replaced saw what it had kept')
    t.is(refresh.generation, 1)
  })

  test(`${name}: disposers run deepest first and a throwing one does not stop the rest`, async (t) => {
    const dispose = (name) =>
      `${hot}.dispose(() => refresh.data.disposed.push('${name}'))\n` +
      `${hot}.dispose(() => { throw new Error('${name} would not let go') })\n`

    const refresh = f.host({
      a: { imports: ['b'], body: dispose('a') + `${hot}.accept()`, exports: 'b' },
      b: { imports: ['c'], body: dispose('b'), exports: 'c' },
      c: { body: dispose('c'), exports: '1' }
    })

    const errors = []

    refresh.on('error', (err) => errors.push(err.message))

    refresh.data.disposed = []

    await refresh.start()

    await refresh.update(f.patch({ c: { body: dispose('c'), exports: '2' } }))

    t.alike(refresh.data.disposed, ['c', 'b', 'a'], 'the deepest module let go first')
    t.alike(errors, ['c would not let go', 'b would not let go', 'a would not let go'])
  })

  test(`${name}: a module that goes away rebuilds the graph`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { exports: '1' }
    })

    await refresh.start()

    await refresh.update(
      f.patch({ a: { body: `${hot}.accept()`, exports: '2' } }, { removed: [f.key('b')] })
    )

    t.is(refresh.generation, 2, 'there was nothing left to read again')
    t.is(f.value(refresh), 2)
  })
}

const importers = (href) => ({ c: ['b'], b: ['a'], a: [] })[href]

test('propagation stops at whoever accepts', (t) => {
  const handlers = new Map([['a', { self: true, deps: new Map() }]])

  const { invalidated, accepted, roots } = propagate(['c'], importers, handlers)

  t.alike([...invalidated].sort(), ['a', 'b', 'c'])
  t.alike(accepted, [])
  t.alike(roots, ['a'], 'and says where the reading starts')
})

test('propagation gives up when it reaches the top', (t) => {
  t.is(propagate(['c'], importers, new Map()), null)
})

test('an importer that named a dependency does not run again', (t) => {
  const handlers = new Map([['b', { self: false, deps: new Map([['c', null]]) }]])

  const { invalidated, accepted } = propagate(['c'], importers, handlers)

  t.alike([...invalidated], ['c'], 'only the changed module is read again')
  t.alike(accepted, [{ href: 'b', dep: 'c' }])
})

test('a diamond invalidates each module once', (t) => {
  const handlers = new Map([['a', { self: true, deps: new Map() }]])

  const diamond = (href) => ({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] })[href]

  const { invalidated } = propagate(['d'], diamond, handlers)

  t.alike([...invalidated].sort(), ['a', 'b', 'c', 'd'])
})
