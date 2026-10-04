const test = require('brittle')

const { dialects, fixture, ran } = require('./helpers')

for (const name of Object.keys(dialects)) {
  const f = fixture(name)

  const { hot, extension } = dialects[name]

  test(`${name}: a patch that adds a module is refreshed rather than rebuilt`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(f.patch({ b: { imports: ['e'], exports: 'e' }, e: { exports: '5' } }))

    t.alike(ran(refresh), ['e', 'b', 'a'], 'the module that was not there before ran')
    t.is(f.value(refresh), 5, 'and the graph has it')
    t.is(refresh.generation, 1, 'without the graph being built again')
  })

  test(`${name}: a patch that changes what a module imports is resolved afresh`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b: { imports: ['c'], exports: 'c' },
      c: { exports: '1' },
      d: { exports: '10' }
    })

    await refresh.start()

    t.alike(ran(refresh), ['c', 'b', 'a'], 'nothing read the module nobody imported')

    await refresh.update(f.patch({ b: { imports: ['d'], exports: 'd' } }))

    t.alike(ran(refresh), ['d', 'b', 'a'])
    t.is(f.value(refresh), 10)
  })

  test(`${name}: a patch's resolutions survive being applied`, async (t) => {
    const b = { bare: { x: 'd' }, exports: 'x' }

    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b' },
      b,
      d: { exports: '10' }
    })

    await refresh.start()

    t.is(f.value(refresh), 10, 'the packer said what the specifier meant')

    await refresh.update(f.patch({ b }))

    t.is(f.value(refresh), 10, 'and is still the only one who could have')
    t.is(refresh.generation, 1)
  })

  test(`${name}: a patch that remaps a specifier is read afresh`, async (t) => {
    const refresh = f.host({
      a: { imports: ['b'], body: `${hot}.accept()`, exports: 'b', resolved: true },
      b: { imports: ['c'], exports: 'c', resolved: true },
      c: { exports: '1', resolved: true },
      d: { exports: '10', resolved: true }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(
      f.patch({
        b: { imports: ['c'], exports: 'c', resolutions: { ['./c' + extension]: 'd' } }
      })
    )

    t.alike(ran(refresh), ['d', 'b', 'a'], 'the module the patch pointed at was read')
    t.is(f.value(refresh), 10, 'and the specifier means what the patch said')
    t.is(refresh.generation, 1)
  })

  test(`${name}: a change two levels down reaches an importer that named the one between`, async (t) => {
    const refresh = f.host({
      a: {
        imports: ['b'],
        body: `${hot}.accept(['./b${extension}'], (b) => { refresh.data.handed = b })`,
        exports: 'b'
      },
      b: { imports: ['c'], exports: 'c' },
      c: { exports: '1' }
    })

    await refresh.start()

    ran(refresh)

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(ran(refresh), ['c', 'b'], 'the change stopped below the importer that named it')
    t.is(f.read(refresh.data.handed), 2, 'which was handed what the module between now exports')
    t.is(f.value(refresh), 1, 'and still holds what it captured')
    t.is(refresh.generation, 1)
  })
}
