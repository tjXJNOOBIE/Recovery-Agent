#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = resolve(root, 'runtime')
const manifestPath = resolve(root, 'runtime-manifest.json')
const bridgePackage = '@tjxjnoobie/strands-bridge'
const nodeEnvironment = 'RECOVERY_AGENT_STRANDS_NODE'
const entrypointEnvironment = 'RECOVERY_AGENT_STRANDS_ENTRYPOINT'

const runtimeFiles = (directory) => {
  const result = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Packaged runtime contains an unexpected symbolic link: ${path}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) result.push(path)
      else throw new Error(`Packaged runtime contains an unsupported entry: ${path}`)
    }
  }
  visit(directory)
  return result
}

const resolveBridgeEntrypoint = () => {
  const override = process.env[entrypointEnvironment]?.trim()
  if (override) return resolve(override)
  const moduleEntry = fileURLToPath(import.meta.resolve(bridgePackage))
  const candidate = resolve(dirname(moduleEntry), 'mcp', 'main.js')
  if (!existsSync(candidate)) throw new Error(`Installed ${bridgePackage} is missing its MCP entrypoint: ${candidate}`)
  return candidate
}

const assertPackage = () => {
  if (!existsSync(runtime) || !existsSync(manifestPath)) throw new Error('Java runtime bundle is missing; install a published Recovery Agent package or build the release package with npm pack.')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.product !== '@tjxjnoobie/recovery-agent') throw new Error('Recovery Agent runtime manifest has the wrong product identity.')
  const actual = runtimeFiles(runtime).map((path) => {
    const bytes = readFileSync(path)
    return { path: relative(runtime, path).split('\\').join('/'), bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  }).sort((left, right) => left.path.localeCompare(right.path))
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Recovery Agent runtime integrity verification failed.')
  const tree = createHash('sha256')
  for (const entry of actual) tree.update(`${entry.path}\0${entry.sha256}\n`)
  if (tree.digest('hex') !== manifest.treeSha256) throw new Error('Recovery Agent runtime tree verification failed.')
  return manifest
}

const javaExecutable = () => process.env.JAVA_HOME?.trim()
  ? resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java'

const assertJava = () => {
  const result = spawnSync(javaExecutable(), ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Java 25 or newer is required to run the Java Recovery Agent backend.')
  const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/version\s+"?(\d+)/i)?.[1]
  if (!version || Number(version) < 25) throw new Error(`Java 25 or newer is required; detected Java ${version ?? 'unknown'}.`)
}

const doctor = () => {
  const manifest = assertPackage()
  assertJava()
  const bridge = resolveBridgeEntrypoint()
  console.log('Recovery Agent doctor: PASS')
  console.log(`Java backend: ${manifest.packageVersion} bundled distribution verified`)
  console.log(`Strands bridge: ${bridge} resolved from ${bridgePackage}`)
  console.log('MCP: Java backend launcher available; configure a control file for HTTP/stdio use')
  console.log('Secrets/providers: not inspected by the package doctor')
}

const launch = (args) => {
  assertPackage()
  assertJava()
  const bridge = resolveBridgeEntrypoint()
  const invokedAs = basename(process.argv[1] ?? 'recovery-agent')
  const executableName = invokedAs.endsWith('.cmd') || invokedAs.endsWith('.bat') ? invokedAs.slice(0, -4) : invokedAs
  const backendName = executableName === 'recovery-agent' ? 'recovery-agent' : 'recovery-agent'
  const backend = resolve(runtime, 'bin', `${backendName}${process.platform === 'win32' ? '.bat' : ''}`)
  if (!existsSync(backend)) throw new Error(`Bundled Java launcher is missing: ${backend}`)
  const environment = { ...process.env }
  if (!environment[nodeEnvironment]) environment[nodeEnvironment] = process.execPath
  if (!environment[entrypointEnvironment]) environment[entrypointEnvironment] = bridge
  const child = spawn(backend, args, { cwd: process.cwd(), env: environment, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: false })
  const forward = (signal) => { if (!child.killed) child.kill(signal) }
  process.once('SIGINT', () => forward('SIGINT'))
  process.once('SIGTERM', () => forward('SIGTERM'))
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1 })
}

const args = process.argv.slice(2)
if (args[0] === 'doctor') doctor()
else launch(args)
