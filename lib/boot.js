const Refresh = require('..')

module.exports = function boot(bundle, opts = {}) {
  const { connect = null, options = null, protocol = null, builtins = null, attach = [] } = opts

  const refresh = new Refresh(bundle, { protocol, builtins })

  // Before the graph starts, so that nothing it reports is missed.
  for (const fn of attach) fn(refresh)

  refresh
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
