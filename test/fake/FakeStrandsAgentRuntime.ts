import type { IStrandsAgentRuntime } from '@tjxjnoobie/strands-bridge'

type InvokeResult = Awaited<ReturnType<IStrandsAgentRuntime['invokeAgent']>>
type InvokeArguments = Parameters<IStrandsAgentRuntime['invokeAgent']>
type StreamArguments = Parameters<IStrandsAgentRuntime['streamAgent']>
type AgentToolArguments = Parameters<IStrandsAgentRuntime['createAgentTool']>

export class FakeStrandsAgentRuntime implements IStrandsAgentRuntime {
  public invokeCalls = 0
  public closeCalls = 0
  public lastInvokeArgs: InvokeArguments[0] | undefined
  public readonly invokeHistory: InvokeArguments[0][] = []
  public invokeError: unknown | undefined
  public closeError: unknown | undefined
  private closed = false
  private readonly results: InvokeResult[]

  public constructor(resultText: string | readonly string[]) {
    const values = typeof resultText === 'string' ? [resultText] : [...resultText]
    this.results = values.map((value) => ({ toString: () => value } as InvokeResult))
  }

  public async invokeAgent(invokeArgs: InvokeArguments[0], invokeOptions?: InvokeArguments[1]): Promise<InvokeResult> {
    void invokeOptions
    this.invokeCalls += 1; this.lastInvokeArgs = invokeArgs; this.invokeHistory.push(invokeArgs)
    if (this.invokeError !== undefined) throw this.invokeError
    const result = this.results[Math.min(this.invokeCalls - 1, this.results.length - 1)]
    if (result === undefined) throw new Error('Fake invoke result is not configured')
    return result
  }

  public streamAgent(invokeArgs: StreamArguments[0], invokeOptions?: StreamArguments[1]): ReturnType<IStrandsAgentRuntime['streamAgent']> { void invokeArgs; void invokeOptions; throw new Error('Fake streamAgent is not configured for this test.') }
  public cancelInvocation(): void {}
  public createAgentTool(agentAsToolOptions?: AgentToolArguments[0]): ReturnType<IStrandsAgentRuntime['createAgentTool']> { void agentAsToolOptions; throw new Error('Fake createAgentTool is not configured for this test.') }
  public isClosed(): boolean { return this.closed }
  public async close(): Promise<void> {
    this.closeCalls += 1
    this.closed = true
    if (this.closeError !== undefined) throw this.closeError
  }
}
