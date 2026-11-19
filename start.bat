@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Mapa OSM — spusteni
echo ========================================
echo   Mapa OSM 3D — Rakovník
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [CHYBA] Node.js neni v PATH. Nainstalujte Node.js a zkuste znovu.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [CHYBA] npm neni v PATH.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [1/3] Instaluji zavislosti...
  call npm install
  if errorlevel 1 (
    echo [CHYBA] npm install selhalo.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Zavislosti OK
)

if not exist "public\tiles\rakovnik\manifest.json" (
  echo [2/3] Generuji terén Rakovník (DEM + low-poly)...
  call npm run pipeline:rakovnik
  if errorlevel 1 (
    echo [CHYBA] Generovani terenu selhalo.
    pause
    exit /b 1
  )
) else (
  echo [2/3] Teren Rakovník OK
)

echo [3/3] Spoustim viewer na http://localhost:5173/
echo       Zavrenim tohoto okna server vypnete.
echo.

start "" "http://localhost:5173/"
call npm run dev

echo.
echo Server ukoncen.
pause
