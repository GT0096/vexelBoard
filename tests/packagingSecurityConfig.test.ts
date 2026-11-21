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
  assert.equal(/\bsign:\s*false\b/.test(yml), false)

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

  // Non-darwin platform should no-op cleanly
  await afterPackMod.default({ electronPlatformName: 'win32', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })
  await notarizeMod.default({ electronPlatformName: 'win32', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })

  // Darwin without CSC_LINK / Apple credentials should safely skip notarization without throwing
  const prevCsc = process.env.CSC_LINK
  const prevAppleId = process.env.APPLE_ID
  delete process.env.CSC_LINK
  delete process.env.APPLE_ID
  try {
    await notarizeMod.default({ electronPlatformName: 'darwin', appOutDir: ROOT, packager: { appInfo: { productFilename: 'Vexelboard' } } })
  } finally {
    if (prevCsc !== undefined) process.env.CSC_LINK = prevCsc
    if (prevAppleId !== undefined) process.env.APPLE_ID = prevAppleId
  }

  // Verify PowerShell cert helper & CI workflow reference expected security vars
  const ps1 = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-dev-cert.ps1'), 'utf8')
  assert.ok(ps1.includes('New-SelfSignedCertificate'))
  assert.ok(ps1.includes('CodeSigningCert'))

  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
  assert.ok(workflow.includes('WIN_CSC_LINK'))
  assert.ok(workflow.includes('APPLE_API_KEY'))
  assert.ok(workflow.includes('codesign --verify --deep --strict'))
})
