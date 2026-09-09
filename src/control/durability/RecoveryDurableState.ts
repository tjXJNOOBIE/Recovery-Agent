import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'
import type { CertificateHealthIncident } from '../watch/certificate/RecoveryCertificateWatchService.js'
import type {
  DeploymentHealthIncident,
  RecoveryDeploymentWatchState,
} from '../watch/deployment/RecoveryDeploymentWatchService.js'
import type { NodeHealthIncident } from '../watch/node/NodeHealthIncident.js'
import type { RecoverySemanticWatchDefinition } from '../watch/semantic/RecoverySemanticWatch.js'

export interface RecoveryDurableRestartAttempt {
  readonly nodeId: string
  readonly serviceId: string
  readonly atMs: number
}

export interface RecoveryDurableAuditEntry {
  readonly id: string
  readonly at: string
  readonly actor: string
  readonly action: string
  readonly summary: string
  readonly nodeId?: string
  readonly serviceId?: string
}

export interface RecoveryDurableWatchState {
  readonly nodeHealthIncidents: readonly NodeHealthIncident[]
  readonly certificateIncidents: readonly CertificateHealthIncident[]
  readonly deploymentStates: readonly RecoveryDeploymentWatchState[]
  readonly deploymentIncidents: readonly DeploymentHealthIncident[]
}

export interface RecoveryDurableSnapshot {
  readonly schemaVersion: 2
  readonly incidents: readonly IncidentRecord[]
  readonly plans: readonly RecoveryPlan[]
  readonly semanticWatches: readonly RecoverySemanticWatchDefinition[]
  readonly restartAttempts: readonly RecoveryDurableRestartAttempt[]
  readonly nodeHealthIncidents: readonly NodeHealthIncident[]
  readonly certificateIncidents: readonly CertificateHealthIncident[]
  readonly deploymentStates: readonly RecoveryDeploymentWatchState[]
  readonly deploymentIncidents: readonly DeploymentHealthIncident[]
  readonly audit: readonly RecoveryDurableAuditEntry[]
}

export interface RecoveryDurableStateResult {
  readonly revision: number
  readonly snapshot: RecoveryDurableSnapshot
}

export interface IRecoveryStateAuthority {
  ping(): Promise<boolean>
  load(): Promise<RecoveryDurableStateResult>
  commit(expectedRevision: number, snapshot: RecoveryDurableSnapshot): Promise<RecoveryDurableStateResult>
  close(): Promise<void>
}
