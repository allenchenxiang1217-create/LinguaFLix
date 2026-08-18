@echo off
REM ============================================================
REM  LinguaFlix Windows fixes - apply patch to source
REM  Applies windows-fixes.patch to the repository (source stays
REM  Mac-original in git; this only patches the working tree).
REM ============================================================
setlocal
cd /d "%~dp0\.."

if not exist windows-fixes\windows-fixes.patch (
  echo [ERROR] windows-fixes\windows-fixes.patch not found
  exit /b 1
)

echo [LinguaFlix] Applying Windows fixes...
git apply --check windows-fixes\windows-fixes.patch
if errorlevel 1 (
  echo [ERROR] Patch does not apply cleanly. Maybe it was already applied,
  echo         or the source has changed. Run:  git status
  exit /b 1
)

git apply windows-fixes\windows-fixes.patch
if errorlevel 1 (
  echo [ERROR] git apply failed.
  exit /b 1
)

echo [OK] Windows fixes applied to working tree.
echo      Note: source files in git are unchanged (Mac-original).
endlocal
