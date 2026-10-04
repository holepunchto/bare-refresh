const cenc = require('compact-encoding')

exports.hello = {
  preencode(state, message) {
    cenc.uint.preencode(state, message.version)
    cenc.string.preencode(state, message.id || '')
  },

  encode(state, message) {
    cenc.uint.encode(state, message.version)
    cenc.string.encode(state, message.id || '')
  },

  decode(state) {
    const version = cenc.uint.decode(state)
    const id = cenc.string.decode(state)

    return { version, id: id === '' ? null : id }
  }
}

exports.update = {
  preencode(state, message) {
    cenc.buffer.preencode(state, message.changed)
    cenc.array(cenc.string).preencode(state, message.removed)
  },

  encode(state, message) {
    cenc.buffer.encode(state, message.changed)
    cenc.array(cenc.string).encode(state, message.removed)
  },

  decode(state) {
    const changed = cenc.buffer.decode(state)
    const removed = cenc.array(cenc.string).decode(state)

    return { changed, removed }
  }
}

exports.report = {
  preencode(state, message) {
    cenc.string.preencode(state, message.phase)
    cenc.string.preencode(state, message.href || '')
    cenc.uint.preencode(state, message.generation)
    cenc.bool.preencode(state, message.intact)
    cenc.string.preencode(state, message.name)
    cenc.string.preencode(state, message.message)
    cenc.string.preencode(state, message.stack || '')
    cenc.string.preencode(state, message.code || '')
  },

  encode(state, message) {
    cenc.string.encode(state, message.phase)
    cenc.string.encode(state, message.href || '')
    cenc.uint.encode(state, message.generation)
    cenc.bool.encode(state, message.intact)
    cenc.string.encode(state, message.name)
    cenc.string.encode(state, message.message)
    cenc.string.encode(state, message.stack || '')
    cenc.string.encode(state, message.code || '')
  },

  decode(state) {
    const phase = cenc.string.decode(state)
    const href = cenc.string.decode(state)
    const generation = cenc.uint.decode(state)
    const intact = cenc.bool.decode(state)
    const name = cenc.string.decode(state)
    const message = cenc.string.decode(state)
    const stack = cenc.string.decode(state)
    const code = cenc.string.decode(state)

    return {
      phase,
      href: href === '' ? null : href,
      generation,
      intact,
      name,
      message,
      stack: stack === '' ? null : stack,
      code: code === '' ? null : code
    }
  }
}
