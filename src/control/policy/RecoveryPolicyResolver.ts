import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { RecoveryDecision, ServiceRecoveryPolicy } from './ServiceRecoveryPolicy.js'

export class RecoveryPolicyResolver {
  public resolve(snapshot: ServiceSnapshot, policy: ServiceRecoveryPolicy): RecoveryDecision {
    if (snapshot.lifecycleState === policy.expectedState && snapshot.healthy) {
      return 'healthy'
    }
    if (policy.restartAllowed && policy.maxRestartAttempts > 0 && (snapshot.lifecycleState === 'stopped' || snapshot.lifecycleState === 'failed')) {
      return 'restart'
    }
    if (snapshot.lifecycleState === 'unknown') {
      return 'human'
    }
    return 'investigate'
  }
}
