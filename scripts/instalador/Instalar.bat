@echo off
rem Abre el instalador (ventana). Para la opcion "sin sesion iniciada": clic derecho > Ejecutar como administrador.
rem Si algo falla antes de abrir la ventana, el detalle queda en %TEMP%\CargaReportes_instalacion.log y se abre solo.
setlocal
set "LOG=%TEMP%\CargaReportes_instalacion.log"
echo ===== %DATE% %TIME%  usuario %USERDOMAIN%\%USERNAME% ===== >> "%LOG%"

rem Quita la marca "descargado de internet" para que Windows no bloquee los archivos
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -File | Unblock-File" >> "%LOG%" 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0instalar.ps1" >> "%LOG%" 2>&1
if errorlevel 1 (
    echo. >> "%LOG%"
    echo El instalador termino con error ^(codigo %ERRORLEVEL%^). >> "%LOG%"
    start "" notepad.exe "%LOG%"
)
endlocal
