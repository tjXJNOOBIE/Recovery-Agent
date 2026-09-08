export interface NodeResourceSnapshot {
  readonly observedAt: string
  readonly uptimeSeconds: number
  readonly loadAverage1mPerCpu: number
  readonly memoryTotalBytes: number
  readonly memoryAvailableBytes: number
  readonly memoryUsedPercent: number
  readonly swapTotalBytes: number
  readonly swapFreeBytes: number
  readonly swapUsedPercent: number
  readonly rootFilesystemTotalBytes: number
  readonly rootFilesystemAvailableBytes: number
  readonly rootFilesystemUsedPercent: number
  readonly rootFilesystemTotalInodes?: number
  readonly rootFilesystemAvailableInodes?: number
  readonly rootFilesystemInodeUsedPercent?: number
  readonly rootFilesystemReadOnly?: boolean
}
