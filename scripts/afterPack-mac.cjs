/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function collectMachOAndBundles(dir) {
  const binaries = []
  const executables = []
  const appHelpers = []
  const frameworks = []

  function walk(cur) {
    if (!fs.existsSync(cur)) return
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(full)
        if (/\.app$/i.test(entry.name)) {
          appHelpers.push(full)
        } else if (/\.framework$/i.test(entry.name)) {
          frameworks.push(full)
        }
      } else if (entry.isFile()) {
        if (/\.(dylib|node|so)$/i.test(entry.name)) {
          binaries.push(full)
        } else {
          try {
            const st = fs.statSync(full)
            if ((st.mode & 0o111) !== 0 && !/\.(json|js|cjs|mjs|txt|md|pak|bin|dat|icns|plist)$/i.test(entry.name)) {
              executables.push(full)
            }
          } catch {
            /* ignore stat errors */
          }
        }
      }
    }
  }

  walk(dir)
  return { binaries, executables, appHelpers, frameworks }
}

/**
 * Ensures unsigned macOS builds (including Apple Silicon arm64 on M1-M5+) receive a
 * valid inside-out Hardened Runtime ad-hoc code signature with entitlements before
 * DMG/ZIP packaging. Without this, modifying Electron's Info.plist / app.asar invalidates
 * Electron's prebuilt signature, causing macOS Gatekeeper / AMFI to reject the app.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) {
    console.log('[afterPack] Developer ID certificate detected; delegating signing to electron-builder.')
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] App bundle not found at ${appPath}`)
    return
  }

  const entitlementsPath = path.resolve(__dirname, '..', 'build', 'entitlements.mac.plist')
  const hasEntitlements = fs.existsSync(entitlementsPath)

  console.log(
    `[afterPack] Applying inside-out Hardened Runtime ad-hoc signature for ${appPath} (${context.arch})...`
  )

  // Clear any extended attributes / resource forks before signing
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  } catch {
    /* ignore if no xattrs */
  }

  const signTarget = (target, withEntitlements) => {
    const args = ['--force', '--options', 'runtime', '--timestamp=none']
    if (withEntitlements && hasEntitlements) {
      args.push('--entitlements', entitlementsPath)
    }
    args.push('--sign', '-', target)
    try {
      execFileSync('codesign', args, { stdio: 'inherit' })
    } catch (err) {
      console.warn(`[afterPack] Warning signing ${target}:`, err?.message || err)
    }
  }

  // 1. Sign all unpacked native addons & shared libraries first (.node, .dylib, .so)
  const unpackedDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks')
  const unpackedAssets = collectMachOAndBundles(unpackedDir)
  const frameworkAssets = collectMachOAndBundles(frameworksDir)

  for (const bin of [...unpackedAssets.binaries, ...frameworkAssets.binaries]) {
    signTarget(bin, false)
  }

  // 2. Sign standalone helper Mach-O executables (e.g. chrome_crashpad_handler, ShipIt)
  for (const exe of [...unpackedAssets.executables, ...frameworkAssets.executables]) {
    signTarget(exe, true)
  }

  // 3. Sign nested .framework bundles and Electron Helper .app bundles inside-out
  for (const fw of frameworkAssets.frameworks) {
    signTarget(fw, false)
  }
  for (const helperApp of frameworkAssets.appHelpers) {
    signTarget(helperApp, true)
  }

  // 4. Sign top-level .app bundle with Hardened Runtime + entitlements
  const topArgs = ['--force', '--options', 'runtime', '--timestamp=none']
  if (hasEntitlements) {
    topArgs.push('--entitlements', entitlementsPath)
  }
  topArgs.push('--sign', '-', appPath)
  execFileSync('codesign', topArgs, { stdio: 'inherit' })

  // 5. Strict verification so CI fails fast if any nested binary or signature is invalid
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit'
  })
  console.log(`[afterPack] Hardened Runtime ad-hoc signature verified successfully for ${appPath}`)
}
