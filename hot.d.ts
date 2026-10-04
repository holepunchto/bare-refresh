import Module from 'bare-module'
import constants from './lib/constants'

type Phase = (typeof constants.phase)[keyof typeof constants.phase]

/** A failure, as it is sent to the server. Module URLs are relative to the bundle. */
interface Report {
  readonly phase: Phase
  /** The module the failure happened in, if known. */
  readonly href: string | null
  /** The generation of the graph when the failure happened. */
  readonly generation: number
  /** Whether the graph is still the one that was running. */
  readonly intact: boolean
  readonly name: string
  readonly message: string
  readonly stack: string | null
  readonly code: string | null
}

/** What a module says about being refreshed, as returned by `hot()`. */
interface Hot {
  /** Data that is kept when the module is evaluated again, but not across a reload. */
  readonly data: Record<string, any>

  /**
   * Accept changes to the module itself. The module is evaluated again, and its importers keep
   * what it exported before.
   */
  accept(): void
  /**
   * Accept changes to the dependencies named by `specifiers`. The module is not evaluated again.
   * Instead, `onchange` is called with what importing the changed dependency returns.
   */
  accept(specifiers: string | string[], onchange?: (exports: unknown) => void): void

  /** Call `fn` with `data` before the module is evaluated again. */
  dispose(fn: (data: Record<string, any>) => void): void

  /** Take back what was accepted, so that changes propagate past the module again. */
  invalidate(): void
}

/**
 * Hooks that let a framework accept changes for modules that do not accept them themselves. Every
 * hook is optional.
 */
interface Plugin {
  /** Called with the URL and exports of every module that has just been evaluated. */
  evaluated?(href: string, exports: unknown): void
  /** Whether to accept changes to the module at `href` on its behalf. */
  accepts?(href: string): boolean
  /** Called with the URLs of the modules evaluated again once a refresh has finished. */
  settled?(hrefs: string[]): void
  /** Called with every failure. */
  failed?(err: unknown, report: Report): void
}

/** The same object for every graph. Outside a host, an empty object. */
declare const data: Record<string, any>
/** The generation of the graph. Outside a host, `0`. */
declare const generation: number

/** Call `fn` when the graph is disposed before a reload. */
declare function dispose(fn: () => void): void

/** Return what the module at `module.url` or `import.meta.url` says about being refreshed. */
declare function hot(module: { url: string | URL }): Hot

/** Add a plugin that is removed when the graph is replaced. */
declare function use(plugin: Plugin): void

/**
 * Report a failure that the application caught itself. `phase` defaults to `runtime`. Outside a
 * host, nothing is reported and `null` is returned.
 */
declare function report(err: unknown, opts?: { phase?: Phase; href?: string | null }): Report | null

/** Build the graph again. Outside a host, resolves with `null`. */
declare function reload(): Promise<Module | null>

export {
  type Hot,
  type Phase,
  type Plugin,
  type Report,
  data,
  dispose,
  generation,
  hot,
  reload,
  report,
  use
}
