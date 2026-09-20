param(
    [switch]$Install,
    [switch]$Seed,
    [switch]$Stop,
    [switch]$Production
)

$ErrorActionPreference = 'Stop'
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendDir = Join-Path $projectDir 'backend'
$frontendDir = Join-Path $projectDir 'frontend'
$runtimeDir = Join-Path $projectDir '.runtime'
$stateFile = Join-Path $runtimeDir 'processes.json'

function Stop-OwnedProcess($record) {
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $process) { return }
    # PID reuse must never stop an unrelated process.
    if ($process.StartTime.ToUniversalTime().ToString('o') -ne $record.started_at -or
        $process.Path -ne $record.executable) {
        throw "El PID $($record.pid) ya no corresponde a este inicio. No se detuvo."
    }
    # Next/Python launch child workers. Stop only descendants of the verified
    # process, newest first; never terminate a process merely by its port/name.
    $snapshot = @(Get-CimInstance Win32_Process)
    $descendants = New-Object 'System.Collections.Generic.List[object]'
    $parents = @($process.Id)
    while ($parents.Count -gt 0) {
        $children = @($snapshot | Where-Object { $_.ParentProcessId -in $parents -and $_.CreationDate -ge $process.StartTime })
        foreach ($child in $children) { $descendants.Add($child) }
        $parents = @($children | ForEach-Object { $_.ProcessId })
    }
    foreach ($child in @($descendants | Sort-Object CreationDate -Descending)) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ProcessId)"
        if ($current -and $current.CreationDate -eq $child.CreationDate -and $current.ExecutablePath -eq $child.ExecutablePath) {
            Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
}

if ($Stop) {
    if (Test-Path -LiteralPath $stateFile) {
        $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
        foreach ($record in @($state.frontend, $state.backend)) { Stop-OwnedProcess $record }
        Write-Output 'Panel y API locales detenidos. La base de datos se conserva.'
    } else { Write-Output 'No hay un inicio registrado por este script.' }
    exit 0
}

foreach ($port in @(8000, 3001)) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        throw "El puerto $port esta ocupado. No se detuvo ningun proceso. Usa -Stop para el inicio anterior de Yokohama o libera el puerto."
    }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$python = Join-Path $backendDir '.venv/Scripts/python.exe'
if ($Install) {
    if (-not (Test-Path -LiteralPath $python)) {
        & py -3 -m venv (Join-Path $backendDir '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno Python.' }
    }
    & $python -m pip install -r (Join-Path $backendDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo instalacion de dependencias Python.' }
    Push-Location $frontendDir
    try {
        & $npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Fallo npm ci.' }
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Falta .venv. Ejecuta este script con -Install.' }
$nextCli = Join-Path $frontendDir 'node_modules/next/dist/bin/next'
if (-not (Test-Path -LiteralPath $nextCli)) { throw 'Faltan dependencias web. Ejecuta con -Install.' }
$buildDirectory = if ($env:YOKOHAMA_BUILD_DIR) { $env:YOKOHAMA_BUILD_DIR } else { '.next' }
if ($buildDirectory -notmatch '^\.next(?:-[a-zA-Z0-9-]+)?$') { throw 'YOKOHAMA_BUILD_DIR no es una carpeta de build permitida.' }
if ($Production -and -not (Test-Path -LiteralPath (Join-Path $frontendDir "$buildDirectory/BUILD_ID"))) {
    throw 'Falta compilar el panel. Ejecuta npm run build en frontend antes de usar -Production.'
}
$webCommand = if ($Production) { 'start' } else { 'dev' }

# Only child processes receive this ephemeral key. It is not written to disk or logs.
if (-not $env:YOKOHAMA_API_KEY) {
    $keyBytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($keyBytes) } finally { $rng.Dispose() }
    $env:YOKOHAMA_API_KEY = [Convert]::ToBase64String($keyBytes)
}
$env:YOKOHAMA_API_URL = 'http://127.0.0.1:8000'
$env:NEXT_TELEMETRY_DISABLED = '1'

if ($Seed) {
    Push-Location $backendDir
    try {
        & $python -m app.seed
        if ($LASTEXITCODE -ne 0) { throw 'Fallo generacion de datos sinteticos; no se inicia el panel.' }
    } finally { Pop-Location }
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$apiProcess = $null
$webProcess = $null
try {
    $apiProcess = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'api.log') -RedirectStandardError (Join-Path $runtimeDir 'api-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($apiProcess.HasExited) { throw 'La API termino antes de iniciar. Revisa .runtime/api-error.log.' }
        try { $null = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 1; $ready = $true; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'La API no respondio a tiempo.' }
    $webProcess = Start-Process -FilePath $node -ArgumentList @(('"' + $nextCli + '"'), $webCommand, '--hostname', '127.0.0.1', '--port', '3001') -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'web.log') -RedirectStandardError (Join-Path $runtimeDir 'web-error.log')
    $records = @{}
    foreach ($pair in @(@('backend', $apiProcess), @('frontend', $webProcess))) {
        $process = Get-Process -Id $pair[1].Id
        $records[$pair[0]] = @{ pid = $process.Id; started_at = $process.StartTime.ToUniversalTime().ToString('o'); executable = $process.Path }
    }
    $records | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Output 'Yokohama local: http://127.0.0.1:3001'
    Write-Output 'Estado de API: http://127.0.0.1:8000/health | Contrato: docs/contrato-mvp.md'
    Write-Output 'Solo demostracion local. Logs: .runtime/. Detener: ./scripts/dev.ps1 -Stop'
} catch {
    if ($webProcess -and -not $webProcess.HasExited) { $webProcess.Kill() }
    if ($apiProcess -and -not $apiProcess.HasExited) { $apiProcess.Kill() }
    throw
}
