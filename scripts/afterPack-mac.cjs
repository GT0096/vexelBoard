const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function collectMachOBinaries(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      collectMachOBinaries(full, out)
    } else if (entry.isFile() && /\.(dylib|node|so)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Ensures unsigned macOS builds (especially Apple Silicon arm64 on M1–M5+) receive a
 * valid bottom-up ad-hoc code signature before DMG/ZIP packaging. Without this,
 * modifying Electron's Info.plist / app.asar invalidates Electron's prebuilt signature,
 * causing macOS Gatekeeper / AMFI to report the app as "damaged / corrupted".
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) {
    console.log('[afterPack] Developer ID certificate detected; skipping ad-hoc sign.')
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] App bundle not found at ${appPath}`)
    return
  }

  console.log(`[afterPack] Applying clean ad-hoc code signature for ${appPath} (${context.arch})...`)

  // Clear any extended attributes / resource forks before signing
  try {
    execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' })
  } catch {
    /* ignore if no xattrs */
  }

  // 1. Sign all unpacked native binaries (.node, .dylib, .so) first
  const unpackedDir = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
  const nativeBins = collectMachOBinaries(unpackedDir)
  for (const bin of nativeBins) {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'inherit' })
    } catch (err) {
      console.warn(`[afterPack] Warning signing ${bin}:`, err?.message || err)
    }
  }

  // 2. Deep ad-hoc sign the entire .app bundle (frameworks, helpers, main binary)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })

  // 3. Verify signature integrity so CI fails fast if anything is invalid
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit'
  })
  console.log(`[afterPack] Ad-hoc signature verified successfully for ${appPath}`)
}
