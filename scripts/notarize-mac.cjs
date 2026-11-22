'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * electron-builder `afterSign` hook for Apple Notarization & Stapling.
 * Runs `xcrun notarytool submit --wait` and `xcrun stapler staple` when macOS
 * Developer ID signing (`CSC_LINK`) and Apple notarization credentials exist;
 * otherwise logs clearly and returns without failing ad-hoc or unsigned builds.
 */
exports.default = async function notarizeMac(context) {
  for (const key of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER'
  ]) {
    if (typeof process.env[key] === 'string' && process.env[key].trim() === '') {
      delete process.env[key]
    }
  }

  if (context.electronPlatformName !== 'darwin') return

  const hasAppleIdCreds = Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID
  )
  const hasApiKeyCreds = Boolean(
    process.env.APPLE_API_KEY &&
      process.env.APPLE_API_KEY_ID &&
      process.env.APPLE_API_ISSUER
  )

  if (!process.env.CSC_LINK || process.env.CSC_LINK.trim().length === 0 || (!hasAppleIdCreds && !hasApiKeyCreds)) {
    console.log(
      '[notarize] No Apple Developer signing/notarization credentials detected; skipping Apple notarytool submission.'
    )
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    throw new Error(`[notarize] Signed app bundle not found at ${appPath}`)
  }

  const zipPath = path.join(
    os.tmpdir(),
    `${context.packager.appInfo.productFilename}-${Date.now()}.zip`
  )

  try {
    console.log(`[notarize] Archiving ${appPath} -> ${zipPath}...`)
    execFileSync('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' })

    const submitArgs = ['notarytool', 'submit', zipPath, '--wait']
    if (hasApiKeyCreds) {
      submitArgs.push(
        '--key',
        process.env.APPLE_API_KEY,
        '--key-id',
        process.env.APPLE_API_KEY_ID,
        '--issuer',
        process.env.APPLE_API_ISSUER
      )
    } else {
      submitArgs.push(
        '--apple-id',
        process.env.APPLE_ID,
        '--password',
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
        '--team-id',
        process.env.APPLE_TEAM_ID
      )
    }

    console.log(`[notarize] Submitting ${appName} to Apple notary service...`)
    execFileSync('xcrun', submitArgs, { stdio: 'inherit' })

    console.log(`[notarize] Stapling notarization ticket onto ${appPath}...`)
    execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' })
    console.log(`[notarize] Notarization & stapling succeeded for ${appPath}`)
  } finally {
    try {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath)
      }
    } catch {
      /* ignore temp cleanup errors */
    }
  }
}
