const test = require('brittle')

const { dialects, fixture } = require('./helpers')

const chain = {
  a: { imports: ['b'], exports: 'b' },
  b: { imports: ['c'], exports: 'c' },
  c: { exports: '1' }
}

for (const name of Object.keys(dialects)) {
  const f = fixture(name)

  const { hot, extension } = dialects[name]

  const speaks = { accepts: (href) => href === f.href('a') }

  test(`${name}: a plugin speaks for modules that say nothing`, async (t) => {
    const refresh = f.host(chain)

    refresh.use(speaks)

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.generation, 1, 'the plugin kept the graph alive')
    t.is(f.value(refresh), 2)
  })

  test(`${name}: a module's own word beats what a plugin says for it`, async (t) => {
    const refresh = f.host({ ...chain, a: { ...chain.a, body: `${hot}.accept()` } })

    refresh.use({ accepts: () => false })

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.generation, 1, 'what the module said is what was asked of it')
  })

  test(`${name}: a plugin is told about what ran, the builtin included`, async (t) => {
    const seen = []

    const refresh = f.host(chain)

    refresh.use({ ...speaks, evaluated: (href) => seen.push(href) })

    await refresh.start()

    t.alike(
      seen.sort(),
      [f.href('a'), f.href('b'), f.href('c'), 'builtin:bare-refresh'],
      'the surface the host injected is a module of the graph like any other'
    )

    seen.length = 0

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(seen.sort(), [f.href('a'), f.href('b'), f.href('c')], 'and again after a refresh')
  })

  test(`${name}: a plugin is told once when a refresh is over, and not when one is built`, async (t) => {
    const settled = []

    const refresh = f.host(chain)

    refresh.use({ ...speaks, settled: (hrefs) => settled.push(hrefs.length) })

    await refresh.start()

    t.alike(settled, [], 'building a graph is not a refresh')

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(settled, [3], 'told once, about everything that was read again')

    await refresh.reload()

    t.alike(settled, [3], 'and a reload is not a refresh either')
  })

  test(`${name}: a plugin that throws is reported and the rest are still told`, async (t) => {
    const settled = []
    const errors = []

    const refresh = f.host(chain)

    refresh.use({
      ...speaks,
      settled() {
        throw new Error('the plugin gave up')
      }
    })

    refresh.use({ settled: (hrefs) => settled.push(hrefs.length) })

    refresh.on('error', (err) => errors.push(err.message))

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.alike(errors, ['the plugin gave up'])
    t.alike(settled, [3], 'the plugin after it was told anyway')
    t.is(refresh.generation, 1)
  })

  test(`${name}: a plugin registered on the host outlives a reload`, async (t) => {
    const refresh = f.host(chain)

    refresh.use(speaks)

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.generation, 1)

    await refresh.reload()

    await refresh.update(f.patch({ c: { exports: '3' } }))

    t.is(refresh.generation, 2, 'the graph it was never part of is still spoken for')
  })

  test(`${name}: a plugin registered from inside the graph goes when that graph does`, async (t) => {
    const body =
      `if (refresh.data.spoken !== true) {\n` +
      `  refresh.data.spoken = true\n` +
      `  refresh.use({ accepts: (href) => href.endsWith('/a${extension}') })\n` +
      `}\n`

    const refresh = f.host({ ...chain, a: { ...chain.a, body } })

    await refresh.start()

    await refresh.update(f.patch({ c: { exports: '2' } }))

    t.is(refresh.generation, 1, 'the graph spoke for itself')

    await refresh.reload()

    await refresh.update(f.patch({ c: { exports: '3' } }))

    t.is(refresh.generation, 3, 'and the graph that replaced it did not')
  })
}
