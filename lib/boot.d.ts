import Bundle from 'bare-bundle'
import { Duplex } from 'bare-stream'
import Refresh from '..'

/**
 * Create a host for `bundle`, start it, and connect it to a server over the stream that
 * `connect(options)` returns. This is what the generated entry of a development build calls.
 */
declare function boot<T>(
  bundle: Bundle | Uint8Array,
  opts?: {
    connect?: ((options: T) => Duplex) | null
    options?: T
    protocol?: unknown
    builtins?: Record<string, unknown> | null
  }
): Refresh

export = boot
