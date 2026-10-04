import Bundle from 'bare-bundle'

interface Delta {
  /** The files that were added or changed, with their resolutions. */
  changed: Bundle
  /** The keys of the files that were removed. */
  removed: string[]
}

/** Compute what changed between `from` and `to`. */
declare function diff(from: Bundle, to: Bundle): Delta

/** Apply `delta` to `base`, returning a new bundle. */
declare function apply(base: Bundle, delta: Delta): Bundle

export { type Delta, apply, diff }
