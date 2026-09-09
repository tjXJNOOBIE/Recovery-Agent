import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type {
  IRecoveryStateAuthority,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
} from './RecoveryDurableState.js'
import { RecoveryDurableStateParser } from './RecoveryDurableStateParser.js'

const DEFAULT_RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024
const DEFAULT_CLOSE_TIMEOUT_MS = 5_000

export interface RecoveryStateAuthorityProcessConfig {
  readonly command: string
  readonly args?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly responseLimitBytes?: number
  readonly closeTimeoutMs?: number
}

export class RecoveryStateAuthorityProcessClient implements IRecoveryStateAuthority {
  private readonly child: ChildProcess
  private readonly input: Writable
  private readonly lines: ReadlineInterface
  private readonly parser: RecoveryDurableStateParser
  private readonly responseLimitBytes: number
  private readonly closeTimeoutMs: number
  private operationTail: Promise<void> = Promise.resolve()
  private processError: Error | undefined
  private closing = false
  private closed = false

  private constructor(
    child: ChildProcess,
    input: Writable,
    output: Readable,
    parser: RecoveryDurableStateParser,
    responseLimitBytes: number,
    closeTimeoutMs: number,
  ) {
    this.child = child
    this.input = input
    this.lines = createInterface({ input: output, crlfDelay: Infinity })
    this.parser = parser
    this.responseLimitBytes = responseLimitBytes
    this.closeTimeoutMs = closeTimeoutMs
    this.child.on('error', (error: Error) => {
      this.processError = error
    })
  }

  public static async start(
    config: RecoveryStateAuthorityProcessConfig,
    parser = new RecoveryDurableStateParser(),
  ): Promise<RecoveryStateAuthorityProcessClient> {
    const command = config.command.trim()
    if (command.length === 0) throw new Error('Recovery state authority command must be non-blank')
    const responseLimitBytes = this.positiveSafeInteger(
      config.responseLimitBytes ?? DEFAULT_RESPONSE_LIMIT_BYTES,
      'Recovery state authority response limit',
    )
    const closeTimeoutMs = this.positiveSafeInteger(
      config.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
      'Recovery state authority close timeout',
    )
    const child = spawn(command, [...(config.args ?? [])], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: false,
      env: { ...process.env, ...(config.environment ?? {}) },
    })

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    if (child.stdin === null || child.stdout === null) {
      child.kill('SIGTERM')
      throw new Error('Recovery state authority process did not expose stdin/stdout pipes')
    }

    return new RecoveryStateAuthorityProcessClient(
      child,
      child.stdin,
      child.stdout,
      parser,
      responseLimitBytes,
      closeTimeoutMs,
    )
  }

  public ping(): Promise<boolean> {
    return this.enqueue(async () => {
      const id = randomUUID()
      const response = await this.exchange({ id, operation: 'ping' })
      return this.parser.parsePingResponse(id, response)
    })
  }

  public load(): Promise<RecoveryDurableStateResult> {
    return this.enqueue(async () => {
      const id = randomUUID()
      const response = await this.exchange({ id, operation: 'load' })
      return this.parser.parseStateResponse(id, response)
    })
  }

  public commit(expectedRevision: number, snapshot: RecoveryDurableSnapshot): Promise<RecoveryDurableStateResult> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return Promise.reject(new Error('Recovery durable expected revision must be a non-negative safe integer'))
    }
    const validatedSnapshot = this.parser.parseSnapshot(snapshot)
    return this.enqueue(async () => {
      const id = randomUUID()
      const response = await this.exchange({
        id,
        operation: 'commit',
        expectedRevision,
        snapshot: validatedSnapshot,
      })
      return this.parser.parseStateResponse(id, response)
    })
  }

  public close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.closing) return this.operationTail
    this.closing = true
    return this.enqueue(async () => {
      try {
        await this.closeProcess()
      } finally {
        this.lines.close()
        this.closed = true
      }
    }, true)
  }

  private enqueue<T>(operation: () => Promise<T>, allowClosing = false): Promise<T> {
    if (!allowClosing && (this.closing || this.closed)) {
      return Promise.reject(new Error('Recovery state authority client is closed'))
    }
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }

  private exchange(request: Readonly<Record<string, unknown>>): Promise<string> {
    this.requireRunningProcess()
    const payload = `${JSON.stringify(request)}\n`
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        this.lines.off('line', onLine)
        this.child.off('exit', onExit)
        this.child.off('error', onError)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onLine = (line: string): void => {
        if (settled) return
        if (Buffer.byteLength(line, 'utf8') > this.responseLimitBytes) {
          fail(new Error(`Recovery state authority response exceeded ${this.responseLimitBytes} bytes`))
          return
        }
        settled = true
        cleanup()
        resolve(line)
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        fail(new Error(this.exitMessage(code, signal, 'before producing a response')))
      }
      const onError = (error: Error): void => fail(error)

      this.lines.once('line', onLine)
      this.child.once('exit', onExit)
      this.child.once('error', onError)
      this.input.write(payload, 'utf8', (error?: Error | null) => {
        if (error !== undefined && error !== null) fail(error)
      })
    })
  }

  private closeProcess(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return this.requireSuccessfulExit(this.child.exitCode, this.child.signalCode)
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        this.child.off('exit', onExit)
        this.child.off('error', onError)
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        settled = true
        cleanup()
        this.requireSuccessfulExit(code, signal).then(resolve, reject)
      }
      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        this.child.kill('SIGTERM')
        reject(new Error(`Recovery state authority did not exit within ${this.closeTimeoutMs}ms after stdin closed`))
      }, this.closeTimeoutMs)
      timer.unref()

      this.child.once('exit', onExit)
      this.child.once('error', onError)
      this.input.end()
    })
  }

  private requireSuccessfulExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (code === 0) return Promise.resolve()
    return Promise.reject(new Error(this.exitMessage(code, signal, 'during shutdown')))
  }

  private requireRunningProcess(): void {
    if (this.processError !== undefined) throw this.processError
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      throw new Error(this.exitMessage(this.child.exitCode, this.child.signalCode, 'before request'))
    }
  }

  private exitMessage(code: number | null, signal: NodeJS.Signals | null, phase: string): string {
    return `Recovery state authority exited ${phase}; code=${code === null ? 'null' : code}; signal=${signal ?? 'null'}`
  }

  private static positiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
    return value
  }
}
