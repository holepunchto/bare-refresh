import EventEmitter, { EventMap } from 'bare-events'
import Bundle from 'bare-bundle'
import Module from 'bare-module'
import RPC from 'bare-rpc'
import { Duplex } from 'bare-stream'
import constants from './lib/constants'
import delta from './lib/delta'
import { type Phase, type Plugin, type Report } from './hot'

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
 * application, `require('bare-refresh/hot')` returns the hooks of the host.
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

  static readonly constants: typeof constants
  static readonly delta: typeof delta
}

declare namespace Refresh {
  export { type Phase, type Plugin, type RefreshEvents, type Report, type Update }
}

export = Refresh
