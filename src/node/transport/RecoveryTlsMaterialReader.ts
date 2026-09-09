import { lstatSync, readFileSync } from 'node:fs'

export interface RecoveryTlsMaterialPaths {
  readonly certificateFile: string
  readonly privateKeyFile: string
  readonly certificateAuthorityFile: string
}

export interface RecoveryTlsMaterial {
  readonly certificate: Buffer
  readonly privateKey: Buffer
  readonly certificateAuthority: Buffer
}

export class RecoveryTlsMaterialReader {
  public read(paths: RecoveryTlsMaterialPaths): RecoveryTlsMaterial {
    return {
      certificate: this.readRegularFile(paths.certificateFile, 'Recovery TLS certificate'),
      privateKey: this.readPrivateKey(paths.privateKeyFile),
      certificateAuthority: this.readRegularFile(paths.certificateAuthorityFile, 'Recovery TLS certificate authority'),
    }
  }

  private readPrivateKey(path: string): Buffer {
    const stat = this.requireRegularFile(path, 'Recovery TLS private key')
    if (process.platform !== 'win32') {
      if ((stat.mode & 0o077) !== 0) throw new Error(`Recovery TLS private key ${path} must not grant group or other permissions`)
      if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
        throw new Error(`Recovery TLS private key ${path} must be owned by the Recovery Agent process user`)
      }
    }
    return readFileSync(path)
  }

  private readRegularFile(path: string, label: string): Buffer {
    this.requireRegularFile(path, label)
    return readFileSync(path)
  }

  private requireRegularFile(path: string, label: string): ReturnType<typeof lstatSync> {
    const normalized = path.trim()
    if (normalized.length === 0) throw new Error(`${label} path must be non-blank`)
    const stat = lstatSync(normalized)
    if (!stat.isFile()) throw new Error(`${label} ${normalized} must be a regular file and may not be a symbolic link`)
    return stat
  }
}
