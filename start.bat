@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Mapa OSM - spusteni
echo ========================================
echo   Mapa OSM 3D - Rakovnik
echo ========================================
echo.
echo Slozka: %CD%
echo.

rem --- Najdi Node.js ---
set "NODE_OK=0"
where node >nul 2>&1
if not errorlevel 1 (
  where npm >nul 2>&1
  if not errorlevel 1 set "NODE_OK=1"
)

if "%NODE_OK%"=="0" (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
  if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
  if exist "%LOCALAPPDATA%\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\nodejs;%PATH%"
  where node >nul 2>&1
  if not errorlevel 1 (
    where npm >nul 2>&1
    if not errorlevel 1 set "NODE_OK=1"
  )
)

if not "%NODE_OK%"=="1" (
  echo [CHYBA] Node.js nenalezen.
  echo Nainstalujte LTS z https://nodejs.org/ a restartujte PC.
  pause
  exit /b 1
)

echo Node:
where node
node -v
call npm -v
echo.

rem --- Zavislosti ---
set "NEED_INSTALL=0"
if not exist "node_modules\" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\vite.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\three\" set "NEED_INSTALL=1"

if exist "package-lock.json" if exist "node_modules\.mapa-osm-deps.stamp" (
  fc /b "package-lock.json" "node_modules\.mapa-osm-deps.stamp" >nul 2>&1
  if errorlevel 1 set "NEED_INSTALL=1"
)
if exist "package-lock.json" if not exist "node_modules\.mapa-osm-deps.stamp" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="1" goto do_install
echo [1/3] Zavislosti OK
goto after_install

:do_install
echo [1/3] Instaluji zavislosti - npm install...
if exist "node_modules\" echo       Mazu stare node_modules...
if exist "node_modules\" rmdir /s /q "node_modules" 2>nul
call npm install
if errorlevel 1 (
  echo [CHYBA] npm install selhalo.
  pause
  exit /b 1
)
if exist "package-lock.json" copy /y "package-lock.json" "node_modules\.mapa-osm-deps.stamp" >nul
echo [1/3] Zavislosti OK

:after_install
if exist "public\tiles\rakovnik\manifest.json" goto tiles_ok
echo [2/3] Generuji teren Rakovnik - DEM + low-poly...
echo       Potrebuje internet.
call npm run pipeline:rakovnik
if errorlevel 1 (
  echo [CHYBA] Generovani terenu selhalo.
  pause
  exit /b 1
)
goto start_dev

:tiles_ok
echo [2/3] Teren Rakovnik OK

:start_dev
echo [3/3] Spoustim viewer na http://localhost:5173/
echo       Zavrenim tohoto okna server vypnete.
echo.

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:5173/"

call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort

echo.
echo Server ukoncen.
pause
exit /b 0