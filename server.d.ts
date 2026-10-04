import EventEmitter, { EventMap } from 'bare-events'
import Bundle from 'bare-bundle'
import RPC from 'bare-rpc'
import { Duplex } from 'bare-stream'
import { Report } from '.'
import constants from './lib/constants'

interface RefreshServerEvents extends EventMap {
  error: [err: Error]
  /** A host connected, with the id of the bundle it has. */
  connection: [id: string | null]
  /** The bundle was packed again and sent, with its id. */
  update: [id: string | null]
  /** A host reported a failure. */
  report: [report: Report]
}

/** A server that sends each connected host what changed since it was last updated. */
interface RefreshServer extends EventEmitter<RefreshServerEvents> {
  /** The bundle that was packed last, or `null` if nothing has been packed yet. */
  readonly bundle: Bundle | null
  /** How many hosts are connected. */
  readonly clients: number

  /**
   * Serve a host over `stream`. A host that already has the current bundle is sent nothing, and any
   * other host is sent the whole bundle.
   */
  connect(stream: Duplex): RPC

  /**
   * Pack the bundle again and send each host what changed since it was last updated. Resolves with
   * the bundle once every host has applied the update, disconnected, or timed out.
   */
  update(): Promise<Bundle>
}

declare class RefreshServer {
  /**
   * Create a server that serves what `pack` returns. `pack` is called when the first host connects
   * and on every update. `timeout` is how many milliseconds to wait for a host to apply an update,
   * and defaults to 10 seconds.
   */
  constructor(pack: () => Bundle | Promise<Bundle>, opts?: { timeout?: number })

  static readonly constants: typeof constants
}

declare namespace RefreshServer {
  export { type RefreshServerEvents }
}

export = RefreshServer
