@echo off
REM ============================================================
REM  LinguaFlix Windows installer builder
REM  Downloads bundled binaries (yt-dlp + ffmpeg) and builds a
REM  self-contained installer. Windows source fixes are already
REM  integrated in the main branch.
REM  + green (zip) package. No manual configuration needed.
REM ============================================================
setlocal
cd /d "%~dp0\.."

set "BIN_DIR=resources\win-bin"

REM ---------- 1. bundled binaries ----------
echo [1/4] Preparing bundled binaries (yt-dlp + ffmpeg)...
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

if not exist "%BIN_DIR%\yt-dlp.exe" (
  echo   Downloading yt-dlp.exe (npmmirror mirror)...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://registry.npmmirror.com/-/binary/yt-dlp/yt-dlp.exe' -OutFile '%BIN_DIR%\yt-dlp.exe' -UseBasicParsing"
  if errorlevel 1 (
    echo   [WARN] mirror download failed, trying github...
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%BIN_DIR%\yt-dlp.exe' -UseBasicParsing"
  )
)

if not exist "%BIN_DIR%\ffmpeg.exe" (
  echo   Downloading ffmpeg essentials (gyan.dev)...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%TEMP%\ffmpeg-essentials.zip' -UseBasicParsing"
  powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\ffmpeg-essentials.zip' -DestinationPath '%TEMP%\ffmpeg-extract' -Force"
  for /r "%TEMP%\ffmpeg-extract" %%f in (ffmpeg.exe) do copy /y "%%f" "%BIN_DIR%\ffmpeg.exe" >nul
  for /r "%TEMP%\ffmpeg-extract" %%f in (ffprobe.exe) do copy /y "%%f" "%BIN_DIR%\ffprobe.exe" >nul
)

if not exist "%BIN_DIR%\yt-dlp.exe" (
  echo [ERROR] yt-dlp.exe is missing - check network.
  exit /b 1
)
if not exist "%BIN_DIR%\ffmpeg.exe" (
  echo [ERROR] ffmpeg.exe is missing - check network.
  exit /b 1
)
echo   [OK] binaries ready:
dir /b "%BIN_DIR%"

REM ---------- 2. npm install ----------
echo [2/4] Installing dependencies...
if not exist node_modules (
  call npm install --no-audit --no-fund
  if errorlevel 1 exit /b 1
  call npm install-scripts approve electron-winstaller esbuild protobufjs 2>nul
  call npm rebuild esbuild electron protobufjs 2>nul
)

REM ---------- 3. build ----------
echo [3/4] Building...
call npm run build
if errorlevel 1 exit /b 1

REM ---------- 4. package ----------
echo [4/4] Packaging (nsis installer + zip green version)...
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
call npx electron-builder --win nsis zip
if errorlevel 1 exit /b 1

echo.
echo ============================================================
echo  DONE! Artifacts in release/:
echo    LinguaFlix-*-win-setup.exe  (installer)
echo    LinguaFlix-*-win.zip        (green - extract and run)
echo ============================================================
endlocal
