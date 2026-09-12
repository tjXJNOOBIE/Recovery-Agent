import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'build', 'install', 'recovery-agent')
const target = resolve(root, 'runtime')

const configuredGradle = process.env.TAVALL_GRADLE_COMMAND?.trim()
const gradle = configuredGradle || (existsSync(resolve(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
  ? resolve(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
  : 'gradle')
const extraGradleArguments = (process.env.TAVALL_GRADLE_ARGUMENTS ?? '').trim().split(/\s+/).filter(Boolean)
const result = spawnSync(gradle, [...extraGradleArguments, '--no-daemon', 'installDist'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Recovery Agent Java distribution failed with exit code ${result.status}`)
if (!existsSync(source)) throw new Error(`Expected Java distribution is missing: ${source}`)

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })

const entries = []
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Runtime distribution may not contain symbolic links: ${path}`)
    if (entry.isDirectory()) {
      visit(path)
      continue
    }
    if (!entry.isFile()) throw new Error(`Unsupported runtime filesystem entry: ${path}`)
    const bytes = readFileSync(path)
    const relativePath = relative(target, path).split('\\').join('/')
    entries.push({ path: relativePath, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
}
visit(target)
entries.sort((left, right) => left.path.localeCompare(right.path))
const tree = createHash('sha256')
for (const entry of entries) tree.update(`${entry.path}\0${entry.sha256}\n`)

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
writeFileSync(resolve(root, 'runtime-manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  product: '@tjxjnoobie/recovery-agent',
  packageVersion: packageJson.version,
  distribution: 'recovery-agent',
  launchers: ['recovery-agent'],
  treeSha256: tree.digest('hex'),
  files: entries,
}, null, 2)}\n`)
console.log(`Packaged Recovery Agent Java runtime: ${entries.length} files, ${entries.reduce((sum, entry) => sum + entry.bytes, 0)} bytes`)
