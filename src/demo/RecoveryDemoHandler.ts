import { ApprovedRecoveryExecutor } from '../control/approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../control/approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../control/approval/RecoveryPlanApprovalHandler.js'
import { RecoveryAutomaticRestartBudget } from '../control/budget/RecoveryAutomaticRestartBudget.js'
import { RecoveryIncidentRuntimeState } from '../control/incident/runtime/RecoveryIncidentRuntimeState.js'
import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from '../control/investigation/IRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../control/policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../control/policy/ServiceRecoveryPolicy.js'
import type { IRecoveryPlanner, RecoveryPlanningRequest } from '../control/plan/IRecoveryPlanner.js'
import { RecoveryEscalationHandler } from '../control/plan/RecoveryEscalationHandler.js'
import { RecoveryPlanControl } from '../control/plan/RecoveryPlanControl.js'
import type { RecoveryPlanProposal } from '../control/plan/RecoveryPlan.js'
import { RecoveryPlanRuntimeState } from '../control/plan/runtime/RecoveryPlanRuntimeState.js'
import { RecoveryOperationGate } from '../control/recovery/RecoveryOperationGate.js'
import { RecoveryOrchestrator } from '../control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import { RecoveryWatchCoordinator } from '../control/watch/RecoveryWatchCoordinator.js'
import type { RecoveryWatchDefinition } from '../control/watch/RecoveryWatchDefinition.js'
import { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'
import { DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS } from '../control/watch/node/RecoveryNodeWatchDefinition.js'
import { RecoveryNodeWatchService } from '../control/watch/node/RecoveryNodeWatchService.js'
import { RecoveryMcpToolRouter } from '../mcp/RecoveryMcpToolRouter.js'
import type { NodeResourceSnapshot } from '../node/data/NodeResourceSnapshot.js'
import { HttpNodeAgentGateway } from '../node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../node/http/NodeAgentHttpServer.js'
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

const DEMO_NODE_RESOURCES: NodeResourceSnapshot = {
  observedAt: '2026-09-08T00:00:00.000Z',
  uptimeSeconds: 3600,
  loadAverage1mPerCpu: 0.35,
  memoryTotalBytes: 8_589_934_592,
  memoryAvailableBytes: 5_368_709_120,
  memoryUsedPercent: 37.5,
  swapTotalBytes: 2_147_483_648,
  swapFreeBytes: 2_147_483_648,
  swapUsedPercent: 0,
  rootFilesystemTotalBytes: 107_374_182_400,
  rootFilesystemAvailableBytes: 64_424_509_440,
  rootFilesystemUsedPercent: 40,
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
    const nodeServer = new NodeAgentHttpServer(nodeRuntime, token, { inspect: async () => DEMO_NODE_RESOURCES })
    const address = await nodeServer.listen()
    const gateway = new HttpNodeAgentGateway('demo-east', address.baseUrl, token)
    const incidentState = new RecoveryIncidentRuntimeState()
    const planState = new RecoveryPlanRuntimeState()
    const policies: readonly ServiceRecoveryPolicy[] = [
      { nodeId: 'demo-east', serviceId: 'worker', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 2, restartBudgetWindowMs: 600_000 },
      { nodeId: 'demo-east', serviceId: 'payments', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1, restartBudgetWindowMs: 600_000 },
    ]
    const escalationHandler = new RecoveryEscalationHandler(
      incidentState,
      new DemoRecoveryInvestigator(),
      new DemoRecoveryPlanner(),
      planState,
    )
    const planControl = new RecoveryPlanControl(
      planState,
      new RecoveryPlanApprovalHandler(
        planState,
        incidentState,
        new RecoveryApprovalVerifier('demo-approval-token-0001'),
        new ApprovedRecoveryExecutor([gateway], policies),
      ),
    )
    const control = new RecoveryControlRuntime(
      [gateway],
      policies,
      new RecoveryOrchestrator(
        new RecoveryPolicyResolver(),
        incidentState,
        escalationHandler,
        new RecoveryAutomaticRestartBudget(),
      ),
      incidentState,
      planControl,
      new RecoveryOperationGate(),
    )
    const watchDefinitions: readonly RecoveryWatchDefinition[] = policies.map((policy) => ({
      nodeId: policy.nodeId,
      serviceId: policy.serviceId,
      intervalMs: 30_000,
    }))
    const serviceWatches = new RecoveryWatchService(control, watchDefinitions)
    const nodeWatches = new RecoveryNodeWatchService(control, [{
      nodeId: 'demo-east',
      intervalMs: 30_000,
      thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
    }])
    const watches = new RecoveryWatchCoordinator(serviceWatches, nodeWatches)
    const tools = new RecoveryMcpToolRouter(control, watches)

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
      await watches.close()
      await control.close()
      await nodeServer.close()
    }
  }
}
