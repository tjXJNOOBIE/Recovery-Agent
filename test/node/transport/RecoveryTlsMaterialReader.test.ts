import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryTlsMaterialReader } from '../../../src/node/transport/RecoveryTlsMaterialReader.js'

function createMaterialFiles(): { readonly directory: string; readonly certificate: string; readonly privateKey: string; readonly authority: string } {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-tls-material-'))
  const certificate = join(directory, 'node.crt')
  const privateKey = join(directory, 'node.key')
  const authority = join(directory, 'ca.crt')
  writeFileSync(certificate, 'certificate')
  writeFileSync(privateKey, 'private-key')
  writeFileSync(authority, 'authority')
  if (process.platform !== 'win32') chmodSync(privateKey, 0o600)
  return { directory, certificate, privateKey, authority }
}

test('loadsFileBackedTlsMaterialFromRegularFiles', () => {
  const files = createMaterialFiles()
  const material = new RecoveryTlsMaterialReader().read({
    certificateFile: files.certificate,
    privateKeyFile: files.privateKey,
    certificateAuthorityFile: files.authority,
  })

  assert.equal(material.certificate.toString(), 'certificate')
  assert.equal(material.privateKey.toString(), 'private-key')
  assert.equal(material.certificateAuthority.toString(), 'authority')
})

test('rejectsGroupOrOtherPrivateKeyPermissionsOnPosix', { skip: process.platform === 'win32' }, () => {
  const files = createMaterialFiles()
  chmodSync(files.privateKey, 0o640)

  assert.throws(() => new RecoveryTlsMaterialReader().read({
    certificateFile: files.certificate,
    privateKeyFile: files.privateKey,
    certificateAuthorityFile: files.authority,
  }), /must not grant group or other permissions/)
})

test('rejectsSymbolicLinkForPrivateKey', { skip: process.platform === 'win32' }, () => {
  const files = createMaterialFiles()
  const linkedKey = join(files.directory, 'linked.key')
  symlinkSync(files.privateKey, linkedKey)

  assert.throws(() => new RecoveryTlsMaterialReader().read({
    certificateFile: files.certificate,
    privateKeyFile: linkedKey,
    certificateAuthorityFile: files.authority,
  }), /must be a regular file and may not be a symbolic link/)
})
