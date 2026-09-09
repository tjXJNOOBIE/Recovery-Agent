export interface RecoveryWatchSurface {
  listStates(): unknown
  runAllNow(nowMs?: number): Promise<unknown>
}
