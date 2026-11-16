<#
.SYNOPSIS
  Builds Jessnix Browser on top of ungoogled-chromium-windows.

.DESCRIPTION
  The Chromium source and build output live in a separate workspace (default D:\jxb),
  because Chromium cannot build in a path with spaces and the repo must stay small.

  Modes:
    auto     full build if the workspace has never been built, otherwise rebuild (default)
    full     download Chromium, apply patches, configure and compile everything (hours)
    rebuild  recompile only what changed, then package (minutes for small changes)

  Finished installer and portable zip are copied to <repo>\dist.

.EXAMPLE
  .\scripts\build.ps1
  .\scripts\build.ps1 -Mode rebuild
  .\scripts\build.ps1 -Mode full -Clean
#>
param(
    [ValidateSet('auto', 'full', 'rebuild')]
    [string]$Mode = 'auto',
    [string]$Workspace = 'D:\jxb',
    [string]$Tag = '157.0.8103.78-1.1',
    # Before a full build: delete everything under build\ except the download cache.
    # Needed after a failed full build (see ungoogled-chromium-windows README).
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Workspace 'build'
$SrcDir   = Join-Path $BuildDir 'src'
$LogDir   = Join-Path $Workspace 'logs'
$Log      = Join-Path $LogDir ("build-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

if ($Workspace -match '\s') { throw "Workspace path must not contain spaces: $Workspace" }

function Invoke-Logged([string]$CmdLine) {
    # Runs through cmd so stderr lands in the log without PowerShell wrapping it as errors.
    "`n>>> $CmdLine" | Tee-Object -FilePath $Log -Append | Out-Host
    cmd /c "$CmdLine 2>&1" | Tee-Object -FilePath $Log -Append | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Failed (exit $LASTEXITCODE): $CmdLine`nLog: $Log" }
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
        $Mode = if (Test-Path (Join-Path $SrcDir 'out\Default\gn.exe')) { 'rebuild' } else { 'full' }
    }
    "Jessnix build: mode=$Mode tag=$Tag workspace=$Workspace" | Tee-Object -FilePath $Log | Out-Host

    if ($Mode -eq 'full') {
        if ($Clean -and (Test-Path $BuildDir)) {
            Get-ChildItem $BuildDir -Force | Where-Object Name -ne 'download_cache' |
                Remove-Item -Recurse -Force
        }
        elseif (Test-Path (Join-Path $SrcDir 'out')) {
            throw "A previous build exists in $BuildDir. Use -Mode rebuild, or -Mode full -Clean to start over."
        }
        # TODO Phase 1: apply Jessnix patches/series and branding after ungoogled-chromium's patches.
        Invoke-Logged 'python build.py'
    }
    else {
        $vcvars = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -latest -property installationPath
        $vcvars = Join-Path $vcvars 'VC\Auxiliary\Build\vcvars64.bat'
        Invoke-Logged "call `"$vcvars`" >nul && set DEPOT_TOOLS_WIN_TOOLCHAIN=0 && cd /d `"$SrcDir`" && third_party\ninja\ninja.exe -C out\Default chrome chromedriver mini_installer"
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
