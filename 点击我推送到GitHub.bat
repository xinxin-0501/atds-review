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
echo 输入 Token 的方式(任选其一):
echo   A. 在项目文件夹新建 gh_token.txt,粘贴 token 保存,本脚本自动读取
echo   B. 直接在下行粘贴(Ctrl+V 或鼠标右键)
echo.
if exist "%~dp0gh_token.txt" (
  set /p TOKEN=<"%~dp0gh_token.txt"
  echo 已从 gh_token.txt 读取 Token
) else (
  set /p TOKEN=Paste Token and press Enter:
)

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
echo 使用强制推送(-f)以解决远程历史分叉,以本地完整快照为准
"%GIT%" push -f -u origin HEAD:main

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
set /p SAVE=保存 Token 到本机供自动更新使用?(Y/N): 
if /i "%SAVE%"=="Y" (
  "%GIT%" config --global credential.helper store
  "%GIT%" remote remove origin 2>nul
  "%GIT%" remote add origin "https://xinxin-0501:%TOKEN%@github.com/xinxin-0501/atds-review.git"
  "%GIT%" ls-remote origin >nul 2>&1
  "%GIT%" remote set-url origin "https://github.com/xinxin-0501/atds-review.git"
  echo.
  echo Token 已保存!以后 一键更新最新数据.bat 与定时任务推送将免输入。
)

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