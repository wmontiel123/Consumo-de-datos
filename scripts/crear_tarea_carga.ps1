<#
.SYNOPSIS
  Crea (o actualiza) la tarea programada "Carga reportes de consumo ANDE", que corre
  cargar_reportes.py cada N minutos.

.DESCRIPTION
  Si junto a este script está cargar_reportes.exe, usa el ejecutable; si no, el Python
  instalado (pythonw.exe). En los dos casos corre oculto, sin ventana. La salida queda en
  logs\cargar_AAAA-MM-DD.log, junto al script.

  Por defecto la tarea corre mientras el usuario tiene la sesión iniciada (no requiere
  permisos de administrador). Con -SinSesion corre aunque nadie haya iniciado sesión;
  para eso hay que abrir PowerShell como administrador. Ese modo no puede leer carpetas
  de red (\\servidor\...): si los reportes están en la red, usar el modo por defecto.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File crear_tarea_carga.ps1
  powershell -ExecutionPolicy Bypass -File crear_tarea_carga.ps1 -CadaMinutos 30 -Desde 06:00
  powershell -ExecutionPolicy Bypass -File crear_tarea_carga.ps1 -Quitar
#>
param(
    [int]$CadaMinutos = 60,
    [string]$Desde = '07:00',
    [switch]$SinSesion,
    [switch]$Quitar
)
$ErrorActionPreference = 'Stop'
$Nombre = 'Carga reportes de consumo ANDE'

if ($Quitar) {
    Unregister-ScheduledTask -TaskName $Nombre -Confirm:$false
    Write-Host "Tarea '$Nombre' eliminada."
    return
}

$Carpeta = $PSScriptRoot
$Script  = Join-Path $Carpeta 'cargar_reportes.py'
if (-not (Test-Path $Script)) { throw "No se encontró $Script" }

$Exe = Join-Path $Carpeta 'cargar_reportes.exe'
if (Test-Path $Exe) {
    # Ejecutable (no requiere Python instalado). Si Windows lo bloquea (Control de
    # aplicaciones), borrar el .exe y volver a correr este script: usa Python.
    $Accion = New-ScheduledTaskAction -Execute $Exe -WorkingDirectory $Carpeta
    $Usa = $Exe
} else {
    # Ruta real de Python (el alias "py" de WindowsApps no sirve dentro de una tarea)
    $Python = (& py -c "import sys; print(sys.executable)").Trim()
    $Pythonw = Join-Path (Split-Path $Python) 'pythonw.exe'
    if (-not (Test-Path $Pythonw)) { $Pythonw = $Python }
    & $Python -c "import requests" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Falta el paquete requests. Instalalo con:  py -m pip install requests" }
    $Accion = New-ScheduledTaskAction -Execute $Pythonw -Argument "-X utf8 `"$Script`"" -WorkingDirectory $Carpeta
    $Usa = $Pythonw
}

$Disparo  = New-ScheduledTaskTrigger -Once -At $Desde -RepetitionInterval (New-TimeSpan -Minutes $CadaMinutos)
$Ajustes  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Usuario  = "$env:USERDOMAIN\$env:USERNAME"
$Tipo     = if ($SinSesion) { 'S4U' } else { 'Interactive' }
$Principal = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType $Tipo -RunLevel Limited

Register-ScheduledTask -TaskName $Nombre -Action $Accion -Trigger $Disparo -Settings $Ajustes `
    -Principal $Principal -Description 'Sube a Supabase los reportes nuevos de claro/m2m/personal/tigo (cargar_reportes.py). Log: scripts\logs' `
    -Force | Out-Null

Write-Host "Tarea '$Nombre' creada: cada $CadaMinutos min desde las $Desde ($Tipo)."
Write-Host "Ejecuta: $Usa"
Write-Host "Probar ahora:  Start-ScheduledTask -TaskName '$Nombre'   y ver scripts\logs"
