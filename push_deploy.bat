@echo off
title ATDS PRO - Push to GitHub
cd /d "%~dp0"

set "GIT=C:\Users\zenglong\.workbuddy\vendor\PortableGit\mingw64\bin\git.exe"

echo ============================================
echo  ATDS PRO One-Click Push to GitHub
echo ============================================
echo.
echo Get Personal Access Token first:
echo  1. Open https://github.com/settings/tokens
echo  2. Generate new token (classic)
echo  3. Check repo permission
echo  4. Copy the token (starts with ghp_)
echo.
set /p TOKEN=Paste Token and press Enter: 

if "%TOKEN%"=="" (
  echo.
  echo Error: Token is empty
  pause
  exit /b 1
)

echo.
echo Pushing... please wait.
echo.

"%GIT%" remote remove origin 2>nul
"%GIT%" remote add origin "https://xinxin-0501:%TOKEN%@github.com/xinxin-0501/atds-review.git"
"%GIT%" push -u origin main

if errorlevel 1 (
  echo.
  echo Push failed! Please check:
  echo   - Is the Token correct?
  echo   - Did you check repo permission?
  echo   - Is the repository public or authorized?
  "%GIT%" remote remove origin
  pause
  exit /b 1
)

"%GIT%" remote set-url origin "https://github.com/xinxin-0501/atds-review.git"
echo.
echo ============================================
echo  Push successful!
echo  ============================================
echo   Repo: https://github.com/xinxin-0501/atds-review
echo   Actions: https://github.com/xinxin-0501/atds-review/actions
echo.
echo  Next: Settings - Pages - Source select GitHub Actions
echo  After Actions runs, mobile access:
echo  https://xinxin-0501.github.io/atds-review/
echo.
pause