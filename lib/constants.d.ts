declare const constants: {
  /** The version of the protocol. */
  VERSION: 1

  /** The commands of the protocol. */
  command: {
    HELLO: 1
    UPDATE: 2
    REPORT: 3
  }

  /** Where a failure happened. */
  phase: {
    /** A changed module did not compile. The graph is unchanged. */
    COMPILE: 'compile'
    /** A module threw while being evaluated. The graph has been taken apart around it. */
    EVALUATE: 'evaluate'
    /** A dispose callback threw. */
    DISPOSE: 'dispose'
    /** An accept callback threw. */
    ACCEPT: 'accept'
    /** A plugin threw. */
    PLUGIN: 'plugin'
    /** The transport failed. */
    TRANSPORT: 'transport'
    /** The application reported a failure it caught itself. */
    RUNTIME: 'runtime'
  }

  /** Whether the graph is still the one that was running after a failure in each phase. */
  intact: Record<string, boolean>
}

export = constants
