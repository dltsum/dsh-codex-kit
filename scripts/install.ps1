[CmdletBinding()]
param(
    [ValidateSet('lean', 'balanced')]
    [string]$Mode = 'lean',

    [ValidateSet('web', 'headless')]
    [string[]]$Profiles = @('web', 'headless'),

    [string[]]$Plugins = @(),

    [ValidateSet('recommended-full')]
    [string]$Bundle,

    [string]$DshVersion = '0.1.1-rc.2',

    [switch]$AcceptThirdPartyRisk,
    [switch]$SkipDsh,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$core = Join-Path $PSScriptRoot 'install-core.mjs'
$arguments = @(
    $core,
    '--mode', $Mode,
    '--profiles', ($Profiles -join ','),
    '--dsh-version', $DshVersion
)
if ($Plugins.Count -gt 0) { $arguments += @('--plugins', ($Plugins -join ',')) }
if ($Bundle) { $arguments += @('--bundle', $Bundle) }
if ($AcceptThirdPartyRisk) { $arguments += '--accept-third-party-risk' }
if ($SkipDsh) { $arguments += '--skip-dsh' }
if ($DryRun) { $arguments += '--dry-run' }

& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Installer failed with exit code $LASTEXITCODE" }
