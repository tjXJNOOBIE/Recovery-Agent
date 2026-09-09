import { RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES } from './RecoveryNodeProtocol.js'

export class RecoveryNodeLineFramer {
  private readonly maximumMessageBytes: number
  private buffered = Buffer.alloc(0)

  public constructor(maximumMessageBytes = RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES) {
    if (!Number.isSafeInteger(maximumMessageBytes) || maximumMessageBytes <= 0) {
      throw new Error('Recovery node protocol maximum message bytes must be a positive safe integer')
    }
    this.maximumMessageBytes = maximumMessageBytes
  }

  public push(chunk: Buffer | Uint8Array): readonly string[] {
    if (chunk.byteLength === 0) return []
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)])
    const lines: string[] = []

    while (true) {
      const newlineIndex = this.buffered.indexOf(0x0a)
      if (newlineIndex < 0) break
      if (newlineIndex > this.maximumMessageBytes) this.throwOversized()
      const lineBytes = this.buffered.subarray(0, newlineIndex)
      this.buffered = this.buffered.subarray(newlineIndex + 1)
      if (lineBytes.byteLength > this.maximumMessageBytes) this.throwOversized()
      lines.push(lineBytes.toString('utf8'))
    }

    if (this.buffered.byteLength > this.maximumMessageBytes) this.throwOversized()
    return lines
  }

  public finish(): void {
    if (this.buffered.byteLength !== 0) {
      throw new Error('Recovery node protocol session closed with an incomplete frame')
    }
  }

  private throwOversized(): never {
    this.buffered = Buffer.alloc(0)
    throw new Error(`Recovery node protocol frame exceeds ${this.maximumMessageBytes} bytes`)
  }
}
