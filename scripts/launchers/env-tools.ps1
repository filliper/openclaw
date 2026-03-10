function Get-ProjectEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectDir
    )

    return Join-Path $ProjectDir ".env"
}

function Ensure-ProjectEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectDir
    )

    $envFile = Get-ProjectEnvFile -ProjectDir $ProjectDir
    if (Test-Path $envFile) {
        return $envFile
    }

    $template = Join-Path $ProjectDir ".env.example"
    if (Test-Path $template) {
        Copy-Item $template $envFile
    } else {
        New-Item -ItemType File -Path $envFile -Force | Out-Null
    }

    return $envFile
}

function ConvertFrom-EnvValue {
    param(
        [AllowNull()]
        [string]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    $trimmed = $Value.Trim()
    if ($trimmed.Length -ge 2) {
        if (($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or
            ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))) {
            return $trimmed.Substring(1, $trimmed.Length - 2)
        }
    }

    return $trimmed
}

function ConvertTo-EnvValue {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return ""
    }

    $stringValue = [string]$Value
    if ($stringValue -match '[\s"#]') {
        return '"' + ($stringValue -replace '"', '\"') + '"'
    }

    return $stringValue
}

function Get-EnvMap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvFile
    )

    $map = @{}
    if (-not (Test-Path $EnvFile)) {
        return $map
    }

    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $map[$Matches[1]] = ConvertFrom-EnvValue -Value $Matches[2]
        }
    }

    return $map
}

function Set-EnvValues {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvFile,
        [Parameter(Mandatory = $true)]
        [hashtable]$Values
    )

    $existingLines = @()
    if (Test-Path $EnvFile) {
        $existingLines = @(Get-Content $EnvFile -Encoding UTF8)
    }

    $pending = @{}
    foreach ($key in $Values.Keys) {
        $pending[$key] = $Values[$key]
    }

    $updatedLines = New-Object System.Collections.Generic.List[string]
    foreach ($line in $existingLines) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=') {
            $key = $Matches[1]
            if ($pending.ContainsKey($key)) {
                $updatedLines.Add("$key=$(ConvertTo-EnvValue -Value $pending[$key])")
                $pending.Remove($key)
                continue
            }
        }

        $updatedLines.Add($line)
    }

    foreach ($key in ($pending.Keys | Sort-Object)) {
        $updatedLines.Add("$key=$(ConvertTo-EnvValue -Value $pending[$key])")
    }

    Set-Content -Path $EnvFile -Value $updatedLines -Encoding UTF8
}

function Get-OrCreateGatewayToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvFile
    )

    $envMap = Get-EnvMap -EnvFile $EnvFile
    $existing = [string]$envMap["OPENCLAW_GATEWAY_TOKEN"]
    if ($existing) {
        return $existing
    }

    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [System.BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()

    Set-EnvValues -EnvFile $EnvFile -Values @{
        OPENCLAW_GATEWAY_TOKEN = $token
    }

    return $token
}
