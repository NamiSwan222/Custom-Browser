# SPDX-License-Identifier: MIT
# Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

<#
.SYNOPSIS
  Runs Jessnix (Zen) build steps on Windows with the environment they need.

.DESCRIPTION
  Wraps the npm scripts from package.json and writes each run's output to
  .logs\<step>-<time>.txt as well as the console.

    init      download Firefox, apply Jessnix/Zen changes, install build tools (first time)
    import    copy changed src/, prefs/ and configs/ (branding) into engine/
    build     full build (needed after engine or C++ changes, and the first time)
    ui        rebuild only the browser interface (JS/CSS/HTML): seconds to a minute
    cpp [dir] quick C++/Rust rebuild after a first `build` (run `import` first if
              the change is in src/): minutes
    release   full optimized build for daily use and sharing (link-time
              optimization; about an hour). `build` and `ui` go back to a dev build.
    start     run the built browser
    package   make the installer from the last build: dist\<Product>-<version>-setup.exe
              (signed when JESSNIX_SIGN_CERT points at a .pfx certificate)
    <other>   any other npm script in package.json, passed through

.EXAMPLE
  .\scripts\jessnix.ps1 init
  .\scripts\jessnix.ps1 build
  .\scripts\jessnix.ps1 ui
#>
param(
    [Parameter(Mandatory)][string]$Step,
    [Parameter(ValueFromRemainingArguments)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
if ($Repo -match '\s') { throw "Firefox cannot build in a path with spaces: $Repo" }

# surfer (Zen's build tool) runs scripts through bash. It looks for bash next to
# git.exe, which fails when PATH holds more than one git.exe; Git's own bin folder
# on PATH lets it find bash directly.
$gitBash = 'C:\Program Files\Git\bin'
if (-not (Test-Path "$gitBash\bash.exe")) { throw 'Git for Windows is needed (bash.exe not found in C:\Program Files\Git\bin).' }
if (-not (Test-Path 'C:\mozilla-build\start-shell.bat')) { throw 'MozillaBuild is needed in C:\mozilla-build.' }
$env:Path = "$gitBash;C:\mozilla-build\bin;$env:Path"
$env:MOZILLABUILD = 'C:\mozilla-build\'

# This script and package.json call `python3`, which on many Windows machines is
# only the Microsoft Store stub. Then use MozillaBuild's Python through a shim.
$py3 = Get-Command python3 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $py3 -or $py3 -like '*\WindowsApps\*') {
    $shim = Join-Path $env:LOCALAPPDATA 'jessnix\bin'
    New-Item -ItemType Directory -Force $shim | Out-Null
    Set-Content (Join-Path $shim 'python3.cmd') '@"C:\mozilla-build\python3\python.exe" %*' -Encoding ascii
    $env:Path = "$shim;$env:Path"
}

# sccache for dev builds (configs/common/mozconfig reads JESSNIX_SCCACHE). winget
# puts it in its Links folder, which a shell opened before the install lacks.
$sccache = Get-Command sccache -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $sccache) {
    $sccache = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\sccache.exe"
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Mozilla.sccache_*\*\sccache.exe"
        "$env:USERPROFILE\.mozbuild\sccache\sccache.exe"
    ) | ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1 -ExpandProperty FullName
}
if ($sccache) {
    $env:JESSNIX_SCCACHE = $sccache -replace '\\', '/'
    # A Firefox build is bigger than sccache's 10 GB default.
    if (-not $env:SCCACHE_CACHE_SIZE) { $env:SCCACHE_CACHE_SIZE = '30G' }
}

# surfer keeps the Firefox source in its own git repo (engine/) and commits it as
# the base its patches are measured against. That commit needs an author: use this
# repo's identity, so the machine needs no global git setup.
foreach ($who in 'AUTHOR', 'COMMITTER') {
    Set-Item "env:GIT_${who}_NAME" (git -C $Repo config user.name)
    Set-Item "env:GIT_${who}_EMAIL" (git -C $Repo config user.email)
}
# Keep Firefox's files byte for byte (LF), whatever core.autocrlf says globally.
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'core.autocrlf'
$env:GIT_CONFIG_VALUE_0 = 'false'

$logs = Join-Path $Repo '.logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("{0}-{1:yyyyMMdd-HHmmss}.txt" -f $Step, (Get-Date))

# Windows PowerShell 5 writes UTF-16 with Tee-Object; the log stays plain UTF-8.
function Write-Log([string]$Text) {
    $Text | Out-Host
    [IO.File]::AppendAllText($log, "$Text`r`n")
}

function Invoke-Step([string]$CmdLine, [string]$In = $Repo, [string]$OkIfLogSays) {
    Write-Log "`n>>> $CmdLine"
    $logStart = (Get-Item $log).Length
    Push-Location $In
    try {
        # cmd writes the tool's output straight into the log (stdin from nul, so a
        # tool that asks a question fails instead of waiting forever). Follow it
        # with: Get-Content -Wait <log>, or the Jobs pane.
        cmd /c "$CmdLine >> `"$log`" 2>&1 < nul"
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($code -ne 0 -and $OkIfLogSays) {
        # A failure that is expected, as long as it is that failure and no other.
        $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
        try {
            $null = $fs.Seek($logStart, 'Begin')
            $tail = (New-Object IO.StreamReader($fs)).ReadToEnd()
        }
        finally { $fs.Dispose() }
        if ($tail.Contains($OkIfLogSays)) { return }
    }
    if ($code -ne 0) {
        Write-Log "Failed (exit $code): $CmdLine"
        Write-Log "exit: $code"
        exit $code
    }
}

Write-Log "Jessnix: $Step $Rest"
Write-Log "Log: $log"
$extra = if ($Rest) { ' -- ' + ($Rest -join ' ') } else { '' }
$engine = Join-Path $Repo 'engine'
# surfer's own bootstrap calls `mach` as a command, which Windows can't run;
# Firefox's mach is a Python script.
$bootstrap = { Invoke-Step 'python3 mach --no-interactive bootstrap --application-choice browser' $engine }

# The brand surfer builds: configs/branding/release is Jessnix. Without one, surfer
# falls back to Firefox's "unofficial" branding.
$brand = if ($env:JESSNIX_BRAND) { $env:JESSNIX_BRAND } else { 'release' }
$selectBrand = { Invoke-Step "npm run surfer -- set brand $brand" }

# dev: quick to build. release: Zen's release settings (configs/common/mozconfig,
# ZEN_RELEASE: optimized, link-time optimization, no tests or debug info).
function Set-BuildMode([string]$Mode) {
    if ($Mode -eq 'release') { $env:ZEN_RELEASE = '1' } else { Remove-Item env:ZEN_RELEASE -ErrorAction SilentlyContinue }
    # Release leaves out Firefox's test code, which changes generated files; a
    # build on top of the other mode's output fails to compile, so start clean.
    $modeFile = Join-Path $Repo '.surfer\dynamicConfig.buildMode.json'
    $previous = if (Test-Path $modeFile) { (Get-Content $modeFile -Raw).Trim().Trim('"') } else { 'dev' }
    if ($previous -ne $Mode -and (Test-Path (Join-Path $engine 'obj-x86_64-pc-windows-msvc'))) {
        Write-Log "Switching from a $previous build to ${Mode}: clearing the old build output."
        Invoke-Step 'python3 mach clobber' $engine
    }
    Invoke-Step "npm run surfer -- set buildMode $Mode"
}

# surfer build writes engine\mozconfig (brand, version, update settings) and then
# runs `./mach build` the same unrunnable way. Its config step is kept, and the
# build itself runs here. `faster` rebuilds only the interface (JS/CSS/HTML).
function Invoke-Build([string]$SurferScript, [string]$MachArgs) {
    & $selectBrand
    Invoke-Step "npm run $SurferScript$extra" $Repo "'mach' is not recognized"
    $env:MAR_CHANNEL_ID = $brand
    $env:ACCEPTED_MAR_CHANNEL_IDS = $brand
    Invoke-Step "python3 mach $MachArgs" $engine
}

switch ($Step) {
    'init' {
        # package.json's init is download + import + bootstrap; npm would carry on
        # past a failed step, so they run one at a time here.
        Invoke-Step 'npm run download'
        Invoke-Step 'python3 scripts\fetch_ublock.py'
        Invoke-Step 'npm run import'
        Invoke-Step 'python3 scripts\jessnix_brand_terms.py'
        & $bootstrap
        Invoke-Step 'python3 scripts\update_en_US_packs.py'
    }
    'bootstrap' { & $bootstrap }
    # After changing src/, prefs/ or configs/ (branding): copy them into engine/.
    'import'    {
        & $selectBrand
        Invoke-Step 'python3 scripts\fetch_ublock.py'
        Invoke-Step 'npm run import'
        # Brand names surfer's branding template leaves out.
        Invoke-Step 'python3 scripts\jessnix_brand_terms.py'
        # Jessnix's and Zen's English strings (locales/en-US) into engine/.
        Invoke-Step 'python3 scripts\update_en_US_packs.py'
    }
    'build'     { Set-BuildMode dev; Invoke-Build 'build' 'build' }
    'ui'        { Set-BuildMode dev; Invoke-Build 'build:ui' 'build faster' }
    'release'   { Set-BuildMode release; Invoke-Build 'build' 'build' }
    # Quick C++/Rust rebuild after a first `build`: skips the tiers that only
    # matter when build files or the interface change. `cpp <dir>` rebuilds
    # that source folder (e.g. dom/base) first, then relinks.
    'cpp'       {
        Set-BuildMode dev
        & $selectBrand
        $env:MAR_CHANNEL_ID = $brand
        $env:ACCEPTED_MAR_CHANNEL_IDS = $brand
        if ($Rest) { Invoke-Step "python3 mach build $($Rest -join ' ')" $engine }
        Invoke-Step 'python3 mach build binaries' $engine
    }
    'package'   {
        # Same mode as the last build, or mach would see a changed mozconfig and
        # reconfigure. surfer remembers the mode in .surfer/.
        $modeFile = Join-Path $Repo '.surfer\dynamicConfig.buildMode.json'
        if ((Test-Path $modeFile) -and ((Get-Content $modeFile -Raw) -match 'release')) { $env:ZEN_RELEASE = '1' }
        $env:MAR_CHANNEL_ID = $brand
        $env:ACCEPTED_MAR_CHANNEL_IDS = $brand
        # surfer's package step calls mach the same unrunnable way, so the
        # installer is made here: mach package, then the NSIS setup.exe.
        Invoke-Step 'python3 mach package' $engine
        $version = (Get-Content (Join-Path $Repo 'surfer.json') -Raw | ConvertFrom-Json).brands.$brand.release.displayVersion
        $obj = Join-Path $engine 'obj-x86_64-pc-windows-msvc'
        $zip = Get-ChildItem (Join-Path $obj 'dist') -Filter '*.win64.zip' | Sort-Object LastWriteTime | Select-Object -Last 1
        if (-not $zip) { Write-Log 'mach package made no .win64.zip.'; Write-Log 'exit: 1'; exit 1 }
        # The NSIS setup.exe is made during the build; this wraps it and the zip
        # into one self-extracting installer, as Firefox's own release does.
        $sea = Join-Path $obj 'dist\install\sea'
        New-Item -ItemType Directory -Force $sea | Out-Null
        $built = Join-Path $sea "jessnix-$version.win64.installer.exe"
        # The self-extractor stub carries Firefox's installer icon; a copy with
        # the product icon (branding\jessnix.ico) is used instead.
        $stub = Join-Path $obj 'jessnix-7zSD.Win32.sfx'
        Invoke-Step ("python3 scripts\jessnix_installer_icon.py engine\other-licenses\7zstub\firefox\7zSD.Win32.sfx " +
            "branding\jessnix.ico `"$stub`"")
        Invoke-Step ("python3 mach repackage installer --tag browser\installer\windows\app.tag " +
            "--setupexe `"$obj\browser\installer\windows\instgen\setup.exe`" --package `"$($zip.FullName)`" " +
            "--sfx-stub `"$stub`" --package-name jessnix --output `"$built`"") $engine
        $setup = Get-Item $built -ErrorAction SilentlyContinue
        if (-not $setup) { Write-Log 'No installer was made.'; Write-Log 'exit: 1'; exit 1 }
        $out = Join-Path $Repo 'dist'
        New-Item -ItemType Directory -Force $out | Out-Null
        # Named after the product (surfer.json), e.g. Custom-Browser-0.1.0-setup.exe.
        $product = (Get-Content (Join-Path $Repo 'surfer.json') -Raw | ConvertFrom-Json).brands.$brand.brandShortName -replace '\s+', '-'
        $target = Join-Path $out "$product-$version-setup.exe"
        Copy-Item $setup.FullName $target -Force
        # Code signing (so SmartScreen stops warning), when a certificate is set:
        #   JESSNIX_SIGN_CERT      path to a .pfx code-signing certificate
        #   JESSNIX_SIGN_PASSWORD  its password (optional)
        # signtool comes with the Windows SDK, which `init` installs for the build.
        if ($env:JESSNIX_SIGN_CERT) {
            $signtool = Get-ChildItem "$env:USERPROFILE\.mozbuild\vs\Windows Kits\10\bin\*\x64\signtool.exe", "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName -Descending | Select-Object -First 1
            if (-not $signtool) { Write-Log 'JESSNIX_SIGN_CERT is set but signtool.exe was not found.'; Write-Log 'exit: 1'; exit 1 }
            $passwordArg = if ($env:JESSNIX_SIGN_PASSWORD) { "/p `"$env:JESSNIX_SIGN_PASSWORD`"" } else { '' }
            Invoke-Step ("`"$($signtool.FullName)`" sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com " +
                "/f `"$env:JESSNIX_SIGN_CERT`" $passwordArg `"$target`"")
            Write-Log 'Installer signed.'
        }
        # Keep the three newest installers.
        Get-ChildItem $out -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending |
            Select-Object -Skip 3 | Remove-Item -Force
        Write-Log "Installer: $target"
    }
    'start'     {
        # The profile lives outside the build output: `mach clobber` and a
        # switch between dev and release delete engine\obj-*, and with it any
        # profile kept there (mach run's default).
        $devProfile = Join-Path $Repo '.profiles\dev'
        New-Item -ItemType Directory -Force $devProfile | Out-Null
        # -purgecaches: the profile caches the browser window's markup and
        # scripts, and `ui` doesn't change the build ID that would clear it, so
        # without this a `ui` build's changes don't show.
        Invoke-Step "python3 mach run --profile `"$devProfile`" -- -purgecaches" $engine
    }
    default     { Invoke-Step "npm run $Step$extra" }
}
Write-Log "exit: 0"
