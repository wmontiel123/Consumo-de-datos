<#
  Desinstala "Carga de reportes de consumo ANDE": quita la tarea programada, borra la
  clave cifrada y, si se confirma, la carpeta del programa (con logs y estado).
  No toca los reportes ni los datos de la base.
#>
Add-Type -AssemblyName System.Windows.Forms
$NombreTarea = 'Carga reportes de consumo ANDE'
$Carpeta = $PSScriptRoot

$r = [Windows.Forms.MessageBox]::Show(
    "Se va a quitar la tarea programada '$NombreTarea' y la clave guardada.`n`n¿Continuar?",
    'Desinstalar', 'YesNo', 'Question')
if ($r -ne 'Yes') { return }

if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false
}
Remove-Item (Join-Path $Carpeta 'clave.dat') -Force -ErrorAction SilentlyContinue

$r = [Windows.Forms.MessageBox]::Show(
    "Tarea y clave eliminadas.`n`n¿Borrar también la carpeta del programa, con sus logs y el registro de archivos cargados?`n$Carpeta",
    'Desinstalar', 'YesNo', 'Question')
if ($r -eq 'Yes') {
    # Se borra después de cerrar este script (no se puede borrar la carpeta en uso)
    Start-Process cmd.exe -ArgumentList '/c', "timeout /t 2 /nobreak >nul & rmdir /s /q `"$Carpeta`"" -WindowStyle Hidden
}
[Windows.Forms.MessageBox]::Show('Desinstalación terminada.', 'Desinstalar', 'OK', 'Information') | Out-Null
