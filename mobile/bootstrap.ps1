$ErrorActionPreference = 'Stop'

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    throw 'Flutter is not on PATH. Install the current Flutter stable SDK and run flutter doctor first.'
}

$mobileRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $mobileRoot

if (-not (Test-Path 'android\settings.gradle') -and -not (Test-Path 'android\settings.gradle.kts')) {
    flutter create --platforms=android --org com.dshcodexkit .
}

node ..\scripts\ensure-android-compile-sdk.mjs
Copy-Item 'android_manifest.overlay.xml' 'android\app\src\main\AndroidManifest.xml' -Force
flutter pub get
flutter analyze
flutter test
Write-Output 'Android project bootstrapped and checked. Build with: flutter build apk --release'
