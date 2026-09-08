import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryControlConfigReader, type RecoveryApprovalPrincipalConfig } from '../../../src/config/RecoveryControlConfig.js'
import { ApprovedRecoveryExecutor } from '../../../src/control/approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../../../src/control/approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../../../src/control/approval/RecoveryPlanApprovalHandler.js'
import type { IRecoveryDurabilityCheckpoint } from '../../../src/control/durability/RecoveryDurabilityCheckpointBarrier.js'
import type { RecoveryDurableAuditRequest } from '../../../src/control/durability/RecoveryDurableStateCoordinator.js'
import { RecoveryIncidentRuntimeState } from '../../../src/control/incident/runtime/RecoveryIncidentRuntimeState.js'
import { RecoveryPlanRuntimeState } from '../../../src/control/plan/runtime/RecoveryPlanRuntimeState.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'

const ACTIVE_PRINCIPAL: RecoveryApprovalPrincipalConfig = { id: 'tj', tokenEnvironmentVariable: 'RECOVERY_APPROVAL_TOKEN_TJ', revoked: false, expiresAt: '2026-09-09T00:00:00.000Z' }
const NOW_MS = Date.parse('2026-09-08T22:00:00.000Z')
const SECRET = 'principal-secret-1234567890'
const LEGACY_SECRET = 'legacy-secret-123456789000'
const healthySnapshot = { nodeId: 'east', serviceId: 'payments', lifecycleState: 'running' as const, healthy: true, detail: 'healthy', observedAt: '2026-09-08T22:00:00.000Z', restartCount: 1 }

class RecordingCheckpoint implements IRecoveryDurabilityCheckpoint {
  public readonly requests: RecoveryDurableAuditRequest[] = []
  public assertMutationAllowed(): void {}
  public async checkpoint(request: RecoveryDurableAuditRequest): Promise<void> { this.requests.push(request) }
}

test('namedPrincipalAuthenticatesIdentityAndLegacySecretCannotBypassPrincipalMode', () => {
  const verifier = RecoveryApprovalVerifier.fromConfig([ACTIVE_PRINCIPAL], { RECOVERY_APPROVAL_TOKEN_TJ: SECRET }, LEGACY_SECRET, () => NOW_MS)
  assert.deepEqual(verifier.verify(`tj:${SECRET}`), { actor: 'tj', mode: 'principal' })
  assert.throws(() => verifier.verify(LEGACY_SECRET), /principal-id:secret/)
  assert.throws(() => verifier.verify(`other:${SECRET}`), /Unknown Recovery approval principal/)
  assert.throws(() => verifier.verify('tj:wrong-secret-1234567890'), /token is invalid/)
})

test('revokedExpiredAndMissingPrincipalCredentialsFailClosed', () => {
  const revoked = RecoveryApprovalVerifier.fromConfig([{ ...ACTIVE_PRINCIPAL, revoked: true }], {}, undefined, () => NOW_MS)
  assert.throws(() => revoked.verify('tj:any-secret-value-123456'), /revoked/)
  const expired = RecoveryApprovalVerifier.fromConfig([{ ...ACTIVE_PRINCIPAL, expiresAt: '2026-09-08T21:00:00.000Z' }], {}, undefined, () => NOW_MS)
  assert.throws(() => expired.verify('tj:any-secret-value-123456'), /expired/)
  assert.throws(() => RecoveryApprovalVerifier.fromConfig([ACTIVE_PRINCIPAL], {}, undefined, () => NOW_MS), /must contain an approval token of at least 16 characters/)
})

test('approvedMutationWriteAheadAuditUsesAuthenticatedPrincipalIdentity', async () => {
  const incidentState = new RecoveryIncidentRuntimeState()
  let incident = incidentState.open('east', 'payments', 'unhealthy')
  incident = incidentState.append(incident.id, 'plan_proposed', 'elevated restart proposed', 'approval_required')
  const planState = new RecoveryPlanRuntimeState()
  const plan = planState.create({ incidentId: incident.id, nodeId: 'east', serviceId: 'payments', rationale: 'one bounded restart' })

  const gateway: INodeAgentGateway = {
    nodeId: 'east',
    inspectNode: async () => ({ nodeId: 'east', observedAt: healthySnapshot.observedAt, services: [healthySnapshot] }),
    inspectService: async () => healthySnapshot,
    restartService: async () => ({ accepted: true, action: 'restart', message: 'restart accepted', snapshot: healthySnapshot }),
    close: async () => {},
  }
  const checkpoint = new RecordingCheckpoint()
  const handler = new RecoveryPlanApprovalHandler(
    planState,
    incidentState,
    RecoveryApprovalVerifier.fromConfig([ACTIVE_PRINCIPAL], { RECOVERY_APPROVAL_TOKEN_TJ: SECRET }, undefined, () => NOW_MS),
    new ApprovedRecoveryExecutor([gateway], [{ nodeId: 'east', serviceId: 'payments', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1, dependencies: [] }]),
    checkpoint,
  )

  const result = await handler.approveAndExecute(plan.id, `tj:${SECRET}`)
  assert.equal(result.approvedBy, 'tj')
  assert.equal(checkpoint.requests[0]?.actor, 'tj')
  assert.equal(checkpoint.requests[0]?.action, 'approved_restart_intent')
  assert.match(result.incident.timeline.find((entry) => entry.kind === 'approval')?.message ?? '', /from tj/)
})

test('controlConfigParsesUniqueRevocableApprovalPrincipalsWithoutSecrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-principal-config-'))
  const path = join(directory, 'control.json')
  writeFileSync(path, JSON.stringify({
    nodes: [{ id: 'east', baseUrl: 'http://127.0.0.1:7281', tokenEnvironmentVariable: 'NODE_TOKEN', services: [{ id: 'payments', restartAllowed: true, maxRestartAttempts: 1 }] }],
    approvalPrincipals: [
      { id: 'tj', tokenEnvironmentVariable: 'RECOVERY_APPROVAL_TOKEN_TJ', expiresAt: '2026-09-09T00:00:00Z' },
      { id: 'backup-operator', tokenEnvironmentVariable: 'RECOVERY_APPROVAL_TOKEN_BACKUP', revoked: true },
    ],
  }))
  const principals = new RecoveryControlConfigReader().read(path).approvalPrincipals
  assert.deepEqual(principals, [
    { id: 'tj', tokenEnvironmentVariable: 'RECOVERY_APPROVAL_TOKEN_TJ', revoked: false, expiresAt: '2026-09-09T00:00:00.000Z' },
    { id: 'backup-operator', tokenEnvironmentVariable: 'RECOVERY_APPROVAL_TOKEN_BACKUP', revoked: true },
  ])
})
