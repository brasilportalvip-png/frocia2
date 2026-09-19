@echo off
setlocal EnableExtensions
title Download e instalacao Froc.IA

set "FROC_BRANCH=fix/producao-ferramentas-sessao-20260917"
set "FROC_DOWNLOAD=%USERPROFILE%\Downloads\frocia2-correcao-avancada.zip"
set "FROC_TARGET=%USERPROFILE%\Downloads\frocia2-correcao-avancada"
set "FROC_URL=https://github.com/brasilportalvip-png/frocia2/archive/refs/heads/fix/producao-ferramentas-sessao-20260917.zip"

echo Baixando o pacote validado da Froc.IA...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%FROC_URL%' -OutFile '%FROC_DOWNLOAD%'"
if errorlevel 1 goto :falha

if exist "%FROC_TARGET%" (
  echo ERRO: A pasta de destino ja existe:
  echo %FROC_TARGET%
  echo Renomeie ou remova essa pasta antes de repetir.
  pause
  exit /b 1
)

echo Extraindo em Downloads...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%FROC_DOWNLOAD%' -DestinationPath '%FROC_TARGET%'"
if errorlevel 1 goto :falha

for /d %%D in ("%FROC_TARGET%\frocia2-*") do set "FROC_PROJECT=%%~fD"
if not defined FROC_PROJECT goto :falha

cd /d "%FROC_PROJECT%"
start "" explorer.exe "%FROC_PROJECT%"
call INSTALAR_FROCIA.cmd
exit /b %errorlevel%

:falha
echo.
echo Falha no download ou na extracao. Verifique sua internet e tente novamente.
pause
exit /b 1
