interface Handler {
  /** Whether the module accepts changes to itself. */
  self: boolean
  /** The dependencies whose changes the module accepts, by URL. */
  deps: Map<string, unknown>
}

interface Propagation {
  /** Every module that has to be evaluated again. */
  invalidated: Set<string>
  /** The importers that accept a changed dependency, which are not evaluated again. */
  accepted: { href: string; dep: string }[]
  /** The modules that accept changes to themselves, which are evaluated first. */
  roots: string[]
}

/**
 * Work out which modules have to be evaluated again when the modules at `changed` change.
 * `importers` returns the URLs of the modules that import a module, and `handlers` returns what a
 * module accepts. Returns `null` if a change reaches a module without importers before anything
 * accepts it.
 */
declare function propagate(
  changed: Iterable<string>,
  importers: (href: string) => string[],
  handlers: { get(href: string): Handler | undefined }
): Propagation | null

declare namespace propagate {
  export { type Handler, type Propagation }
}

export = propagate
