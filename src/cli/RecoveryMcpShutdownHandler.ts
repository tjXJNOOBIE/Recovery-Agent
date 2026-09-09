export interface RecoveryMcpShutdownTargets {
  readonly mcpServer: { close(): Promise<void> }
  readonly watches: { close(): Promise<void> }
  readonly approvalServer?: { close(): Promise<void> }
  readonly control: { close(): Promise<void> }
}

export class RecoveryMcpShutdownHandler {
  public async close(targets: RecoveryMcpShutdownTargets): Promise<void> {
    const failures: unknown[] = []
    const operations: readonly (() => Promise<void>)[] = [
      () => targets.mcpServer.close(),
      () => targets.watches.close(),
      ...(targets.approvalServer === undefined ? [] : [() => targets.approvalServer!.close()]),
      () => targets.control.close(),
    ]

    for (const close of operations) {
      try {
        await close()
      } catch (error: unknown) {
        failures.push(error)
      }
    }

    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Recovery MCP shutdown encountered multiple cleanup failures', { cause: failures[0] })
    }
  }
}
