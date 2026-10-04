import cenc from 'compact-encoding'
import { Report } from '..'

type State = ReturnType<typeof cenc.state>

interface Encoding<T> {
  preencode(state: State, message: T): void
  encode(state: State, message: T): void
  decode(state: State): T
}

/** Sent by a host when it connects. */
declare const hello: Encoding<{ version: number; id: string | null }>

/** Sent by the server with the files that changed since the host was last updated. */
declare const update: Encoding<{ changed: Uint8Array; removed: string[] }>

/** Sent by a host when something fails. */
declare const report: Encoding<Report>

export { hello, report, update }
