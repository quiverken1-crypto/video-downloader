@echo off
chcp 65001 >nul 2>&1
title Universal Media Downloader
cd /d "%~dp0"

echo ============================================================
echo   Universal Media Downloader (DeepSeek Edition)
echo ============================================================

set "PY_EXE="

REM 1. Anaconda Python
if exist "%USERPROFILE%\anaconda3\python.exe" (
    set "PY_EXE=%USERPROFILE%\anaconda3\python.exe"
    goto :run
)
if exist "C:\ProgramData\anaconda3\python.exe" (
    set "PY_EXE=C:\ProgramData\anaconda3\python.exe"
    goto :run
)

REM 2. Local AppData Python
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python*") do (
    if exist "%%D\python.exe" (
        set "PY_EXE=%%D\python.exe"
        goto :run
    )
)

REM 3. Program Files Python
for /d %%D in ("%ProgramFiles%\Python*") do (
    if exist "%%D\python.exe" (
        set "PY_EXE=%%D\python.exe"
        goto :run
    )
)

REM 4. py launcher
where py >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_EXE=py"
    goto :run
)

REM 5. PATH python
where python >nul 2>&1
if %errorlevel% equ 0 (
    set "PY_EXE=python"
    goto :run
)

echo [ERROR] Python not found. Please install Python 3.8+ from https://www.python.org/
pause
exit /b 1

:run
echo [INFO] Using Python: %PY_EXE%
if not exist "%~dp0.deps_ok" (
    echo [INFO] First run: installing dependencies ...
    "%PY_EXE%" -m pip install -q -r "%~dp0requirements.txt" || "%PY_EXE%" -m pip install -q -r "%~dp0requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    echo ok> "%~dp0.deps_ok"
)
echo [INFO] Starting server at http://localhost:5000 ...
echo [INFO] Press Ctrl+C to stop the server.
echo ============================================================
echo.

"%PY_EXE%" "%~dp0app.py"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    pause
)
