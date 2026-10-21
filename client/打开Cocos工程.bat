@echo off
chcp 65001 >nul
setlocal
title PAWPACK - Cocos Creator

set "CREATOR=C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe"
set "PROJ=%~dp0"
if "%PROJ:~-1%"=="\" set "PROJ=%PROJ:~0,-1%"

echo.
echo  ================================================
echo   PAWPACK / 吧唧军团  -  Cocos Creator 3.8.8
echo  ================================================
echo   project : %PROJ%
echo.

if not exist "%CREATOR%" (
    echo  [ERROR] Cocos Creator 3.8.8 not found:
    echo          %CREATOR%
    echo.
    echo  Open Cocos Dashboard manually and add this folder as a project.
    echo.
    pause
    exit /b 1
)

if not exist "%PROJ%\package.json" (
    echo  [ERROR] package.json not found in project folder.
    echo          Make sure this .bat sits next to package.json.
    echo.
    pause
    exit /b 1
)

echo  Launching editor... first open takes 1-3 minutes
echo  it will import assets and build the library folder.
echo.
start "" "%CREATOR%" --project "%PROJ%"
exit /b 0
