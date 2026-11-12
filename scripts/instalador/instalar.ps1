<#
  Instalador de "Carga de reportes de consumo ANDE".

  Ventana para elegir la carpeta de reportes (con subcarpetas claro / m2m / personal /
  tigo), la carpeta de instalación, la clave de Supabase y la frecuencia. Luego:
    1. copia el programa a la carpeta de instalación
    2. escribe cargar_reportes.ini
    3. guarda la clave cifrada con DPAPI de Windows en clave.dat (nunca en texto plano)
    4. prueba la conexión con la base
    5. crea la tarea programada

  Se puede volver a correr para cambiar la configuración (la clave vacía conserva la actual).
#>
$ErrorActionPreference = 'Stop'

# ── Log de la instalación (siempre, aunque falle antes de abrir la ventana) ──
$ArchivoLog = Join-Path $env:TEMP 'CargaReportes_instalacion.log'
function LogArchivo($texto) {
    try { Add-Content -LiteralPath $ArchivoLog -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto" -Encoding UTF8 } catch {}
}
trap {
    LogArchivo "ERROR no controlado: $($_.Exception.Message)  (línea $($_.InvocationInfo.ScriptLineNumber))"
    try { [Windows.Forms.MessageBox]::Show("El instalador falló:`n$($_.Exception.Message)`n`nDetalle en:`n$ArchivoLog", 'Instalación', 'OK', 'Error') | Out-Null } catch {}
    exit 1
}
LogArchivo "Instalador iniciado desde $PSScriptRoot"
LogArchivo ("Equipo: $env:COMPUTERNAME · Windows $([Environment]::OSVersion.Version) · PowerShell $($PSVersionTable.PSVersion) · " +
            "modo de lenguaje: $($ExecutionContext.SessionState.LanguageMode)")
try { LogArchivo ('Política de ejecución: ' + ((Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ', ')) } catch {}
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    LogArchivo 'PowerShell está restringido (Control de aplicaciones / AppLocker): la ventana del instalador no puede abrirse.'
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Security
[System.Windows.Forms.Application]::EnableVisualStyles()
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Origen       = $PSScriptRoot
$NombreTarea  = 'Carga reportes de consumo ANDE'
$SupabaseUrl  = 'https://rnnsvvujedwcvcjyyajm.supabase.co'
$Subcarpetas  = @('claro', 'm2m', 'personal', 'tigo')
$Programa     = @('cargar_reportes.exe', 'cargar_reportes.py', 'importar_consumos.py',
                  'desinstalar.ps1', 'Desinstalar.bat', 'diagnostico.ps1', 'Diagnostico.bat', 'LEEME.txt')
$Entropia     = [Text.Encoding]::UTF8.GetBytes('CargaReportesANDE')   # igual que cargar_reportes.py
$EsAdmin      = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
                    [Security.Principal.WindowsBuiltInRole]::Administrator)
$Usuario      = "$env:USERDOMAIN\$env:USERNAME"
LogArchivo "Usuario: $Usuario · administrador: $(if ($EsAdmin) { 'sí' } else { 'no' })"

# ── Valores iniciales: instalación previa, si existe ─────────────
$destinoPrevio = $null; $carpetaPrevia = $null; $cadaPrevio = 60; $desdePrevio = '07:00'
$tareaPrevia = Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
if ($tareaPrevia) {
    $destinoPrevio = $tareaPrevia.Actions[0].WorkingDirectory
    $rep = $tareaPrevia.Triggers[0].Repetition.Interval     # ej. PT1H, PT30M
    if ($rep -match 'PT(?:(\d+)H)?(?:(\d+)M)?') { $cadaPrevio = 60 * [int]("0" + $Matches[1]) + [int]("0" + $Matches[2]) }
    try { $desdePrevio = ([datetime]$tareaPrevia.Triggers[0].StartBoundary).ToString('HH:mm') } catch {}
}
$destinoDefecto = if ($destinoPrevio) { $destinoPrevio } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ANDE\CargaReportes' }
$iniPrevio = Join-Path $destinoDefecto 'cargar_reportes.ini'
if (Test-Path $iniPrevio) {
    $linea = Select-String -Path $iniPrevio -Pattern '^\s*carpeta_reportes\s*=\s*(.+)$' | Select-Object -First 1
    if ($linea) { $carpetaPrevia = $linea.Matches[0].Groups[1].Value.Trim().Trim('"') }
}
if (-not $carpetaPrevia) {
    $carpetaPrevia = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ANDE\Consumo de SIMCARDs'
}
if ($cadaPrevio -lt 5) { $cadaPrevio = 60 }

# ── Ventana ──────────────────────────────────────────────────────
$fuente  = New-Object Drawing.Font('Segoe UI', 9)
$negrita = New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)
$form = New-Object Windows.Forms.Form -Property @{
    Text = 'Instalar · Carga de reportes de consumo ANDE'; Size = New-Object Drawing.Size(660, 640)
    StartPosition = 'CenterScreen'; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; Font = $fuente
}
function Etiqueta($texto, $x, $y, $ancho = 600, $alto = 20, $font = $negrita) {
    $l = New-Object Windows.Forms.Label -Property @{ Text = $texto; Location = New-Object Drawing.Point($x, $y)
        Size = New-Object Drawing.Size($ancho, $alto); Font = $font }
    $form.Controls.Add($l); $l
}
function Caja($texto, $x, $y, $ancho) {
    $t = New-Object Windows.Forms.TextBox -Property @{ Text = $texto; Location = New-Object Drawing.Point($x, $y)
        Size = New-Object Drawing.Size($ancho, 24) }
    $form.Controls.Add($t); $t
}
function Boton($texto, $x, $y, $ancho = 90) {
    $b = New-Object Windows.Forms.Button -Property @{ Text = $texto; Location = New-Object Drawing.Point($x, $y)
        Size = New-Object Drawing.Size($ancho, 26) }
    $form.Controls.Add($b); $b
}
function ElegirCarpeta($caja, $descripcion) {
    $d = New-Object Windows.Forms.FolderBrowserDialog -Property @{ Description = $descripcion; ShowNewFolderButton = $true }
    if (Test-Path $caja.Text) { $d.SelectedPath = $caja.Text }
    if ($d.ShowDialog($form) -eq 'OK') { $caja.Text = $d.SelectedPath }
}

Etiqueta 'Carpeta de reportes (con las subcarpetas claro, m2m, personal y tigo)' 16 14 | Out-Null
$txtReportes = Caja $carpetaPrevia 16 36 510
$btnReportes = Boton 'Examinar…' 534 35
$lblSubs = Etiqueta '' 16 64 610 20 $fuente

Etiqueta 'Carpeta de instalación del programa' 16 94 | Out-Null
$txtDestino = Caja $destinoDefecto 16 116 510
$btnDestino = Boton 'Examinar…' 534 115

Etiqueta 'Clave de Supabase (service_role)' 16 154 | Out-Null
$txtClave = Caja '' 16 176 510
$txtClave.UseSystemPasswordChar = $true
$chkVer = New-Object Windows.Forms.CheckBox -Property @{ Text = 'Mostrar'; Location = New-Object Drawing.Point(536, 178); AutoSize = $true }
$form.Controls.Add($chkVer)
$hayClave = Test-Path (Join-Path $destinoDefecto 'clave.dat')
Etiqueta ($(if ($hayClave) { 'Ya hay una clave guardada: dejá el campo vacío para conservarla. ' } else { '' }) +
          'Supabase → Project Settings → API Keys → Legacy → service_role.') 16 204 610 34 $fuente | Out-Null

Etiqueta 'Frecuencia' 16 244 | Out-Null
Etiqueta 'Revisar cada' 16 270 80 20 $fuente | Out-Null
$numCada = New-Object Windows.Forms.NumericUpDown -Property @{ Location = New-Object Drawing.Point(100, 267); Size = New-Object Drawing.Size(60, 24)
    Minimum = 5; Maximum = 1440; Increment = 5; Value = $cadaPrevio }
$form.Controls.Add($numCada)
Etiqueta 'minutos, desde las' 168 270 110 20 $fuente | Out-Null
$horaDesde = New-Object Windows.Forms.DateTimePicker -Property @{ Location = New-Object Drawing.Point(282, 267); Size = New-Object Drawing.Size(80, 24)
    Format = 'Custom'; CustomFormat = 'HH:mm'; ShowUpDown = $true; Value = [datetime]::Today.Add([timespan]$desdePrevio) }
$form.Controls.Add($horaDesde)

$chkSinSesion = New-Object Windows.Forms.CheckBox -Property @{ Location = New-Object Drawing.Point(16, 302); Size = New-Object Drawing.Size(610, 22)
    Text = 'Correr aunque no haya sesión iniciada' + $(if ($EsAdmin) { '' } else { '  (abrí el instalador como administrador para usar esta opción)' })
    Enabled = $EsAdmin }
$form.Controls.Add($chkSinSesion)
$chkAhora = New-Object Windows.Forms.CheckBox -Property @{ Location = New-Object Drawing.Point(16, 326); Size = New-Object Drawing.Size(610, 22)
    Text = 'Cargar ahora al terminar la instalación'; Checked = $true }
$form.Controls.Add($chkAhora)

$txtLog = New-Object Windows.Forms.TextBox -Property @{ Location = New-Object Drawing.Point(16, 358); Size = New-Object Drawing.Size(612, 190)
    Multiline = $true; ReadOnly = $true; ScrollBars = 'Vertical'; Font = New-Object Drawing.Font('Consolas', 9); BackColor = [Drawing.Color]::White }
$form.Controls.Add($txtLog)
$btnInstalar = Boton 'Instalar' 438 560 90
$btnCerrar   = Boton 'Cerrar' 538 560 90
$form.AcceptButton = $btnInstalar; $form.CancelButton = $btnCerrar

function Log($texto) { $txtLog.AppendText("$texto`r`n"); LogArchivo $texto; [Windows.Forms.Application]::DoEvents() }
function MostrarError($texto) { Log "ERROR: $texto"; [Windows.Forms.MessageBox]::Show($form, $texto, 'Instalación', 'OK', 'Error') | Out-Null }

function RevisarSubcarpetas {
    $c = $txtReportes.Text.Trim()
    if (-not (Test-Path -LiteralPath $c -PathType Container)) {
        $lblSubs.Text = 'La carpeta no existe.'; $lblSubs.ForeColor = [Drawing.Color]::Firebrick; return
    }
    $hay = @($Subcarpetas | Where-Object { Test-Path -LiteralPath (Join-Path $c $_) -PathType Container })
    $faltan = @($Subcarpetas | Where-Object { $hay -notcontains $_ })
    if ($faltan.Count -eq 0) { $lblSubs.Text = 'Subcarpetas encontradas: ' + ($hay -join ', '); $lblSubs.ForeColor = [Drawing.Color]::ForestGreen }
    else { $lblSubs.Text = "Encontradas: $(if ($hay) { $hay -join ', ' } else { 'ninguna' })  ·  Faltan: $($faltan -join ', ')"; $lblSubs.ForeColor = [Drawing.Color]::DarkOrange }
}

$btnReportes.Add_Click({ ElegirCarpeta $txtReportes 'Carpeta que contiene claro, m2m, personal y tigo' })
$btnDestino.Add_Click({ ElegirCarpeta $txtDestino 'Carpeta donde instalar el programa' })
$txtReportes.Add_TextChanged({ RevisarSubcarpetas })
$chkVer.Add_CheckedChanged({ $txtClave.UseSystemPasswordChar = -not $chkVer.Checked })
$btnCerrar.Add_Click({ $form.Close() })
RevisarSubcarpetas

# ── Instalación ──────────────────────────────────────────────────
function ProbarClave($clave) {
    # Rol del JWT (las claves nuevas sb_secret_ no son JWT)
    if ($clave -like 'eyJ*') {
        try {
            $p = $clave.Split('.')[1].Replace('-', '+').Replace('_', '/')
            $p += '=' * ((4 - $p.Length % 4) % 4)
            $rol = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json).role
        } catch { return 'La clave no tiene un formato válido.' }
        if ($rol -ne 'service_role') { return "Esa es la clave '$rol'. Se necesita la clave service_role." }
    } elseif ($clave -notlike 'sb_secret_*') {
        return 'La clave no tiene un formato válido (debe empezar con eyJ o sb_secret_).'
    }
    $h = @{ apikey = $clave }
    if ($clave -like 'eyJ*') { $h.Authorization = "Bearer $clave" }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$SupabaseUrl/rest/v1/consumo_sim?select=id&limit=1" -Headers $h -TimeoutSec 30 | Out-Null
        return $null
    } catch {
        return "La base rechazó la clave o no hay conexión: $($_.Exception.Message)"
    }
}

function ProbarPrograma($destino) {
    $ErrorActionPreference = 'Continue'   # los comandos nativos (py, pip) escriben en stderr sin que sea error
    # Devuelve @{ exe; args } del modo que funciona en este equipo, o $null
    $exe = Join-Path $destino 'cargar_reportes.exe'
    if (Test-Path $exe) {
        try {
            $p = Start-Process -FilePath $exe -ArgumentList '--probar' -WorkingDirectory $destino -Wait -PassThru -WindowStyle Hidden
            if ($p.ExitCode -eq 0) { return @{ exe = $exe; args = '' } }
            Log "  El programa respondió con error (código $($p.ExitCode))."
            $ultimo = Get-ChildItem (Join-Path $destino 'logs') -Filter '*.log' -ErrorAction SilentlyContinue |
                      Sort-Object LastWriteTime | Select-Object -Last 1
            if ($ultimo) { Get-Content $ultimo.FullName -Tail 8 -Encoding UTF8 | ForEach-Object { Log "    $_" } }
            else { Log '  No se generó ningún log: el programa no llegó a arrancar.' }
            return $null
        } catch {
            Log "  Windows no permite ejecutar cargar_reportes.exe ($($_.Exception.Message.Split([char]10)[0]))."
            Log '  Se intenta con Python…'
        }
    }
    $py = $null
    try { $py = (& py -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1).Trim() } catch {}
    if (-not $py -or -not (Test-Path $py)) {
        Log '  Python no está instalado.'
        return $null
    }
    & $py -c "import requests" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Log '  Instalando el paquete requests para Python…'
        & $py -m pip install --user -q requests 2>&1 | Out-Null
    }
    $pyw = Join-Path (Split-Path $py) 'pythonw.exe'
    if (-not (Test-Path $pyw)) { $pyw = $py }
    $script = Join-Path $destino 'cargar_reportes.py'
    $p = Start-Process -FilePath $pyw -ArgumentList '-X', 'utf8', "`"$script`"", '--probar' -WorkingDirectory $destino -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -eq 0) { return @{ exe = $pyw; args = "-X utf8 `"$script`"" } }
    Log "  La prueba con Python falló (código $($p.ExitCode)). Ver logs\."
    return $null
}

$btnInstalar.Add_Click({
    $btnInstalar.Enabled = $false
    $form.Cursor = 'WaitCursor'
    try {
        $txtLog.Clear()
        $reportes = $txtReportes.Text.Trim().TrimEnd('\')
        $destino  = $txtDestino.Text.Trim().TrimEnd('\')
        $clave    = $txtClave.Text.Trim()
        $archivoClave = Join-Path $destino 'clave.dat'

        # 1. Validaciones
        if (-not (Test-Path -LiteralPath $reportes -PathType Container)) { MostrarError "No existe la carpeta de reportes:`n$reportes"; return }
        $faltan = @($Subcarpetas | Where-Object { -not (Test-Path -LiteralPath (Join-Path $reportes $_) -PathType Container) })
        if ($faltan.Count -gt 0) {
            $r = [Windows.Forms.MessageBox]::Show($form, "En la carpeta de reportes faltan: $($faltan -join ', ').`n¿Continuar igual?", 'Instalación', 'YesNo', 'Warning')
            if ($r -ne 'Yes') { return }
        }
        if ($destino -eq $reportes -or $destino.StartsWith("$reportes\")) { MostrarError 'Instalá el programa en una carpeta distinta de la de reportes.'; return }
        if (-not $clave -and -not (Test-Path $archivoClave)) { MostrarError 'Ingresá la clave de Supabase (service_role).'; return }
        if ($clave) {
            Log 'Verificando la clave con la base…'
            $problema = ProbarClave $clave
            if ($problema) { MostrarError $problema; return }
            Log '  Clave correcta.'
        }

        # 2. Copiar el programa (deteniendo la tarea si estaba corriendo)
        if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
        }
        Log "Copiando el programa a $destino…"
        New-Item -ItemType Directory -Force -Path $destino | Out-Null
        if ((Resolve-Path $Origen).Path -ne (Resolve-Path $destino).Path) {
            foreach ($a in $Programa) {
                $src = Join-Path $Origen $a
                if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination $destino -Force }
            }
        }

        # 3. Configuración
        $ini = "[general]`r`n; Carpeta con las subcarpetas claro, m2m, personal y tigo`r`ncarpeta_reportes = $reportes`r`n`r`n" +
               "; Telefonía de los reportes M2M`r`nm2m_telefonia = Tigo`r`n`r`n" +
               "; si = recalcular los consumos negativos por reinicio de ciclo`r`ncorregir_negativos = no`r`n"
        [IO.File]::WriteAllText((Join-Path $destino 'cargar_reportes.ini'), $ini, (New-Object Text.UTF8Encoding $true))
        Log '  cargar_reportes.ini escrito.'

        # 4. Clave cifrada con DPAPI. Sin sesión iniciada no hay acceso a la clave del
        #    usuario: en ese modo se cifra para el equipo y el archivo queda solo para
        #    este usuario, SYSTEM y Administradores.
        if ($clave) {
            $alcance = if ($chkSinSesion.Checked) { 'LocalMachine' } else { 'CurrentUser' }
            $cifrada = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($clave), $Entropia,
                         [Security.Cryptography.DataProtectionScope]::$alcance)
            if (Test-Path $archivoClave) { Remove-Item $archivoClave -Force }
            [IO.File]::WriteAllBytes($archivoClave, $cifrada)
            & icacls $archivoClave /inheritance:r /grant:r "${Usuario}:(R,W,D)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
            Log "  Clave guardada cifrada (DPAPI, $alcance) en clave.dat."
            $txtClave.Clear()
        }

        # 5. Prueba del programa en este equipo
        Log 'Probando el programa…'
        $modo = ProbarPrograma $destino
        if (-not $modo) {
            MostrarError ("No se pudo ejecutar el programa en este equipo.`n`n" +
                   "Si Windows bloqueó cargar_reportes.exe, instalá Python desde python.org y volvé a correr el instalador.`n" +
                   "Detalle en: $destino\logs")
            return
        }
        Log "  OK: $($modo.exe)"

        # 6. Tarea programada
        Log 'Creando la tarea programada…'
        $accion = if ($modo.args) { New-ScheduledTaskAction -Execute $modo.exe -Argument $modo.args -WorkingDirectory $destino }
                  else { New-ScheduledTaskAction -Execute $modo.exe -WorkingDirectory $destino }
        $disparo = New-ScheduledTaskTrigger -Once -At $horaDesde.Value -RepetitionInterval (New-TimeSpan -Minutes ([int]$numCada.Value))
        $ajustes = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
                     -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $tipo = if ($chkSinSesion.Checked) { 'S4U' } else { 'Interactive' }
        $principal = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType $tipo -RunLevel Limited
        Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparo -Settings $ajustes -Principal $principal `
            -Description "Sube a Supabase los reportes nuevos de $reportes. Log: $destino\logs" -Force | Out-Null
        $cuando = if ($chkSinSesion.Checked) { 'aunque no haya sesión' } else { 'con la sesión iniciada' }
        Log "  Tarea '$NombreTarea': cada $([int]$numCada.Value) min desde las $($horaDesde.Value.ToString('HH:mm')), $cuando."

        if ($chkAhora.Checked) {
            Start-ScheduledTask -TaskName $NombreTarea
            Log 'Carga iniciada. El resultado queda en logs\ (la primera puede tardar varios minutos).'
            # Comprobar que la tarea arrancó de verdad
            Start-Sleep -Seconds 5
            $info = Get-ScheduledTaskInfo -TaskName $NombreTarea -ErrorAction SilentlyContinue
            $estado = (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue).State
            if ($info) {
                $res = '0x{0:X}' -f $info.LastTaskResult
                $texto = switch ($info.LastTaskResult) {
                    0          { 'terminó bien' }
                    267009     { 'está corriendo' }
                    267011     { 'todavía no corrió' }
                    2147942402 { 'no encuentra el programa' }
                    2147942405 { 'acceso denegado (Windows no deja ejecutar el programa)' }
                    default    { 'error' }
                }
                Log "  Estado de la tarea: $estado · último resultado $res ($texto)."
            }
        }
        Copy-Item -LiteralPath $ArchivoLog -Destination (Join-Path $destino 'instalacion.log') -Force -ErrorAction SilentlyContinue
        Log ''
        Log 'Instalación terminada.'
        $btnCerrar.Text = 'Listo'
        $r = [Windows.Forms.MessageBox]::Show($form, "Instalación terminada.`n`n¿Abrir la carpeta del programa?", 'Instalación', 'YesNo', 'Information')
        if ($r -eq 'Yes') { Start-Process explorer.exe $destino }
    } catch {
        MostrarError "$($_.Exception.Message)`n`nDetalle en: $ArchivoLog"
    } finally {
        $form.Cursor = 'Default'
        $btnInstalar.Enabled = $true
    }
})

[void]$form.ShowDialog()
