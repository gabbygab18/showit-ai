@echo off
setlocal
title Showit AI - mobile helper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "node_modules\playwright-core" (
  echo First run: installing, one moment...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo Install failed. Check your internet connection. & pause & exit /b 1 )
)

:menu
cls
echo.
echo   SHOWIT AI - mobile helper
echo   -------------------------
echo   1  Open the Showit window   (log in and open your site there)
echo.
echo   2  Check this page          (no changes)
echo   3  Check all pages          (no changes)
echo   4  Show fixes for this page (cursor tour, no changes)
echo.
echo   5  Fix this page
echo   6  Fix all pages
echo   7  Rebuild a section's mobile layout from desktop
echo.
echo   8  Undo a previous run
echo   0  Exit
echo.
set "c="
set /p "c=  Choose a number: "
if "%c%"=="1" goto open
if "%c%"=="2" goto check
if "%c%"=="3" goto checkall
if "%c%"=="4" goto tour
if "%c%"=="5" goto fix
if "%c%"=="6" goto fixall
if "%c%"=="7" goto rebuild
if "%c%"=="8" goto undo
if "%c%"=="0" exit /b 0
goto menu

:open
node connect.js
echo Chrome is opening. Log in to Showit, open your site in the editor, then come back here.
goto done

:check
node audit.js
goto done

:checkall
node audit.js --all
goto done

:tour
node fix.js
goto done

:fix
call :confirm "This edits the page that is open in Showit (mobile layout only)."
if errorlevel 1 goto menu
node fix.js --apply
goto done

:fixall
call :confirm "This edits EVERY page of the site (mobile layout only). It can take a while."
if errorlevel 1 goto menu
node fix.js --all --apply
goto done

:rebuild
set "s="
set /p "s=  Section name (as shown in Showit's layers panel): "
if "%s%"=="" goto menu
node rebuild.js "%s%"
if errorlevel 1 goto done
call :confirm "Rebuild the mobile layout of '%s%' as shown above? Desktop is not touched."
if errorlevel 1 goto menu
node rebuild.js "%s%" --apply
goto done

:undo
node restore.js
set "r="
set /p "r=  Run to undo (copy it from the list, or press Enter to cancel): "
if "%r%"=="" goto menu
node restore.js %r%
goto done

:confirm
echo.
echo   %~1
set "y="
set /p "y=  Continue? (y/n): "
if /i "%y%"=="y" exit /b 0
exit /b 1

:done
echo.
echo   Nothing goes live until you click Publish in Showit. Preview first.
pause
goto menu
