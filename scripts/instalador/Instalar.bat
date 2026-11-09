@echo off
rem Abre el instalador (ventana). Para la opcion "sin sesion iniciada": clic derecho > Ejecutar como administrador.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0instalar.ps1"
