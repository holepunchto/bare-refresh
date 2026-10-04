// A server refuses a client that speaks another version, as the two are built
// separately.
exports.VERSION = 1

exports.command = {
  HELLO: 1,
  UPDATE: 2,
  REPORT: 3
}

exports.phase = {
  COMPILE: 'compile',
  EVALUATE: 'evaluate',
  DISPOSE: 'dispose',
  ACCEPT: 'accept',
  PLUGIN: 'plugin',
  TRANSPORT: 'transport',
  RUNTIME: 'runtime'
}

// Whether the graph is still the one that was running after a failure in each
// phase. A module that throws while being evaluated again leaves the graph
// taken apart around it.
exports.intact = {
  [exports.phase.COMPILE]: true,
  [exports.phase.EVALUATE]: false,
  [exports.phase.DISPOSE]: true,
  [exports.phase.ACCEPT]: true,
  [exports.phase.PLUGIN]: true,
  [exports.phase.TRANSPORT]: true,
  [exports.phase.RUNTIME]: true
}
