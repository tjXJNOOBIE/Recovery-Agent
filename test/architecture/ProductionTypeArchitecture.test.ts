import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import test from 'node:test'

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && extname(entry.name) === '.ts' ? [path] : []
  })
}

test('productionTypesDoNotDeclareRepositoryArchitecture', () => {
  const sourceRoot = resolve(process.cwd(), 'src')
  const violations: string[] = []
  const declarationPattern = /\b(?:class|interface|type|enum)\s+([A-Za-z_$][\w$]*Repository)\b/g

  for (const path of sourceFiles(sourceRoot)) {
    const displayPath = relative(process.cwd(), path)
    if (/Repository\.ts$/.test(basename(path))) {
      violations.push(`${displayPath}: production filename ends in Repository`)
    }

    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(declarationPattern)) {
      violations.push(`${displayPath}: production declaration ${match[1] ?? '<unknown>'} ends in Repository`)
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Recovery Agent must consume owning persistence/state capabilities instead of declaring Tavall-owned Repository production types:\n${violations.join('\n')}`,
  )
})
