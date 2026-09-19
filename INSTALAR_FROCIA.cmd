@echo off
setlocal EnableExtensions
title Instalador Froc.IA

cd /d "%~dp0"
echo ==============================================
echo        INSTALADOR E VERIFICADOR FROC.IA
echo ==============================================
echo Pasta: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js 22 ou superior nao foi encontrado.
  echo Baixe em: https://nodejs.org/
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  echo ERRO: Node.js 22 ou superior e obrigatorio.
  node --version
  pause
  exit /b 1
)

echo [1/6] Instalando dependencias exatamente pelo package-lock...
call npm ci
if errorlevel 1 goto :falha

echo [2/6] Validando TypeScript...
call npm run typecheck
if errorlevel 1 goto :falha

echo [3/6] Executando todos os testes...
call npm test
if errorlevel 1 goto :falha

echo [4/6] Validando tracker, migrations e integridade...
call npm run validate:tracker
if errorlevel 1 goto :falha
call npm run validate:migrations
if errorlevel 1 goto :falha
call npm run validate:production-integrity
if errorlevel 1 goto :falha

echo [5/6] Auditando dependencias de producao...
call npm audit --omit=dev --audit-level=moderate
if errorlevel 1 goto :falha

echo [6/6] Gerando build de producao...
call npm run build
if errorlevel 1 goto :falha

echo.
echo ==============================================
echo INSTALACAO E VERIFICACAO CONCLUIDAS COM SUCESSO
echo ==============================================
start "" explorer.exe "%CD%"
pause
exit /b 0

:falha
echo.
echo FALHA: o processo parou para proteger o projeto.
echo Leia o erro acima. Nenhuma etapa seguinte foi executada.
start "" explorer.exe "%CD%"
pause
exit /b 1
