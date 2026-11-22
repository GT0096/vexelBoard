import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '..')

test('package.json specifies structured author identity and Windows certificate helper script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(typeof pkg.author, 'object')
  assert.equal(pkg.author.name, 'Vexelboard')
  assert.ok(pkg.scripts['cert:win'] && pkg.scripts['cert:win'].includes('generate-dev-cert.ps1'))
})

test('electron-builder.yml configures Windows Authenticode and macOS Hardened Runtime / notarization hooks', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
  assert.ok(yml.includes('afterPack: scripts/afterPack-mac.cjs'))
  assert.ok(yml.includes('afterSign: scripts/notarize-mac.cjs'))
  assert.ok(yml.includes('hardenedRuntime: true'))
  assert.equal(yml.includes('notarize: false'), false)
  assert.ok(/\bsign:\s*false\b/.test(yml))

  assert.ok(yml.includes('requestedExecutionLevel: asInvoker'))
  assert.ok(yml.includes('signtoolOptions:'))
  assert.ok(yml.includes('publisherName:'))
  assert.ok(yml.includes('signingHashAlgorithms:'))
  assert.ok(yml.includes('rfc3161TimeStampServer:'))
  assert.ok(yml.includes('signAndEditExecutable: true'))
})

test('build/entitlements.mac.plist includes Hardened Runtime entitlements required by Electron & native SQLite addons', () => {
  const plist = fs.readFileSync(path.join(ROOT, 'build', 'entitlements.mac.plist'), 'utf8')
  for (const key of [
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.allow-dyld-environment-variables',
    'com.apple.security.cs.disable-library-validation',
    'com.apple.security.network.client',
    'com.apple.security.files.user-selected.read-write',
    'com.apple.security.device.camera',
    'com.apple.security.device.audio-input'
  ]) {
    assert.ok(plist.includes(`<key>${key}</key>`), `Missing entitlement ${key}`)
  }
})

test('afterPack-mac and notarize-mac export async hooks that safely no-op outside macOS or without credentials', async () => {
  const afterPackMod = require(path.join(ROOT, 'scripts', 'afterPack-mac.cjs'))
  const notarizeMod = require(path.join(ROOT, 'scripts', 'notarize-mac.cjs'))

  assert.equal(typeof afterPackMod.default, 'function')
  assert.equal(typeof notarizeMod.default, 'function')

  // Verify empty-string GitHub Secret env vars are stripped so app-builder-lib never resolves "" as projectDir
  const prevCsc = process.env.CSC_LINK
  const prevPwd = process.env.CSC_KEY_PASSWORD
  const prevAppleId = process.env.APPLE_ID
  process.env.CSC_LINK = ''
  process.env.CSC_KEY_PASSWORD = '   '
  delete process.env.APPLE_ID
  try {
    await afterPackMod.default({ electronPlatformName: 'win32', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })
    assert.equal('CSC_LINK' in process.env, false)
    assert.equal('CSC_KEY_PASSWORD' in process.env, false)

    await notarizeMod.default({ electronPlatformName: 'win32', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })

    process.env.CSC_LINK = ''
    await notarizeMod.default({ electronPlatformName: 'darwin', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })
    assert.equal('CSC_LINK' in process.env, false)
  } finally {
    if (prevCsc !== undefined) process.env.CSC_LINK = prevCsc
    else delete process.env.CSC_LINK
    if (prevPwd !== undefined) process.env.CSC_KEY_PASSWORD = prevPwd
    else delete process.env.CSC_KEY_PASSWORD
    if (prevAppleId !== undefined) process.env.APPLE_ID = prevAppleId
    else delete process.env.APPLE_ID
  }

  // Verify PowerShell cert helper & CI workflow reference expected security vars & empty-var unset guard
  const ps1 = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-dev-cert.ps1'), 'utf8')
  assert.ok(ps1.includes('New-SelfSignedCertificate'))
  assert.ok(ps1.includes('CodeSigningCert'))

  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
  assert.ok(workflow.includes('WIN_CSC_LINK'))
  assert.ok(workflow.includes('APPLE_API_KEY'))
  assert.ok(workflow.includes('unset "$var"'))
  assert.ok(workflow.includes('codesign --verify --deep --strict'))
})
