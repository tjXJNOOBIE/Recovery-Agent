export class RecoveryAgentCliInputError extends Error {
  public constructor() {
    super('Recovery Agent requires a non-blank request.')
    this.name = 'RecoveryAgentCliInputError'
  }
}
