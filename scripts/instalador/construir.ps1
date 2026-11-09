<#
  Arma el instalador de "Carga de reportes de consumo ANDE".

  Resultado (en <repo>\dist\):
    CargaReportes\                 carpeta con todo (Instalar.bat abre el instalador)
    CargaReportes.zip              la misma carpeta comprimida
    Instalar_CargaReportes.exe     instalador de un solo archivo (IExpress de Windows)

  Requiere Python con PyInstaller y requests. Si no se indica -Python, crea un entorno
  virtual en %TEMP%\venv_cargareportes y los instala ahí.

  Uso:  powershell -ExecutionPolicy Bypass -File construir.ps1
#>
param([string]$Python)
$ErrorActionPreference = 'Stop'
$Aqui    = $PSScriptRoot
$Scripts = Split-Path $Aqui
$Repo    = Split-Path $Scripts
$Dist    = Join-Path $Repo 'dist'
$Paquete = Join-Path $Dist 'CargaReportes'
$Trabajo = Join-Path ([IO.Path]::GetTempPath()) 'build_cargareportes'
if ($Trabajo -match ' ') { $Trabajo = 'C:\Temp\build_cargareportes' }   # IExpress no acepta espacios en la ruta del .sed

# 1. Python con PyInstaller
if (-not $Python) {
    $venv = Join-Path $env:TEMP 'venv_cargareportes'
    if (-not (Test-Path "$venv\Scripts\python.exe")) {
        Write-Host 'Creando entorno virtual con PyInstaller…'
        & py -m venv $venv
        & "$venv\Scripts\python.exe" -m pip install -q pyinstaller requests
    }
    $Python = "$venv\Scripts\python.exe"
}

# 2. Ejecutable (sin ventana: la salida va a logs\)
Write-Host 'Generando cargar_reportes.exe…'
Push-Location $Scripts
try {
    $ErrorActionPreference = 'Continue'   # PyInstaller informa por stderr: no es error
    & $Python -m PyInstaller --noconfirm --onefile --noconsole --name cargar_reportes `
        --distpath "$Trabajo\dist" --workpath "$Trabajo\work" --specpath $Trabajo `
        --hidden-import importar_consumos cargar_reportes.py 2>&1 | Select-Object -Last 1
} finally { Pop-Location; $ErrorActionPreference = 'Stop' }
if (-not (Test-Path "$Trabajo\dist\cargar_reportes.exe")) { throw 'PyInstaller no generó el ejecutable' }

# 3. Carpeta del paquete
if (Test-Path $Paquete) { Remove-Item $Paquete -Recurse -Force }
New-Item -ItemType Directory -Force $Paquete | Out-Null
Copy-Item "$Trabajo\dist\cargar_reportes.exe", "$Scripts\cargar_reportes.py", "$Scripts\importar_consumos.py" $Paquete
Copy-Item "$Aqui\Instalar.bat", "$Aqui\Desinstalar.bat" $Paquete
# Los .ps1 y el LEEME con BOM: PowerShell 5.1 y el Bloc de notas leen bien los acentos
$bom = New-Object Text.UTF8Encoding $true
foreach ($f in 'instalar.ps1', 'desinstalar.ps1', 'LEEME.txt') {
    [IO.File]::WriteAllText((Join-Path $Paquete $f), [IO.File]::ReadAllText((Join-Path $Aqui $f), [Text.Encoding]::UTF8), $bom)
}

# 4. ZIP
$zip = Join-Path $Dist 'CargaReportes.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$Paquete\*" -DestinationPath $zip

# 5. Instalador de un solo archivo con IExpress (incluido en Windows)
$exe = Join-Path $Dist 'Instalar_CargaReportes.exe'
$archivos = Get-ChildItem $Paquete -File
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Carga de reportes de consumo ANDE
AppLaunched=cmd /c Instalar.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
$(($archivos | ForEach-Object -Begin { $i = 0 } -Process { "FILE$i=`"$($_.Name)`""; $i++ }) -join "`r`n")
[SourceFiles]
SourceFiles0=$Paquete\
[SourceFiles0]
$(($archivos | ForEach-Object -Begin { $i = 0 } -Process { "%FILE$i%="; $i++ }) -join "`r`n")
"@
$sedPath = Join-Path $Trabajo 'instalador.sed'
# IExpress exige fin de línea CRLF (si no, falla sin decir nada)
[IO.File]::WriteAllText($sedPath, ($sed -replace "`r?`n", "`r`n"), [Text.Encoding]::Default)
if (Test-Path $exe) { Remove-Item $exe -Force }
Write-Host 'Generando Instalar_CargaReportes.exe (IExpress)…'
# Sin comillas: IExpress no acepta la ruta del .sed entre comillas (por eso $Trabajo no lleva espacios)
Start-Process -FilePath "$env:SystemRoot\System32\iexpress.exe" -ArgumentList '/N', '/Q', $sedPath -Wait
if (-not (Test-Path $exe)) { throw 'IExpress no generó el instalador' }

Write-Host "`nListo:"
Get-ChildItem $Dist -File | ForEach-Object { '  {0,-30} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
Write-Host "  CargaReportes\  (carpeta: Instalar.bat)"
