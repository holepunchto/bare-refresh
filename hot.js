exports.data = {}
exports.generation = 0

exports.dispose = function dispose() {}

exports.use = function use() {}

exports.report = function report() {
  return null
}

exports.hot = function hot() {
  return {
    data: {},
    accept() {},
    dispose() {},
    invalidate() {}
  }
}

exports.reload = function reload() {
  return Promise.resolve(null)
}
