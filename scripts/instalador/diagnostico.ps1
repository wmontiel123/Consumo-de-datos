<#
  Diagnóstico de "Carga de reportes de consumo ANDE".
  Junta en un archivo de texto (en el Escritorio) todo lo necesario para ver por qué
  no corre la carga: usuario, permisos, bloqueos de Windows, tarea programada,
  Python y los últimos logs. No muestra ni copia la clave de Supabase.
#>
$ErrorActionPreference = 'Continue'
$NombreTarea = 'Carga reportes de consumo ANDE'
$salida = Join-Path ([Environment]::GetFolderPath('Desktop')) 'CargaReportes_diagnostico.txt'
$lineas = New-Object Collections.Generic.List[string]
function L($t = '') { $lineas.Add([string]$t) }
function Seccion($t) { L; L "── $t ──" }

L "Diagnóstico · $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Seccion 'Equipo y usuario'
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
               [Security.Principal.WindowsBuiltInRole]::Administrator)
L "Equipo: $env:COMPUTERNAME · usuario: $env:USERDOMAIN\$env:USERNAME · administrador: $(if ($esAdmin) { 'sí' } else { 'no' })"
L "Windows $([Environment]::OSVersion.Version) · PowerShell $($PSVersionTable.PSVersion) · lenguaje: $($ExecutionContext.SessionState.LanguageMode)"
try { L ('Política de ejecución: ' + ((Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ', ')) } catch { L "Política: $_" }
try {
    $sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState
    L "Smart App Control: $(@{0='apagado';1='activado';2='evaluación'}[[int]$sac])"
} catch { L 'Smart App Control: sin dato' }

Seccion 'Tarea programada'
$tarea = Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
$carpeta = $null
if ($tarea) {
    $info = Get-ScheduledTaskInfo -TaskName $NombreTarea
    $carpeta = $tarea.Actions[0].WorkingDirectory
    L "Existe · estado: $($tarea.State) · usuario: $($tarea.Principal.UserId) · inicio de sesión: $($tarea.Principal.LogonType)"
    L "Ejecuta: $($tarea.Actions[0].Execute) $($tarea.Actions[0].Arguments)"
    L "Carpeta: $carpeta"
    L "Última vez: $($info.LastRunTime) · resultado: 0x$('{0:X}' -f $info.LastTaskResult) · próxima: $($info.NextRunTime)"
    L '  (0x0 = bien · 0x41301 = corriendo · 0x41303 = nunca corrió · 0x80070002 = no encuentra el programa · 0x80070005 = acceso denegado)'
} else {
    L 'NO existe la tarea: la instalación no llegó a crearla.'
}

Seccion 'Carpeta del programa'
if (-not $carpeta) { $carpeta = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ANDE\CargaReportes' }
L $carpeta
if (Test-Path $carpeta) {
    Get-ChildItem $carpeta -File | ForEach-Object {
        $bloq = if (Get-Item $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) { '  ← marcado como descargado de internet' } else { '' }
        L ("  {0,-26} {1,10:N0} bytes  {2}{3}" -f $_.Name, $_.Length, $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $bloq)
    }
    $ini = Join-Path $carpeta 'cargar_reportes.ini'
    if (Test-Path $ini) {
        L '  cargar_reportes.ini:'
        Get-Content $ini | Where-Object { $_ -and $_ -notmatch '^\s*;' } | ForEach-Object { L "    $_" }
        $linea = Select-String -Path $ini -Pattern '^\s*carpeta_reportes\s*=\s*(.+)$' | Select-Object -First 1
        if ($linea) {
            $rep = $linea.Matches[0].Groups[1].Value.Trim().Trim('"')
            L "  Carpeta de reportes existe: $(if (Test-Path -LiteralPath $rep) { 'sí' } else { 'NO' })"
            foreach ($s in 'claro', 'm2m', 'personal', 'tigo') {
                $d = Join-Path $rep $s
                $n = if (Test-Path -LiteralPath $d) { @(Get-ChildItem -LiteralPath $d -File -Recurse -Include *.csv -ErrorAction SilentlyContinue).Count } else { 'no existe' }
                L "    $s : $n"
            }
        }
    }
    L "  clave.dat: $(if (Test-Path (Join-Path $carpeta 'clave.dat')) { 'presente' } else { 'NO está' })"
} else {
    L '  NO existe la carpeta del programa.'
}

Seccion 'Prueba del programa (--probar)'
$exe = Join-Path $carpeta 'cargar_reportes.exe'
if (Test-Path $exe) {
    try {
        $p = Start-Process -FilePath $exe -ArgumentList '--probar' -WorkingDirectory $carpeta -Wait -PassThru -WindowStyle Hidden -ErrorAction Stop
        L "cargar_reportes.exe --probar → código $($p.ExitCode) $(if ($p.ExitCode -eq 0) { '(bien)' } else { '(error, ver log)' })"
    } catch {
        L "Windows NO deja ejecutar cargar_reportes.exe: $($_.Exception.Message)"
    }
} else { L 'No está cargar_reportes.exe' }
$py = $null
try { $py = (& py -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1) } catch {}
L "Python: $(if ($py) { $py } else { 'no instalado' })"

Seccion 'Últimos logs'
$logs = Get-ChildItem (Join-Path $carpeta 'logs') -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
if ($logs) {
    $u = $logs | Select-Object -Last 1
    L "$($u.Name) (últimas 40 líneas):"
    Get-Content $u.FullName -Tail 40 -Encoding UTF8 | ForEach-Object { L "  $_" }
} else { L 'No hay logs de carga (el programa nunca llegó a correr).' }
$inst = Join-Path $env:TEMP 'CargaReportes_instalacion.log'
if (Test-Path $inst) {
    L; L 'Log del instalador (últimas 40 líneas):'
    Get-Content $inst -Tail 40 -Encoding UTF8 | ForEach-Object { L "  $_" }
} else { L 'No hay log del instalador.' }

$lineas | Set-Content -LiteralPath $salida -Encoding UTF8
Start-Process notepad.exe $salida
