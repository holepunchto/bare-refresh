const test = require('brittle')
const Bundle = require('bare-bundle')
const RPC = require('bare-rpc')
const cenc = require('compact-encoding')

const RefreshServer = require('bare-refresh/server')
const { VERSION, command } = require('bare-refresh/constants')
const messages = require('bare-refresh/messages')
const { pair } = require('./helpers')

function app(count, { extra = 'extra\n' } = {}) {
  const bundle = new Bundle()

  bundle.id = 'app-' + count
  bundle.main = '/index.js'

  bundle.write('/index.js', `module.exports = ${count}\n`)

  if (extra !== null) bundle.write('/extra.js', extra)

  return bundle
}

function client(server, { id = null, version = VERSION } = {}) {
  const [a, b] = pair()

  const received = []

  let waiting = []

  const rpc = new RPC(b, (req) => {
    if (req.command === command.UPDATE) {
      const { changed, removed } = cenc.decode(messages.update, req.data)

      const update = { changed: [...Bundle.from(changed).keys()].sort(), removed }

      received.push(update)

      for (const resolve of waiting) resolve(update)

      waiting = []
    }

    req.reply()
  })

  server.connect(a)

  const hello = rpc.request(command.HELLO)

  hello.send(cenc.encode(messages.hello, { version, id }))

  return {
    received,

    next() {
      return new Promise((resolve) => waiting.push(resolve))
    },

    quiet() {
      return Promise.race([
        this.next().then(() => false),
        new Promise((resolve) => setTimeout(() => resolve(true), 50))
      ])
    }
  }
}

test('a client that has never been told anything is told everything', async (t) => {
  const server = new RefreshServer(() => app(1))

  t.is(server.bundle, null, 'nothing is packed until something asks')

  const c = client(server)

  t.alike(await c.next(), { changed: ['/extra.js', '/index.js'], removed: [] })
  t.is(server.bundle.id, 'app-1', 'and the hello is what packed it')
  t.is(server.clients, 1)
})

test('two clients at different generations each get what they are missing', async (t) => {
  let packed = app(1)

  const server = new RefreshServer(() => packed)

  const a = client(server)

  await a.next()

  packed = app(2)

  await server.update()

  t.alike(a.received[1], { changed: ['/index.js'], removed: [] }, 'one file moved, one file sent')

  const b = client(server)

  t.alike(
    await b.next(),
    { changed: ['/extra.js', '/index.js'], removed: [] },
    'and the client that arrived late is told all of it'
  )

  packed = app(3)

  await server.update()

  t.alike(a.received[2], { changed: ['/index.js'], removed: [] })
  t.alike(b.received[1], { changed: ['/index.js'], removed: [] }, 'and from here they agree')
})

test('a client that connects holding the current id is told nothing', async (t) => {
  const server = new RefreshServer(() => app(1))

  await server.update()

  const c = client(server, { id: 'app-1' })

  t.ok(await c.quiet(), 'it already has what the server would have sent')
  t.is(server.clients, 1, 'and it is still a client')
})

test('a client that connects holding an id the server does not know is told everything', async (t) => {
  const server = new RefreshServer(() => app(1))

  const c = client(server, { id: 'app-0' })

  t.alike(
    await c.next(),
    { changed: ['/extra.js', '/index.js'], removed: [] },
    'an id alone is not enough to work out what it holds'
  )
})

test('a client that speaks another version is reported and let go', async (t) => {
  const server = new RefreshServer(() => app(1))

  const errors = []

  server.on('error', (err) => errors.push(err.message))

  const c = client(server, { version: VERSION + 1 })

  t.ok(await c.quiet(), 'it is sent nothing')
  t.is(server.clients, 0, 'and is no longer a client')
  t.alike(errors, [
    `Client speaks refresh version ${VERSION + 1}, but this server speaks ${VERSION}`
  ])
})

test('an update that changes nothing sends nothing', async (t) => {
  const server = new RefreshServer(() => app(1))

  const c = client(server)

  await c.next()

  const updated = []

  server.on('update', (id) => updated.push(id))

  await server.update()

  t.is(c.received.length, 1, 'the client was left alone')
  t.alike(updated, ['app-1'], 'and the update happened all the same')
})

test('a file that goes away is reported as gone', async (t) => {
  let packed = app(1)

  const server = new RefreshServer(() => packed)

  const c = client(server)

  await c.next()

  packed = app(1, { extra: null })

  await server.update()

  t.alike(c.received[1], { changed: [], removed: ['/extra.js'] })
})

test('a client that is there and not answering is not waited for', async (t) => {
  const server = new RefreshServer(() => app(2), { timeout: 50 })

  const errors = []

  server.on('error', (err) => errors.push(err.message))

  const [x, y] = pair()

  server.connect(x)

  // Reads, so that the stream stays open, but never replies.
  y.resume()

  await t.execution(server.update(), 'the update finishes anyway')

  t.is(server.clients, 1, 'and the client keeps its place')
  t.is(errors.length, 1)
  t.ok(/has not answered/.test(errors[0]))
})
