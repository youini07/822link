@echo off
title 822shop Upload and AutoSheet
echo ========================================
echo   Upload and AutoSheet Running...
echo ========================================
echo.

cd /d "%~dp0python"
python upload_and_run.py

echo.
echo ========================================
echo   Task Finished.
echo ========================================
pause