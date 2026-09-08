import { spawn } from 'node:child_process'

import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { ServiceLifecycleState, ServiceSnapshot } from '../data/ServiceSnapshot.js'
import type { INodeServiceRuntime } from '../runtime/INodeServiceRuntime.js'

export interface SystemdServiceDefinition {
  readonly id: string
  readonly unit: string
}

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface ICommandExecutor {
  execute(command: string, args: readonly string[]): Promise<CommandResult>
}

export class SpawnCommandExecutor implements ICommandExecutor {
  public execute(command: string, args: readonly string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', reject)
      child.once('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }))
    })
  }
}

export class SystemdNodeServiceRuntime implements INodeServiceRuntime {
  public readonly nodeId: string
  private readonly services: readonly SystemdServiceDefinition[]
  private readonly commandExecutor: ICommandExecutor

  public constructor(
    nodeId: string,
    services: readonly SystemdServiceDefinition[],
    commandExecutor: ICommandExecutor = new SpawnCommandExecutor(),
  ) {
    this.nodeId = nodeId
    this.services = [...services]
    this.commandExecutor = commandExecutor
  }

  public async listServices(): Promise<readonly ServiceSnapshot[]> {
    return Promise.all(this.services.map((service) => this.inspectService(service.id)))
  }

  public async inspectService(serviceId: string): Promise<ServiceSnapshot> {
    const definition = this.requireDefinition(serviceId)
    const result = await this.commandExecutor.execute('systemctl', [
      'show', definition.unit, '--no-pager',
      '--property=ActiveState', '--property=SubState', '--property=Result', '--property=NRestarts',
    ])
    const values = this.parseProperties(result.stdout)
    const activeState = values['ActiveState'] ?? 'unknown'
    const subState = values['SubState'] ?? 'unknown'
    const lifecycleState = this.resolveLifecycleState(activeState)
    const restartCount = Number.parseInt(values['NRestarts'] ?? '0', 10)
    return {
      nodeId: this.nodeId,
      serviceId,
      lifecycleState,
      healthy: result.exitCode === 0 && lifecycleState === 'running',
      detail: `${activeState}/${subState}; result=${values['Result'] ?? 'unknown'}`,
      observedAt: new Date().toISOString(),
      restartCount: Number.isFinite(restartCount) ? restartCount : 0,
    }
  }

  public async restartService(serviceId: string): Promise<ServiceActionResult> {
    const definition = this.requireDefinition(serviceId)
    const result = await this.commandExecutor.execute('systemctl', ['restart', definition.unit])
    const snapshot = await this.inspectService(serviceId)
    return {
      accepted: result.exitCode === 0,
      action: 'restart',
      message: result.exitCode === 0 ? `Restarted ${definition.unit}` : result.stderr.trim() || `systemctl exited ${result.exitCode}`,
      snapshot,
    }
  }

  private requireDefinition(serviceId: string): SystemdServiceDefinition {
    const definition = this.services.find((service) => service.id === serviceId)
    if (definition === undefined) {
      throw new Error(`Service ${serviceId} is not configured on node ${this.nodeId}`)
    }
    return definition
  }

  private parseProperties(stdout: string): Readonly<Record<string, string>> {
    return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf('=')
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
    }))
  }

  private resolveLifecycleState(activeState: string): ServiceLifecycleState {
    if (activeState === 'active') return 'running'
    if (activeState === 'inactive') return 'stopped'
    if (activeState === 'failed') return 'failed'
    return 'unknown'
  }
}
