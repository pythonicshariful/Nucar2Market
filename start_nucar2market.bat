@echo off
TITLE Nucar2Market - Dealership Inventory to FB Marketplace
COLOR 0A

echo ================================================================
echo       NUCAR NH -^> FACEBOOK MARKETPLACE AUTO POSTING BOT
echo                  Dealership: Tilton, NH
echo ================================================================
echo.

:: 1. Check Python
python --version >nul 2>&1
if errorlevel 1 (
    COLOR 0C
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.9+ from https://www.python.org/
    pause
    exit /b 1
)

:: 2. Check / Install dependencies
echo [*] Checking required Python packages...
python -c "import requests, flask, flask_cors" >nul 2>&1
if errorlevel 1 (
    echo [*] Installing missing dependencies (requests, flask, flask_cors)...
    pip install requests flask flask-cors
    if errorlevel 1 (
        COLOR 0C
        echo [ERROR] Failed to install required packages.
        pause
        exit /b 1
    )
)
echo [OK] Python dependencies verified.
echo.

:: 3. Check inventory file
if not exist "vehicles_tilton.json" (
    echo [!] vehicles_tilton.json not found!
    echo [*] Fetching fresh inventory from Nucar NH Tilton API...
    python fetch_inventory.py
    if errorlevel 1 (
        COLOR 0C
        echo [ERROR] Failed to fetch inventory. Check your internet connection.
        pause
        exit /b 1
    )
) else (
    echo [1] Use existing inventory file (vehicles_tilton.json)
    echo [2] Fetch fresh live inventory now (download ~570 vehicles in 3 sec)
    set /p choice="Select option (1 or 2, default is 1): "
    if "%choice%"=="2" (
        echo [*] Fetching fresh inventory from Nucar NH Tilton API...
        python fetch_inventory.py
    )
)

echo.
echo ================================================================
echo [*] Launching Image Proxy & Inventory Server (http://127.0.0.1:5000)
echo [*] Opening Facebook Marketplace in your browser...
echo ================================================================
echo.

:: 4. Launch Web Control Center dashboard in browser (app mode if Chrome available)
start http://127.0.0.1:5000

:: 5. Run Flask server in the foreground
python flask_image_server.py

pause
