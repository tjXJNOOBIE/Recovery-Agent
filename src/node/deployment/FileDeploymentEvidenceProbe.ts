import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'

import type { DeploymentEvidence, IDeploymentEvidenceProbe } from './DeploymentEvidence.js'

export class FileDeploymentEvidenceProbe implements IDeploymentEvidenceProbe {
  private readonly maxReadBytes: number

  public constructor(maxReadBytes = 4096) {
    if (!Number.isInteger(maxReadBytes) || maxReadBytes <= 0 || maxReadBytes > 65_536) throw new Error('Deployment marker max read bytes must be a positive integer no greater than 65536')
    this.maxReadBytes = maxReadBytes
  }

  public async inspect(markerFile: string): Promise<DeploymentEvidence> {
    const normalized = markerFile.trim()
    if (normalized.length === 0) throw new Error('Deployment marker file must be non-blank')
    try {
      const metadata = await stat(normalized)
      if (!metadata.isFile()) throw new Error('Configured deployment marker is not a regular file')
      const handle = await open(normalized, 'r')
      try {
        const length = Math.min(metadata.size, this.maxReadBytes)
        const buffer = Buffer.alloc(length)
        if (length > 0) await handle.read(buffer, 0, length, 0)
        const marker = createHash('sha256')
          .update(`${metadata.size}:${metadata.mtimeMs}:`)
          .update(buffer)
          .digest('hex')
        return {
          observedAt: new Date().toISOString(),
          available: true,
          marker,
          deployedAt: metadata.mtime.toISOString(),
        }
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      return {
        observedAt: new Date().toISOString(),
        available: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
