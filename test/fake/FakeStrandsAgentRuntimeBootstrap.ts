import type {
  IStrandsAgentRuntime,
  IStrandsAgentRuntimeBootstrap,
  StrandsAgentRuntimeConfig,
} from '@tjxjnoobie/custom-strands-bridge'

export class FakeStrandsAgentRuntimeBootstrap implements IStrandsAgentRuntimeBootstrap {
  public createCalls = 0
  public lastRuntimeConfig: StrandsAgentRuntimeConfig | undefined
  private readonly agentRuntime: IStrandsAgentRuntime

  public constructor(agentRuntime: IStrandsAgentRuntime) {
    this.agentRuntime = agentRuntime
  }

  public async createAgentRuntime(
    runtimeConfig: StrandsAgentRuntimeConfig,
  ): Promise<IStrandsAgentRuntime> {
    this.createCalls += 1
    this.lastRuntimeConfig = runtimeConfig

    return this.agentRuntime
  }
}
