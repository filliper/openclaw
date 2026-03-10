param(
    [switch]$SpeakOnReady,
    [string]$BootMessage = "VOICEVOX is ready. OpenClaw startup is prepared.",
    [string]$Endpoint = "http://127.0.0.1:50021",
    [int]$SpeakerId = 2
)

$ErrorActionPreference = "Stop"
$ProjectDir = (Get-Item $PSScriptRoot).Parent.Parent.FullName
. "$PSScriptRoot\env-tools.ps1"

$envFile = Ensure-ProjectEnvFile -ProjectDir $ProjectDir
$voicevoxExeCandidates = @(
    "$env:LOCALAPPDATA\Programs\VOICEVOX\VOICEVOX.exe",
    "$env:USERPROFILE\.voicevox\VOICEVOX.exe"
)
$engineExeCandidates = @(
    "$env:LOCALAPPDATA\Programs\VOICEVOX\vv-engine\run.exe",
    "$env:USERPROFILE\.voicevox\vv-engine\run.exe"
)

function Test-VoiceVoxReady {
    param([string]$TargetEndpoint)
    try {
        Invoke-RestMethod -Uri "$TargetEndpoint/version" -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

$voicevoxExe = $voicevoxExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$engineExe = $engineExeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not (Test-VoiceVoxReady -TargetEndpoint $Endpoint)) {
    if ($voicevoxExe) {
        Write-Host "[VOICEVOX] Starting app: $voicevoxExe" -ForegroundColor Yellow
        Start-Process -FilePath $voicevoxExe -WorkingDirectory (Split-Path $voicevoxExe -Parent)
    } elseif ($engineExe) {
        Write-Host "[VOICEVOX] Starting engine: $engineExe" -ForegroundColor Yellow
        Start-Process -FilePath $engineExe -WorkingDirectory (Split-Path $engineExe -Parent) -WindowStyle Minimized
    } else {
        throw "VOICEVOX executable was not found."
    }
}

$ready = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-VoiceVoxReady -TargetEndpoint $Endpoint) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    throw "VOICEVOX did not become ready at $Endpoint"
}

Set-EnvValues -EnvFile $envFile -Values @{
    VOICEVOX_ENDPOINT    = $Endpoint
    VOICEVOX_SPEAKER_ID  = $SpeakerId
    VOICEVOX_EXE_PATH    = $voicevoxExe
    VOICEVOX_ENGINE_PATH = $engineExe
}

Write-Host "[VOICEVOX] Ready: $Endpoint" -ForegroundColor Green

if ($SpeakOnReady) {
    $pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonLauncher) {
        & $pythonLauncher.Source -3 (Join-Path $ProjectDir "scripts\verify-voicevox.py") $BootMessage
    } else {
        Write-Host "[VOICEVOX] Python launcher not found. Skipping boot speech." -ForegroundColor Yellow
    }
}
