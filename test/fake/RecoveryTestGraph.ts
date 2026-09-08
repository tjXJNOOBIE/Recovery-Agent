import { ApprovedRecoveryExecutor } from '../../src/control/approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../../src/control/approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../../src/control/approval/RecoveryPlanApprovalHandler.js'
import { RecoveryAutomaticRestartBudget } from '../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import { InMemoryIncidentRepository } from '../../src/control/incident/repository/InMemoryIncidentRepository.js'
import type { IRecoveryInvestigator } from '../../src/control/investigation/IRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../../src/control/policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../../src/control/policy/ServiceRecoveryPolicy.js'
import type { IRecoveryPlanner } from '../../src/control/plan/IRecoveryPlanner.js'
import { InMemoryRecoveryPlanRepository } from '../../src/control/plan/InMemoryRecoveryPlanRepository.js'
import { RecoveryEscalationHandler } from '../../src/control/plan/RecoveryEscalationHandler.js'
import { RecoveryPlanControl } from '../../src/control/plan/RecoveryPlanControl.js'
import { RecoveryOperationGate } from '../../src/control/recovery/RecoveryOperationGate.js'
import { RecoveryOrchestrator } from '../../src/control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../../src/control/runtime/RecoveryControlRuntime.js'
import type { INodeAgentGateway } from '../../src/node/gateway/INodeAgentGateway.js'
import { FakeRecoveryPlanner } from './FakeRecoveryPlanner.js'

export interface RecoveryTestGraph {
  readonly incidents: InMemoryIncidentRepository
  readonly plans: InMemoryRecoveryPlanRepository
  readonly orchestrator: RecoveryOrchestrator
  readonly planControl: RecoveryPlanControl
  readonly control: RecoveryControlRuntime
}

export function buildRecoveryTestGraph(
  gateways: readonly INodeAgentGateway[],
  policies: readonly ServiceRecoveryPolicy[],
  investigator: IRecoveryInvestigator,
  planner: IRecoveryPlanner = new FakeRecoveryPlanner(),
  approvalToken = 'test-approval-token-1234',
  restartBudget: RecoveryAutomaticRestartBudget = new RecoveryAutomaticRestartBudget(),
): RecoveryTestGraph {
  const incidents = new InMemoryIncidentRepository()
  const plans = new InMemoryRecoveryPlanRepository()
  const escalation = new RecoveryEscalationHandler(incidents, investigator, planner, plans)
  const orchestrator = new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, escalation, restartBudget)
  const planControl = new RecoveryPlanControl(
    plans,
    new RecoveryPlanApprovalHandler(
      plans,
      incidents,
      new RecoveryApprovalVerifier(approvalToken),
      new ApprovedRecoveryExecutor(gateways, policies),
    ),
  )
  const control = new RecoveryControlRuntime(gateways, policies, orchestrator, incidents, planControl, new RecoveryOperationGate())
  return { incidents, plans, orchestrator, planControl, control }
}
