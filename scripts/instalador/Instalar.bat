@echo off
rem Abre el instalador (ventana). Para la opcion "sin sesion iniciada": clic derecho > Ejecutar como administrador.
rem Registro del instalador: %TEMP%\CargaReportes_instalacion.log (lo escribe instalar.ps1)
rem Mensajes de PowerShell:  %TEMP%\CargaReportes_consola.log
rem Si algo falla, se abren solos.
setlocal
set "LOG=%TEMP%\CargaReportes_instalacion.log"
set "CONSOLA=%TEMP%\CargaReportes_consola.log"
echo ===== %DATE% %TIME%  usuario %USERDOMAIN%\%USERNAME%  desde %~dp0 ===== >> "%CONSOLA%"

if not exist "%~dp0cargar_reportes.py" (
    echo FALTA cargar_reportes.py en %~dp0 >> "%CONSOLA%"
    echo Esta carpeta no es el paquete del instalador: usa CargaReportes.zip ^(carpeta dist^). >> "%CONSOLA%"
    start "" notepad.exe "%CONSOLA%"
    exit /b 1
)

rem Quita la marca "descargado de internet" para que Windows no bloquee los archivos
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -File | Unblock-File" >> "%CONSOLA%" 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0instalar.ps1" >> "%CONSOLA%" 2>&1
if errorlevel 1 (
    echo El instalador termino con error ^(codigo %ERRORLEVEL%^). >> "%CONSOLA%"
    if exist "%LOG%" start "" notepad.exe "%LOG%"
    start "" notepad.exe "%CONSOLA%"
)
endlocal
