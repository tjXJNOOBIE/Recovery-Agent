import type { IStrandsAgentRuntime } from '@tjxjnoobie/custom-strands-bridge'

type InvokeResult = Awaited<ReturnType<IStrandsAgentRuntime['invokeAgent']>>
type InvokeArguments = Parameters<IStrandsAgentRuntime['invokeAgent']>
type StreamArguments = Parameters<IStrandsAgentRuntime['streamAgent']>
type AgentToolArguments = Parameters<IStrandsAgentRuntime['createAgentTool']>

export class FakeStrandsAgentRuntime implements IStrandsAgentRuntime {
  public invokeCalls = 0
  public closeCalls = 0
  public lastInvokeArgs: InvokeArguments[0] | undefined
  public invokeError: unknown | undefined
  private closed = false
  private readonly result: InvokeResult

  public constructor(resultText: string) {
    this.result = {
      toString: () => resultText,
    } as InvokeResult
  }

  public async invokeAgent(
    invokeArgs: InvokeArguments[0],
    invokeOptions?: InvokeArguments[1],
  ): Promise<InvokeResult> {
    void invokeOptions
    this.invokeCalls += 1
    this.lastInvokeArgs = invokeArgs

    if (this.invokeError !== undefined) {
      throw this.invokeError
    }

    return this.result
  }

  public streamAgent(
    invokeArgs: StreamArguments[0],
    invokeOptions?: StreamArguments[1],
  ): ReturnType<IStrandsAgentRuntime['streamAgent']> {
    void invokeArgs
    void invokeOptions
    throw new Error('Fake streamAgent is not configured for this test.')
  }

  public cancelInvocation(): void {}

  public createAgentTool(
    agentAsToolOptions?: AgentToolArguments[0],
  ): ReturnType<IStrandsAgentRuntime['createAgentTool']> {
    void agentAsToolOptions
    throw new Error('Fake createAgentTool is not configured for this test.')
  }

  public isClosed(): boolean {
    return this.closed
  }

  public async close(): Promise<void> {
    this.closeCalls += 1
    this.closed = true
  }
}
