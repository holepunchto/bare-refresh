// Every module that imports a changed module is evaluated again too, up to the
// modules that accept the change. A CommonJS leaf could be swapped in place,
// but an ES module could not, so neither is, and both behave the same.
module.exports = function propagate(changed, importers, handlers) {
  const invalidated = new Set(changed)
  const accepted = []
  const roots = []
  const queue = [...changed]

  while (queue.length > 0) {
    const href = queue.pop()

    const handler = handlers.get(href)

    if (handler !== undefined && handler.self) {
      roots.push(href)

      continue
    }

    const above = importers(href)

    if (above.length === 0) return null

    for (const importer of above) {
      const accepting = handlers.get(importer)

      if (accepting !== undefined && accepting.deps.has(href)) {
        accepted.push({ href: importer, dep: href })

        continue
      }

      if (invalidated.has(importer)) continue

      invalidated.add(importer)

      queue.push(importer)
    }
  }

  return { invalidated, accepted, roots }
}
