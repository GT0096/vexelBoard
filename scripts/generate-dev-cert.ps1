<#
.SYNOPSIS
  Generates a SHA-256 RSA 2048-bit Authenticode code-signing certificate (.pfx + .cer)
  for local Windows testing or CI signing via WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD.
#>
param(
  [string]$Subject = "CN=Vexelboard",
  [string]$Password = "vexelboard-codesign",
  [string]$OutDir = "build/certs",
  [int]$ValidYears = 3
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$notAfter = (Get-Date).AddYears($ValidYears)
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -FriendlyName "Vexelboard Code Signing" `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyUsage DigitalSignature `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter $notAfter

$pfxPath = Join-Path $OutDir "vexelboard-codesign.pfx"
$cerPath = Join-Path $OutDir "vexelboard-codesign.cer"
$securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host ""
Write-Host "Generated Windows Code Signing Certificate:" -ForegroundColor Green
Write-Host "  Thumbprint : $($cert.Thumbprint)"
Write-Host "  PFX (sign) : $pfxPath"
Write-Host "  CER (trust): $cerPath"
Write-Host ""
Write-Host "To sign locally with electron-builder:"
Write-Host "  `$env:WIN_CSC_LINK = `"$(Resolve-Path $pfxPath)`""
Write-Host "  `$env:WIN_CSC_KEY_PASSWORD = `"$Password`""
Write-Host "  npm run build:win"
Write-Host ""
Write-Host "For GitHub Releases without SmartScreen prompts on end-user machines, set a trusted EV/OV/Azure Trusted Signing certificate as WIN_CSC_LINK (base64 PFX) & WIN_CSC_KEY_PASSWORD in GitHub Actions Secrets."
