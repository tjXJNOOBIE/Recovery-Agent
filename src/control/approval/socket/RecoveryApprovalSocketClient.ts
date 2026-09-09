import { request } from 'node:http'

export class RecoveryApprovalSocketClient {
  private readonly socketPath: string
  private readonly approvalToken: string

  public constructor(socketPath: string, approvalToken: string) {
    const normalizedPath = socketPath.trim()
    const normalizedToken = approvalToken.trim()
    if (normalizedPath.length === 0) throw new Error('Recovery approval socket path must be non-blank')
    if (normalizedToken.length === 0) throw new Error('Recovery approval token must be non-blank')
    this.socketPath = normalizedPath
    this.approvalToken = normalizedToken
  }

  public approve(planId: string): Promise<unknown> {
    return this.send(planId, 'approve')
  }

  public reject(planId: string, reason: string): Promise<unknown> {
    const normalizedReason = reason.trim()
    if (normalizedReason.length === 0) throw new Error('Recovery plan rejection reason must be non-blank')
    return this.send(planId, 'reject', { reason: normalizedReason })
  }

  private send(planId: string, action: 'approve' | 'reject', body?: Readonly<Record<string, unknown>>): Promise<unknown> {
    const normalizedPlanId = planId.trim()
    if (normalizedPlanId.length === 0) throw new Error('Recovery plan ID must be non-blank')
    const payload = body === undefined ? '' : JSON.stringify(body)

    return new Promise<unknown>((resolve, reject) => {
      const outgoing = request({
        socketPath: this.socketPath,
        path: `/v1/plans/${encodeURIComponent(normalizedPlanId)}/${action}`,
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.approvalToken}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { responseBody += chunk })
        response.on('end', () => {
          try {
            const parsed = responseBody.length === 0 ? null : JSON.parse(responseBody) as unknown
            if ((response.statusCode ?? 500) >= 400) {
              const message = typeof parsed === 'object' && parsed !== null && 'error' in parsed
                ? String(parsed.error)
                : `Recovery approval request failed with status ${response.statusCode ?? 500}`
              reject(new Error(message))
              return
            }
            resolve(parsed)
          } catch (error: unknown) {
            reject(error)
          }
        })
      })
      outgoing.on('error', reject)
      outgoing.end(payload)
    })
  }
}
