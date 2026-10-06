import Bundle from 'bare-bundle'
import { Duplex } from 'bare-stream'
import Refresh from '..'

/**
 * Create a host for `bundle`, start it, and connect it to a server over the stream that
 * `connect(options)` returns. Each function in `attach` is called with the host before it starts,
 * so that it sees everything the host reports. This is what the generated entry of a development
 * build calls.
 */
declare function boot<T>(
  bundle: Bundle | Uint8Array,
  opts?: {
    connect?: ((options: T) => Duplex) | null
    options?: T
    protocol?: unknown
    builtins?: Record<string, unknown> | null
    attach?: ((refresh: Refresh) => void)[]
  }
): Refresh

export = boot
