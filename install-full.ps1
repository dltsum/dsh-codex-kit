[CmdletBinding()]
param(
    [string]$DshVersion = '0.1.1-rc.2',
    [switch]$SkipDsh,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'scripts\install.ps1'
$parameters = @{
    Bundle = 'recommended-full'
    DshVersion = $DshVersion
    AcceptThirdPartyRisk = $true
    SkipDsh = $SkipDsh
    DryRun = $DryRun
}

Write-Host 'DSH Codex Kit: full recommended bundle'
Write-Host 'This explicit entry point installs pinned third-party plugins at runtime.'
& $installer @parameters
if ($LASTEXITCODE -ne 0) { throw "Full installer failed with exit code $LASTEXITCODE" }
