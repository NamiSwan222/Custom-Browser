<#
.SYNOPSIS
  Builds Jessnix Browser on top of ungoogled-chromium-windows.

.DESCRIPTION
  The Chromium source and build output live in a separate workspace (default D:\jxb),
  because Chromium cannot build in a path with spaces and the repo must stay small.

  Modes:
    auto     picks one of the three below from what the workspace already holds (default)
    full     download Chromium, apply patches, configure and compile everything (hours)
    resume   continue a full build that stopped after the source was prepared
    rebuild  recompile only what changed, then package (minutes for small changes)

  Finished installer and portable zip are copied to <repo>\dist.

.EXAMPLE
  .\scripts\build.ps1
  .\scripts\build.ps1 -Mode rebuild
  .\scripts\build.ps1 -Mode full -Clean
#>
param(
    [ValidateSet('auto', 'full', 'resume', 'rebuild')]
    [string]$Mode = 'auto',
    [string]$Workspace = 'D:\jxb',
    [string]$Tag = '157.0.8103.78-1.1',
    # Before a full build: delete everything under build\ except the download cache.
    # Needed after a full build fails while preparing the source.
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Workspace 'build'
$SrcDir   = Join-Path $BuildDir 'src'
$OutDir   = Join-Path $SrcDir 'out\Default'
$LogDir   = Join-Path $Workspace 'logs'
$Log      = Join-Path $LogDir ("build-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
# build.py --ci stops the compile after 3.5 hours with this exit code; running it again continues.
$CiTimeoutCode = 124

if ($Workspace -match '\s') { throw "Workspace path must not contain spaces: $Workspace" }

# Chromium's depot_tools call `python3`. On Windows that name often resolves to the
# Microsoft Store alias in WindowsApps, which fails mid-download with exit 9009.
$py3 = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $py3 -or $py3.Source -like '*\WindowsApps\*') {
    throw 'python3 is missing or points to the Microsoft Store alias. Copy python.exe to python3.exe in your Python folder, or turn off the python3 alias in Settings > Apps > Advanced app settings > App execution aliases.'
}

# Chromium looks for Visual Studio 2022 and newer under "C:\Program Files", but the
# Build Tools edition installs under "C:\Program Files (x86)". Without these variables
# `gn gen` stops with "No supported Visual Studio can be found".
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw 'Visual Studio is not installed (vswhere.exe not found).' }
$vsPath = & $vswhere -products * -latest -property installationPath
$vsYear = & $vswhere -products * -latest -property catalog_productLineVersion
if (-not $vsPath -or -not $vsYear) { throw 'No Visual Studio installation with C++ tools was found.' }
Set-Item -Path "env:vs${vsYear}_install" -Value $vsPath
$env:GYP_MSVS_VERSION = $vsYear
# vcvars64.bat calls vswhere.exe by name.
$env:Path = "$(Split-Path $vswhere);$env:Path"
# V8's metagen step runs `gn desc` and looks for gn in buildtools\win or on PATH.
# ungoogled-chromium removes Google's prebuilt gn and builds its own into out\Default,
# so put that folder on PATH (it exists once build.py has bootstrapped gn).
$env:Path = "$OutDir;$env:Path"
$vcvars = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
$inSrc = "call `"$vcvars`" >nul && set DEPOT_TOOLS_WIN_TOOLCHAIN=0 && cd /d `"$SrcDir`""

function Invoke-Logged([string]$CmdLine, [int[]]$AlsoOk = @()) {
    # Runs through cmd so stderr lands in the log without PowerShell wrapping it as errors.
    "`n>>> $CmdLine" | Tee-Object -FilePath $Log -Append | Out-Host
    cmd /c "$CmdLine 2>&1" | Tee-Object -FilePath $Log -Append | Out-Host
    $script:LastCode = $LASTEXITCODE
    if ($script:LastCode -ne 0 -and $AlsoOk -notcontains $script:LastCode) {
        throw "Failed (exit $($script:LastCode)): $CmdLine`nLog: $Log"
    }
}

# 1. Workspace: ungoogled-chromium-windows at the pinned tag
if (-not (Test-Path (Join-Path $Workspace 'build.py'))) {
    git clone --recurse-submodules https://github.com/ungoogled-software/ungoogled-chromium-windows.git $Workspace
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}
New-Item -ItemType Directory -Force $LogDir | Out-Null
Push-Location $Workspace
try {
    git -c advice.detachedHead=false checkout -q --recurse-submodules $Tag
    if ($LASTEXITCODE -ne 0) { throw "git checkout $Tag failed" }

    if ($Mode -eq 'auto') {
        # gn.exe is built only after the source is downloaded, patched and substituted,
        # so its presence means a full build got at least that far.
        $Mode = if (Test-Path (Join-Path $OutDir 'chrome.exe')) { 'rebuild' }
                elseif (Test-Path (Join-Path $OutDir 'gn.exe')) { 'resume' }
                else { 'full' }
    }
    "Jessnix build: mode=$Mode tag=$Tag workspace=$Workspace" | Tee-Object -FilePath $Log | Out-Host

    if ($Mode -eq 'full') {
        if ($Clean -and (Test-Path $BuildDir)) {
            Get-ChildItem $BuildDir -Force | Where-Object Name -ne 'download_cache' |
                Remove-Item -Recurse -Force
        }
        elseif (Test-Path $SrcDir) {
            throw "A previous build exists in $BuildDir. Use -Mode resume or -Mode rebuild to continue it, or -Mode full -Clean to start over."
        }
        # TODO Phase 1: apply Jessnix patches/series and branding after ungoogled-chromium's patches.
        Invoke-Logged 'python build.py'
    }
    elseif ($Mode -eq 'resume') {
        if (-not (Test-Path (Join-Path $OutDir 'gn.exe'))) {
            throw "Nothing to resume: $OutDir\gn.exe is missing. Run -Mode full -Clean."
        }
        if (-not (Test-Path (Join-Path $OutDir 'build.ninja'))) {
            Invoke-Logged "$inSrc && out\Default\gn.exe gen out\Default --fail-on-unused-args"
        }
        # --ci makes build.py skip every step that is already done.
        do { Invoke-Logged 'python build.py --ci' -AlsoOk $CiTimeoutCode } while ($script:LastCode -eq $CiTimeoutCode)
    }
    else {
        Invoke-Logged "$inSrc && third_party\ninja\ninja.exe -C out\Default chrome chromedriver mini_installer"
    }

    Invoke-Logged 'python package.py --cpu-arch 64bit'

    # 2. Copy the newest installer + zip into the repo's dist folder
    $Dist = Join-Path $RepoRoot 'dist'
    New-Item -ItemType Directory -Force $Dist | Out-Null
    foreach ($pattern in '*_installer_*.exe', '*_windows_*.zip') {
        Get-ChildItem $BuildDir -Filter $pattern | Sort-Object LastWriteTime | Select-Object -Last 1 |
            Copy-Item -Destination $Dist -PassThru | ForEach-Object { "Output: $($_.FullName)" | Tee-Object -FilePath $Log -Append | Out-Host }
    }
}
finally {
    Pop-Location
}
