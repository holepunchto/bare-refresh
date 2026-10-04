const Bundle = require('bare-bundle')

// The changed files are carried as a bundle, so that they keep the
// resolutions of the packer.
exports.diff = function diff(from, to) {
  const changed = new Bundle()

  changed.id = to.id
  changed.main = to.main
  changed.imports = to.imports

  for (const [key, data, mode] of to) {
    const before = from.exists(key) ? from.read(key) : null

    if (before !== null && before.equals(data) && from.mode(key) === mode) continue

    changed.write(key, data, {
      mode,
      imports: to.resolutions[key] || null,
      addon: to.addons.includes(key),
      asset: to.assets.includes(key)
    })
  }

  const removed = []

  for (const key of from.keys()) {
    if (!to.exists(key)) removed.push(key)
  }

  return { changed, removed }
}

exports.apply = function apply(base, { changed, removed }) {
  const applied = new Bundle()

  applied.id = changed.id
  applied.main = changed.main || base.main
  applied.imports = { ...base.imports, ...changed.imports }

  const gone = new Set(removed)

  for (const [key, data, mode] of base) {
    if (gone.has(key) || changed.exists(key)) continue

    applied.write(key, data, {
      mode,
      imports: base.resolutions[key] || null,
      addon: base.addons.includes(key),
      asset: base.assets.includes(key)
    })
  }

  for (const [key, data, mode] of changed) {
    applied.write(key, data, {
      mode,
      imports: changed.resolutions[key] || null,
      addon: changed.addons.includes(key),
      asset: changed.assets.includes(key)
    })
  }

  return applied
}
