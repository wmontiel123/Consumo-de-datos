@echo off
rem Genera CargaReportes_diagnostico.txt en el Escritorio y lo abre. No incluye la clave.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -File | Unblock-File" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostico.ps1"
if errorlevel 1 pause
