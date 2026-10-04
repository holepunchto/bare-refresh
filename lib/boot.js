const Refresh = require('..')

module.exports = function boot(bundle, opts = {}) {
  const {
    connect = null,
    options = null,
    protocol = null,
    builtins = null,
    console = globalThis.console
  } = opts

  const refresh = new Refresh(bundle, { protocol, builtins })

  refresh
    .on('error', (err, report) => console.error(`${report.phase}: ${err.message}`))
    .on('reload', (generation) => console.log('reloaded', generation))
    .on('refresh', (modules) => console.log('refreshed', modules, 'modules'))

    // Connected even if the graph failed to start, so that the failure is
    // reported.
    .start()
    .catch(noop)
    .then(() => {
      if (connect === null) return

      const stream = connect(options)

      refresh.connect(stream)

      stream.on('error', (err) => refresh.report(err))
    })

  return refresh
}

function noop() {}
