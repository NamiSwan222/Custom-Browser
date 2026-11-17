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
    start     run the built browser
    package   make the installer
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
        & $bootstrap
        Invoke-Step 'python3 scripts\update_en_US_packs.py'
    }
    'bootstrap' { & $bootstrap }
    # After changing src/, prefs/ or configs/ (branding): copy them into engine/.
    'import'    {
        & $selectBrand
        Invoke-Step 'python3 scripts\fetch_ublock.py'
        Invoke-Step 'npm run import'
        # Jessnix's and Zen's English strings (locales/en-US) into engine/.
        Invoke-Step 'python3 scripts\update_en_US_packs.py'
    }
    'build'     { Invoke-Build 'build' 'build' }
    'ui'        { Invoke-Build 'build:ui' 'build faster' }
    'start'     { Invoke-Step 'python3 mach run --noprofile' $engine }
    default     { Invoke-Step "npm run $Step$extra" }
}
Write-Log "exit: 0"
