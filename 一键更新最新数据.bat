@echo off
chcp 65001 >nul
title ATDS 一键更新最新A股数据
cd /d "%~dp0"

echo ============================================================
echo   ATDS 一键更新最新 A 股数据
echo   流程: 采集 → 生成 → 推送 GitHub(手机端自动更新)
echo ============================================================
echo.

REM ---- 按北京时间自动判断报告类型 ----
for /f %%i in ('powershell -NoProfile -Command "[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::Now,'China Standard Time').ToString('HHmm')"') do set HOUR=%%i
if %HOUR% LSS 0900 (set TYPE=premarket) else (
  if %HOUR% LSS 1300 (set TYPE=midday) else (set TYPE=close)
)
echo  当前北京时间: %HOUR%  →  报告类型: %TYPE%
echo.
echo [1/4] 正在采集数据(午盘含全A选股扫描,可能需 5-15 分钟)...
node scripts/cloud_fetch.mjs %TYPE%
set RC=%errorlevel%
if %RC% EQU 2 (
  echo.
  echo  [幂等跳过] 当日 %TYPE% 报告已存在且不在采集窗口内,无需重采/推送,直接退出。
  pause
  exit /b 0
)
if %RC% NEQ 0 (
  echo.
  echo  [!] 采集失败(错误码 %RC%),请检查网络后重试。
  pause
  exit /b 1
)

echo [2/4] 正在生成报告...
node scripts/build_report.js
node scripts/inject_client.js

echo [3/4] 正在同步本地目录...
copy /y site\index.html github_pages\ >nul
copy /y site\main-rank.html github_pages\ >nul
for %%f in (site\2026-*.html) do copy /y "%%f" github_pages\ >nul
copy /y site\index.html flat\ >nul
copy /y site\main-rank.html flat\ >nul
for %%f in (site\2026-*.html) do copy /y "%%f" flat\ >nul

echo [3.5/4] 同步云端缓存(防止把本地陈旧缓存覆盖到云端)...
node scripts\sync_cloud_caches.mjs

echo [4/4] 正在推送 GitHub(白名单 REST 推送:只推源码/样式/当日报告,绝不碰 data\*_cache.json)...
set GH_TOKEN=
if exist "%~dp0gh_token.txt" set /p GH_TOKEN=<"%~dp0gh_token.txt"
if "%GH_TOKEN%"=="" (
  echo.
  echo  [!] 未找到 gh_token.txt。请在项目文件夹新建 gh_token.txt 并把 Token 粘进去。
  pause
  exit /b 1
)
node .workbuddy\push_3files.mjs "ATDS manual update %date% %time%"
node .workbuddy\push_flat_safe.mjs "ATDS manual update %date% %time%"
if errorlevel 1 (
  echo.
  echo  [!] 推送失败,请检查 Token/网络。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   完成!已推送 GitHub。
echo   手机端访问 https://xinxin-0501.github.io/atds-review
echo   稍后(约1分钟)即可看到最新数据。
echo ============================================================
pause
