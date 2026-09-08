import { ApprovedRecoveryExecutor } from '../control/approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../control/approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../control/approval/RecoveryPlanApprovalHandler.js'
import { InMemoryIncidentRepository } from '../control/incident/repository/InMemoryIncidentRepository.js'
import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from '../control/investigation/IRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../control/policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../control/policy/ServiceRecoveryPolicy.js'
import type { IRecoveryPlanner, RecoveryPlanningRequest } from '../control/plan/IRecoveryPlanner.js'
import { InMemoryRecoveryPlanRepository } from '../control/plan/InMemoryRecoveryPlanRepository.js'
import { RecoveryEscalationHandler } from '../control/plan/RecoveryEscalationHandler.js'
import { RecoveryPlanControl } from '../control/plan/RecoveryPlanControl.js'
import type { RecoveryPlanProposal } from '../control/plan/RecoveryPlan.js'
import { RecoveryOrchestrator } from '../control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import type { RecoveryWatchDefinition } from '../control/watch/RecoveryWatchDefinition.js'
import { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'
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

class DemoRecoveryPlanner implements IRecoveryPlanner {
  public async plan(_request: RecoveryPlanningRequest): Promise<RecoveryPlanProposal> {
    return {
      action: 'restart_service',
      rationale: 'Simulated proposal: one additional operator-approved restart could test whether the failure is transient.',
    }
  }
}

export interface RecoveryDemoResult {
  readonly label: 'SIMULATED DEMONSTRATION'
  readonly before: unknown
  readonly sweep: unknown
  readonly after: unknown
  readonly watches: unknown
  readonly incidents: unknown
  readonly plans: unknown
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
    const plans = new InMemoryRecoveryPlanRepository()
    const policies: readonly ServiceRecoveryPolicy[] = [
      { nodeId: 'demo-east', serviceId: 'worker', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 2 },
      { nodeId: 'demo-east', serviceId: 'payments', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1 },
    ]
    const escalationHandler = new RecoveryEscalationHandler(
      incidents,
      new DemoRecoveryInvestigator(),
      new DemoRecoveryPlanner(),
      plans,
    )
    const planControl = new RecoveryPlanControl(
      plans,
      new RecoveryPlanApprovalHandler(
        plans,
        incidents,
        new RecoveryApprovalVerifier('demo-approval-token-0001'),
        new ApprovedRecoveryExecutor([gateway], policies),
      ),
    )
    const control = new RecoveryControlRuntime(
      [gateway],
      policies,
      new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, escalationHandler),
      incidents,
      planControl,
    )
    const watchDefinitions: readonly RecoveryWatchDefinition[] = policies.map((policy) => ({
      nodeId: policy.nodeId,
      serviceId: policy.serviceId,
      intervalMs: 30_000,
    }))
    const watchService = new RecoveryWatchService(control, watchDefinitions)
    const tools = new RecoveryMcpToolRouter(control, watchService)

    try {
      const before = await tools.callTool('fleet_status')
      const sweep = await tools.callTool('watch_run')
      const after = await tools.callTool('fleet_status')
      const watchStates = await tools.callTool('watch_list')
      const incidentList = await tools.callTool('incident_list')
      const planList = await tools.callTool('recovery_plan_list')
      return {
        label: 'SIMULATED DEMONSTRATION',
        before,
        sweep,
        after,
        watches: watchStates,
        incidents: incidentList,
        plans: planList,
      }
    } finally {
      await watchService.close()
      await control.close()
      await nodeServer.close()
    }
  }
}
