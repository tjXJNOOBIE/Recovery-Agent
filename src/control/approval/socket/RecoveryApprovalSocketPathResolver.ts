import { tmpdir } from 'node:os'
import { join } from 'node:path'

export class RecoveryApprovalSocketPathResolver {
  public resolve(environment: Readonly<Record<string, string | undefined>> = process.env): string {
    const configured = environment['RECOVERY_APPROVAL_SOCKET']?.trim()
    if (configured !== undefined && configured.length > 0) {
      return configured
    }

    if (typeof process.getuid !== 'function') {
      throw new Error('Recovery approval socket requires a Unix-like control host or RECOVERY_APPROVAL_SOCKET')
    }

    return join(tmpdir(), `recovery-agent-${process.getuid()}.sock`)
  }
}
