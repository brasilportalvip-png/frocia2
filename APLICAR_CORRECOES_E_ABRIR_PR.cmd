@echo off
setlocal EnableExtensions
title Froc.IA - Correcoes, testes e Pull Request

set "FROC_BRANCH=fix/producao-ferramentas-sessao-20260917"
set "FROC_TARGET=%USERPROFILE%\Downloads\frocia2-pr-producao"
set "FROC_PATCH=%~dp0FROCIA_CORRECOES_PRODUCAO.patch"
set "FROC_REPO=https://github.com/brasilportalvip-png/frocia2.git"
set "FROC_PR=https://github.com/brasilportalvip-png/frocia2/compare/main...fix/producao-ferramentas-sessao-20260917?expand=1"

echo ==============================================
echo   FROC.IA - APLICAR CORRECOES E ABRIR PR
echo ==============================================
echo.

where git >nul 2>nul || (echo ERRO: Git nao encontrado. Instale https://git-scm.com/download/win& pause& exit /b 1)
where node >nul 2>nul || (echo ERRO: Node.js nao encontrado. Instale https://nodejs.org/& pause& exit /b 1)
if not exist "%FROC_PATCH%" (echo ERRO: FROCIA_CORRECOES_PRODUCAO.patch nao encontrado ao lado deste CMD.& pause& exit /b 1)
if exist "%FROC_TARGET%" (echo ERRO: A pasta %FROC_TARGET% ja existe. Renomeie ou remova antes de continuar.& pause& exit /b 1)

echo [1/9] Clonando o repositorio oficial...
git clone "%FROC_REPO%" "%FROC_TARGET%" || goto :falha
cd /d "%FROC_TARGET%" || goto :falha

echo [2/9] Criando a branch de correcao...
git checkout -b "%FROC_BRANCH%" || goto :falha

echo [3/9] Aplicando o pacote de correcoes...
git apply --check "%FROC_PATCH%" || goto :falha
git apply "%FROC_PATCH%" || goto :falha

echo [4/9] Instalando dependencias...
call npm ci || goto :falha

echo [5/9] Executando tipagem e 410 testes...
call npm run typecheck || goto :falha
call npm test || goto :falha

echo [6/9] Validando tracker, migrations e integridade...
call npm run validate:tracker || goto :falha
call npm run validate:migrations || goto :falha
call npm run validate:production-integrity || goto :falha

echo [7/9] Gerando build de producao...
call npm run build || goto :falha

echo [8/9] Criando commit e enviando a branch...
git add --all || goto :falha
git commit -m "feat: ferramentas reais, sessao resiliente e hardening de producao" || goto :falha
git push -u origin "%FROC_BRANCH%" || goto :falha

echo [9/9] Abrindo a pagina para criar o Pull Request...
start "" explorer.exe "%FROC_TARGET%"
start "" "%FROC_PR%"
echo.
echo PRONTO. No GitHub, clique em Create pull request.
echo Depois aguarde os checks e clique em Merge pull request e Confirm merge.
pause
exit /b 0

:falha
echo.
echo FALHA: o processo foi interrompido na etapa acima para proteger o projeto.
echo A pasta foi preservada em: %FROC_TARGET%
if exist "%FROC_TARGET%" start "" explorer.exe "%FROC_TARGET%"
pause
exit /b 1
