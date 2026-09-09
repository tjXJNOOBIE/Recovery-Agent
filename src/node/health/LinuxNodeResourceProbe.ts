import { readFile, statfs } from 'node:fs/promises'
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os'

import type { NodeResourceSnapshot } from '../data/NodeResourceSnapshot.js'
import type { INodeResourceProbe } from './INodeResourceProbe.js'

export class LinuxNodeResourceProbe implements INodeResourceProbe {
  private readonly rootFilesystemPath: string

  public constructor(rootFilesystemPath = '/') {
    const normalized = rootFilesystemPath.trim()
    if (normalized.length === 0) throw new Error('Root filesystem probe path must be non-blank')
    this.rootFilesystemPath = normalized
  }

  public async inspect(): Promise<NodeResourceSnapshot> {
    const [memoryInfo, filesystem, rootFilesystemReadOnly] = await Promise.all([
      this.readMemoryInfo(),
      statfs(this.rootFilesystemPath),
      this.readRootFilesystemReadOnly(),
    ])
    const cpuCount = Math.max(1, cpus().length)
    const memoryTotalBytes = memoryInfo['MemTotal'] ?? totalmem()
    const memoryAvailableBytes = memoryInfo['MemAvailable'] ?? freemem()
    const swapTotalBytes = memoryInfo['SwapTotal'] ?? 0
    const swapFreeBytes = memoryInfo['SwapFree'] ?? 0
    const rootFilesystemTotalBytes = filesystem.blocks * filesystem.bsize
    const rootFilesystemAvailableBytes = filesystem.bavail * filesystem.bsize
    const inodeEvidence = this.inodeEvidence(filesystem.files, filesystem.ffree)

    return {
      observedAt: new Date().toISOString(),
      uptimeSeconds: this.round(uptime()),
      loadAverage1mPerCpu: this.round((loadavg()[0] ?? 0) / cpuCount),
      memoryTotalBytes,
      memoryAvailableBytes,
      memoryUsedPercent: this.usedPercent(memoryTotalBytes, memoryAvailableBytes),
      swapTotalBytes,
      swapFreeBytes,
      swapUsedPercent: this.usedPercent(swapTotalBytes, swapFreeBytes),
      rootFilesystemTotalBytes,
      rootFilesystemAvailableBytes,
      rootFilesystemUsedPercent: this.usedPercent(rootFilesystemTotalBytes, rootFilesystemAvailableBytes),
      ...inodeEvidence,
      ...(rootFilesystemReadOnly === undefined ? {} : { rootFilesystemReadOnly }),
    }
  }

  private async readMemoryInfo(): Promise<Readonly<Record<string, number>>> {
    try {
      const content = await readFile('/proc/meminfo', 'utf8')
      return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
        const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB$/.exec(line.trim())
        if (match === null) return []
        const key = match[1]
        const value = match[2]
        if (key === undefined || value === undefined) return []
        return [[key, Number.parseInt(value, 10) * 1024] as const]
      }))
    } catch {
      return {}
    }
  }

  private async readRootFilesystemReadOnly(): Promise<boolean | undefined> {
    if (this.rootFilesystemPath !== '/') return undefined
    try {
      const content = await readFile('/proc/self/mountinfo', 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const fields = line.trim().split(' ')
        if (fields[4] !== '/') continue
        const separator = fields.indexOf('-')
        const mountOptions = fields[5]?.split(',') ?? []
        const superOptions = separator >= 0 ? (fields[separator + 3]?.split(',') ?? []) : []
        if (mountOptions.includes('ro') || superOptions.includes('ro')) return true
        if (mountOptions.includes('rw') || superOptions.includes('rw')) return false
        return undefined
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private inodeEvidence(
    total: number,
    available: number,
  ): Pick<NodeResourceSnapshot, 'rootFilesystemTotalInodes' | 'rootFilesystemAvailableInodes' | 'rootFilesystemInodeUsedPercent'> | {} {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(available)) return {}
    return {
      rootFilesystemTotalInodes: total,
      rootFilesystemAvailableInodes: Math.max(0, available),
      rootFilesystemInodeUsedPercent: this.usedPercent(total, available),
    }
  }

  private usedPercent(total: number, available: number): number {
    if (!Number.isFinite(total) || total <= 0) return 0
    const clampedAvailable = Math.min(total, Math.max(0, available))
    return this.round(((total - clampedAvailable) / total) * 100)
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100
  }
}
