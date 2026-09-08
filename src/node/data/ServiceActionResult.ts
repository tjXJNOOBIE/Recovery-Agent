import type { ServiceSnapshot } from './ServiceSnapshot.js'

export interface ServiceActionResult {
  readonly accepted: boolean
  readonly action: 'restart'
  readonly message: string
  readonly snapshot: ServiceSnapshot
}
