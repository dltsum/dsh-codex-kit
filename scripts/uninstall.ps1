[CmdletBinding()]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$arguments = @(Join-Path $PSScriptRoot 'uninstall-core.mjs')
if ($DryRun) { $arguments += '--dry-run' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Uninstaller failed with exit code $LASTEXITCODE" }
