import { InMemoryIncidentRepository } from '../control/incident/repository/InMemoryIncidentRepository.js'
import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from '../control/investigation/IRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../control/policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../control/policy/ServiceRecoveryPolicy.js'
import { RecoveryOrchestrator } from '../control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import { HttpNodeAgentGateway } from '../node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../node/http/NodeAgentHttpServer.js'
import { RecoveryMcpToolRouter } from '../mcp/RecoveryMcpToolRouter.js'
import { DemoNodeServiceRuntime } from './runtime/DemoNodeServiceRuntime.js'

class DemoRecoveryInvestigator implements IRecoveryInvestigator {
  public async investigate(request: RecoveryInvestigationRequest): Promise<RecoveryInvestigationResult> {
    return {
      summary: `Simulated investigation: ${request.incident.serviceId} remained unhealthy after ${request.attempts} bounded restart attempt(s); a deployment/config regression is the demo hypothesis.`,
      requiresHuman: true,
    }
  }
}

export interface RecoveryDemoResult {
  readonly label: 'SIMULATED DEMONSTRATION'
  readonly before: unknown
  readonly sweep: unknown
  readonly after: unknown
  readonly incidents: unknown
}

export class RecoveryDemoHandler {
  public async run(): Promise<RecoveryDemoResult> {
    const token = 'demo-recovery-token-0001'
    const nodeRuntime = new DemoNodeServiceRuntime('demo-east', [
      { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
      { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: false },
    ])
    const nodeServer = new NodeAgentHttpServer(nodeRuntime, token)
    const address = await nodeServer.listen()
    const gateway = new HttpNodeAgentGateway('demo-east', address.baseUrl, token)
    const incidents = new InMemoryIncidentRepository()
    const policies: readonly ServiceRecoveryPolicy[] = [
      { nodeId: 'demo-east', serviceId: 'worker', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 2 },
      { nodeId: 'demo-east', serviceId: 'payments', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1 },
    ]
    const control = new RecoveryControlRuntime(
      [gateway],
      policies,
      new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, new DemoRecoveryInvestigator()),
      incidents,
    )
    const tools = new RecoveryMcpToolRouter(control)

    try {
      const before = await tools.callTool('fleet_status')
      const sweep = await tools.callTool('health_sweep')
      const after = await tools.callTool('fleet_status')
      const incidentList = await tools.callTool('incident_list')
      return { label: 'SIMULATED DEMONSTRATION', before, sweep, after, incidents: incidentList }
    } finally {
      await control.close()
      await nodeServer.close()
    }
  }
}
