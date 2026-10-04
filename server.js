const EventEmitter = require('bare-events')
const Bundle = require('bare-bundle')
const RPC = require('bare-rpc')
const cenc = require('compact-encoding')
const { VERSION, command } = require('./lib/constants')
const delta = require('./lib/delta')
const messages = require('./lib/messages')

const empty = new Bundle()

module.exports = exports = class RefreshServer extends EventEmitter {
  constructor(pack, opts = {}) {
    super()

    const { timeout = 10000 } = opts

    this._pack = pack
    this._timeout = timeout
    this._bundle = null
    this._clients = new Set()
  }

  get bundle() {
    return this._bundle
  }

  get clients() {
    return this._clients.size
  }

  connect(stream) {
    const client = { rpc: null, bundle: null, gone: null }

    // A killed app leaves a socket that can still be written to, so a client
    // is gone once its stream ends rather than once it closes.
    client.gone = new Promise((resolve) => {
      const gone = () => {
        this._clients.delete(client)

        resolve()
      }

      stream.on('close', gone)
      stream.on('end', gone)
      stream.on('error', gone)
    })

    client.rpc = new RPC(stream, (req) => this._onrequest(client, req))

    this._clients.add(client)

    return client.rpc
  }

  async update() {
    const bundle = await this._pack()

    this._bundle = bundle

    await Promise.all([...this._clients].map((client) => this._send(client, bundle)))

    this.emit('update', bundle.id)

    return bundle
  }

  async _send(client, bundle) {
    const { changed, removed } = delta.diff(client.bundle || empty, bundle)

    if (changed.empty() && removed.length === 0) return

    client.bundle = bundle

    const req = client.rpc.request(command.UPDATE)

    req.send(cenc.encode(messages.update, { changed: changed.toBuffer(), removed }))

    // A client that never replies would otherwise hold up every update after
    // this one. It keeps its place, as what it was sent is what it has.
    let timer = null

    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        this.emit(
          'error',
          new Error(`Client has not answered in ${this._timeout}ms; carrying on without it`)
        )

        resolve()
      }, this._timeout)
    })

    try {
      await Promise.race([req.reply(), client.gone, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  async _onrequest(client, req) {
    if (req.command === command.REPORT) {
      this.emit('report', cenc.decode(messages.report, req.data))

      return req.reply()
    }

    if (req.command !== command.HELLO) return req.reply()

    const { version, id } = cenc.decode(messages.hello, req.data)

    req.reply()

    if (version !== VERSION) {
      this.emit(
        'error',
        new Error(`Client speaks refresh version ${version}, but this server speaks ${VERSION}`)
      )

      return this._clients.delete(client)
    }

    // Packed rather than updated, as an update would send to this client
    // before its id has been compared.
    if (this._bundle === null) this._bundle = await this._pack()

    if (id !== null && id === this._bundle.id) client.bundle = this._bundle

    this.emit('connection', id)

    await this._send(client, this._bundle)
  }
}

exports.constants = require('./lib/constants')
