import EventEmitter, { EventMap } from 'bare-events'
import Bundle from 'bare-bundle'
import Module from 'bare-module'
import RPC from 'bare-rpc'
import { Duplex } from 'bare-stream'
import constants from './lib/constants'
import delta from './lib/delta'

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

interface RefreshEvents extends EventMap {
  /** A failure. Unlike most emitters, the host does not throw when nothing listens for it. */
  error: [err: unknown, report: Report]
  /** A new graph was built, with its generation. */
  reload: [generation: number]
  /** Changed modules were evaluated again, with how many there were. */
  refresh: [modules: number]
}

/** An update, as sent by the server. */
interface Update {
  /** The changed files, as a serialized bundle. */
  changed: Uint8Array | Bundle
  /** The keys of the files that were removed. */
  removed: string[]
}

/**
 * A host that runs an application from a bundle and refreshes it as the bundle changes. Inside the
 * application, `require('bare-refresh')` returns the injected surface of the host, which matches
 * the static members of this class.
 */
interface Refresh extends EventEmitter<RefreshEvents> {
  /** Data that is kept across reloads. */
  readonly data: Record<string, any>
  /** How many graphs have been built. Zero until the application has started. */
  readonly generation: number
  /** The id of the current bundle. */
  readonly id: string | null
  /** The entry module of the running graph, or `null` if nothing is running. */
  readonly graph: Module | null
  /** Whether a graph is running. */
  readonly running: boolean

  /** Add a plugin that is kept across reloads. */
  use(plugin: Plugin): this

  /**
   * Build and run a graph from the bundle. Resolves with its entry module. Calling it again while
   * the application is starting or running resolves with the same module.
   */
  start(): Promise<Module>

  /**
   * Dispose the running graph, then build a new one. If the new graph throws, nothing is running
   * until a later update builds one that does not.
   */
  reload(): Promise<Module>

  /**
   * Apply an update to the bundle. Changed modules and their importers are evaluated again, up to
   * the modules that accept the change. If no module accepts it, or a file was removed, the graph is
   * reloaded instead. Resolves with the entry module.
   *
   * A module that does not compile leaves the running graph as it was. A module that throws while
   * being evaluated leaves the graph partly taken apart, and the next update continues from there.
   */
  update(update: Update): Promise<Module>

  /**
   * Connect to a server over `stream`. Updates are applied as they arrive, and failures are sent to
   * the server, including those from before the host was connected.
   */
  connect(stream: Duplex): RPC

  /** Report a failure that happened outside the graph. `where` defaults to `transport`. */
  report(err: unknown, where?: Phase, href?: string | null): Report
}

declare class Refresh {
  /**
   * Create a host for `bundle`. `protocol` and `builtins` are passed on to the module loader of
   * every graph, and `entry` is the URL the bundle is mounted at.
   */
  constructor(
    bundle: Bundle | Uint8Array,
    opts?: { protocol?: unknown; builtins?: Record<string, unknown> | null; entry?: string | URL }
  )

  /** The same object for every graph. Outside a host, an empty object. */
  static readonly data: Record<string, any>
  /** The generation of the graph. Outside a host, `0`. */
  static readonly generation: number

  /** Call `fn` when the graph is disposed before a reload. */
  static dispose(fn: () => void): void
  /** Return what the module at `module.url` or `import.meta.url` says about being refreshed. */
  static hot(module: { url: string | URL }): Hot
  /** Add a plugin that is removed when the graph is replaced. */
  static use(plugin: Plugin): void
  /**
   * Report a failure that the application caught itself. `phase` defaults to `runtime`. Outside a
   * host, nothing is reported and `null` is returned.
   */
  static report(err: unknown, opts?: { phase?: Phase; href?: string | null }): Report | null
  /** Build the graph again. Outside a host, resolves with `null`. */
  static reload(): Promise<Module | null>

  static readonly constants: typeof constants
  static readonly delta: typeof delta
}

declare namespace Refresh {
  export { type Hot, type Phase, type Plugin, type RefreshEvents, type Report, type Update }
}

export = Refresh
