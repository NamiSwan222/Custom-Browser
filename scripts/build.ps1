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
    dev      a second, fast-linking build in out\Dev for trying changes; never picked by auto.
             The first dev build compiles everything (hours, about 100 GB); after that a
             small change links in a minute or two instead of the release build's slow
             optimized link. Slightly slower to browse with, so not for daily use.

  Finished installer and portable zip are copied to <repo>\dist (not for dev).

.EXAMPLE
  .\scripts\build.ps1
  .\scripts\build.ps1 -Mode rebuild
  .\scripts\build.ps1 -Mode full -Clean
  .\scripts\build.ps1 -Mode dev
#>
param(
    [ValidateSet('auto', 'full', 'resume', 'rebuild', 'dev')]
    [string]$Mode = 'auto',
    [string]$Workspace = 'D:\jxb',
    [string]$Tag = '157.0.8103.78-1.1',
    # Before a full build: delete everything under build\ except the download cache.
    # Needed after a full build fails while preparing the source.
    [switch]$Clean,
    # How many builds (installer + zip) to keep in dist; older ones are deleted.
    [int]$KeepBuilds = 3
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Workspace 'build'
$SrcDir   = Join-Path $BuildDir 'src'
$OutDir   = Join-Path $SrcDir 'out\Default'
$DevDir   = Join-Path $SrcDir 'out\Dev'
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
$Apply = Join-Path $PSScriptRoot 'jessnix_apply.py'
Push-Location $Workspace
try {
    # build.py carries a one-line hook (added below); drop it so the checkout can move tags.
    git checkout -q -- build.py
    git -c advice.detachedHead=false checkout -q --recurse-submodules $Tag
    if ($LASTEXITCODE -ne 0) { throw "git checkout $Tag failed" }

    # A full build runs ungoogled-chromium's build.py from download to compile in one go.
    # Jessnix's patches, images and name must land between its source preparation and the
    # compile, so a call to jessnix_apply.py goes in right after its domain substitution.
    $buildPy = (Get-Content build.py -Raw).Replace("`r`n", "`n")
    $anchor = "            None`n        )`n"
    if ([regex]::Matches($buildPy, [regex]::Escape($anchor)).Count -ne 1) {
        throw 'build.py changed upstream: find the domain substitution call and update the Jessnix hook in build.ps1.'
    }
    $hook = "        # Jessnix: added by scripts/build.ps1`n" +
            "        subprocess.run([sys.executable, r'$Apply', str(source_tree)], check=True)`n"
    [IO.File]::WriteAllText((Join-Path $Workspace 'build.py'), $buildPy.Replace($anchor, $anchor + $hook))

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
        Invoke-Logged 'python build.py'
    }
    elseif ($Mode -eq 'resume') {
        if (-not (Test-Path (Join-Path $OutDir 'gn.exe'))) {
            throw "Nothing to resume: $OutDir\gn.exe is missing. Run -Mode full -Clean."
        }
        Invoke-Logged "python `"$Apply`" `"$SrcDir`""
        if (-not (Test-Path (Join-Path $OutDir 'build.ninja'))) {
            Invoke-Logged "$inSrc && out\Default\gn.exe gen out\Default --fail-on-unused-args"
        }
        # --ci makes build.py skip every step that is already done.
        do { Invoke-Logged 'python build.py --ci' -AlsoOk $CiTimeoutCode } while ($script:LastCode -eq $CiTimeoutCode)
    }
    elseif ($Mode -eq 'dev') {
        if (-not (Test-Path (Join-Path $OutDir 'args.gn'))) {
            throw 'The dev build reuses the release build''s source and settings: run a full build first.'
        }
        Invoke-Logged "python `"$Apply`" `"$SrcDir`""
        # The release settings, minus what makes every link slow: link-time optimization,
        # which is_official_build turns on. A component build (many small DLLs) would link
        # faster still, but on Windows it fails to link abseil with this Chromium and clang.
        $slow = '^\s*(is_official_build|is_component_build|chrome_pgo_phase)\s*='
        $devArgs = @(Get-Content (Join-Path $OutDir 'args.gn') | Where-Object { $_ -notmatch $slow }) +
                   '', '# Jessnix dev build: fast links, not for daily use',
                   'is_official_build=false', 'is_component_build=false', 'chrome_pgo_phase=0'
        $devArgsText = ($devArgs -join "`n") + "`n"
        $devArgsFile = Join-Path $DevDir 'args.gn'
        New-Item -ItemType Directory -Force $DevDir | Out-Null
        # Rewriting args.gn with the same text would still make GN regenerate everything.
        if (-not (Test-Path $devArgsFile) -or (Get-Content $devArgsFile -Raw) -ne $devArgsText) {
            [IO.File]::WriteAllText($devArgsFile, $devArgsText)
        }
        if (-not (Test-Path (Join-Path $DevDir 'build.ninja'))) {
            Invoke-Logged "$inSrc && out\Default\gn.exe gen out\Dev"
        }
        Invoke-Logged "$inSrc && third_party\ninja\ninja.exe -C out\Dev chrome"
        # Its own profile, so trying a change never touches your everyday Jessnix data.
        "Output: $DevDir\chrome.exe --user-data-dir=$Workspace\dev-profile" | Tee-Object -FilePath $Log -Append | Out-Host
        return
    }
    else {
        Invoke-Logged "python `"$Apply`" `"$SrcDir`""
        # chromedriver (browser automation for tests) is left out: one less big link.
        Invoke-Logged "$inSrc && third_party\ninja\ninja.exe -C out\Default chrome mini_installer"
    }

    Invoke-Logged 'python package.py --cpu-arch 64bit'

    # 2. Copy the newest installer + zip into the repo's dist folder as
    #    Jessnix_<version>_<build time>_..., keeping only the last $KeepBuilds builds.
    $Dist = Join-Path $RepoRoot 'dist'
    New-Item -ItemType Directory -Force $Dist | Out-Null
    $stamp = '{0:yyyyMMdd-HHmm}' -f (Get-Date)
    foreach ($kind in 'installer', 'windows') {
        $made = Get-ChildItem $BuildDir -Filter "*_${kind}_*" | Sort-Object LastWriteTime | Select-Object -Last 1
        if (-not $made) { continue }
        $name = $made.Name -replace '^ungoogled-chromium', 'Jessnix' -replace "_${kind}_", "_${stamp}_${kind}_"
        $target = Join-Path $Dist $name
        Copy-Item $made.FullName $target
        "Output: $target" | Tee-Object -FilePath $Log -Append | Out-Host
        # -File: a folder you unzipped a build into stays.
        Get-ChildItem $Dist -File -Filter "*_${kind}_*" | Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $KeepBuilds | ForEach-Object {
                Remove-Item $_.FullName
                "Removed old build: $($_.Name)" | Tee-Object -FilePath $Log -Append | Out-Host
            }
    }
}
finally {
    Pop-Location
}
