@echo off
setlocal enabledelayedexpansion

title BasedBonkBot Configuration

echo ================================
echo  BasedBonkBot Configuration Tool
echo ================================
echo.

:: Set current directory as project directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%"

:: Download repository
echo.
echo [4/6] Downloading BasedBonkBot repository...
echo Repository: https://github.com/tiagoterron/BasedBonkBot.git
echo Destination: Current folder (%PROJECT_DIR%)

git clone "https://github.com/tiagoterron/BasedBonkBot.git" "."

if errorlevel 1 (
    echo.
    echo ERROR: Failed to clone repository!
    echo This could mean:
    echo - Repository doesn't exist or is private
    echo - Network connection issues
    echo - Git authentication problems
    echo - Current folder is not empty
    echo.
    echo Please check the repository URL and try again.
    pause
    exit /b 1
)

echo Repository downloaded successfully

:: Stay in current directory since we cloned here
set "ENV_FILE=%PROJECT_DIR%\.env"

echo Project directory: %PROJECT_DIR%
echo.

:: Check if .env exists and ask user
if exist "%ENV_FILE%" (
    echo Current .env file found at: %ENV_FILE%
    echo.
    echo Current contents:
    type "%ENV_FILE%"
    echo.
    echo ================================
    set /p "RECONFIGURE=Do you want to create a new configuration? [y/N]: "
    if /i not "!RECONFIGURE!"=="y" (
        echo Keeping existing configuration.
        echo.
        echo To reconfigure later, run this script again or delete the .env file.
        pause
        exit /b 0
    )
    
    :: Backup existing file
    echo.
    echo Backing up existing .env file...
    copy "%ENV_FILE%" "%ENV_FILE%.backup.%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%" >nul
    echo Backup created.
)

echo.
echo ================================
echo      RPC URL CONFIGURATION
echo ================================
echo.
echo Choose your RPC provider:
echo.
echo [1] Alchemy (recommended)
echo [2] Infura  
echo [3] QuickNode
echo [4] Other/Custom
echo.

:ask_rpc
set /p "RPC_CHOICE=Enter your choice (1-4): "

echo.
if "%RPC_CHOICE%"=="1" (
    echo === ALCHEMY SETUP ===
    echo.
    echo Get your free API key at: https://www.alchemy.com
    echo 1. Sign up for free account
    echo 2. Create new app
    echo 3. Select "Base" network
    echo 4. Copy your API key
    echo.
    
    :ask_alchemy
    set /p "ALCHEMY_KEY=Enter your Alchemy API key: "
    if "!ALCHEMY_KEY!"=="" (
        echo.
        echo ERROR: API key cannot be empty!
        echo.
        goto ask_alchemy
    )
    set "RPC_URL=https://base-mainnet.g.alchemy.com/v2/!ALCHEMY_KEY!"
    echo.
    echo  Alchemy RPC configured successfully!
    
) else if "%RPC_CHOICE%"=="2" (
    echo === INFURA SETUP ===
    echo.
    echo Get your free project ID at: https://infura.io
    echo 1. Sign up for free account
    echo 2. Create new project
    echo 3. Select "Base" network
    echo 4. Copy your Project ID
    echo.
    
    :ask_infura
    set /p "INFURA_ID=Enter your Infura project ID: "
    if "!INFURA_ID!"=="" (
        echo.
        echo ERROR: Project ID cannot be empty!
        echo.
        goto ask_infura
    )
    set "RPC_URL=https://base-mainnet.infura.io/v3/!INFURA_ID!"
    echo.
    echo  Infura RPC configured successfully!
    
) else if "%RPC_CHOICE%"=="3" (
    echo === QUICKNODE SETUP ===
    echo.
    echo Get your endpoint at: https://quicknode.com
    echo 1. Sign up for account
    echo 2. Create Base endpoint
    echo 3. Copy your HTTP URL
    echo.
    
    :ask_quicknode
    set /p "RPC_URL=Enter your QuickNode HTTP URL: "
    if "!RPC_URL!"=="" (
        echo.
        echo ERROR: URL cannot be empty!
        echo.
        goto ask_quicknode
    )
    echo.
    echo  QuickNode RPC configured successfully!
    
) else if "%RPC_CHOICE%"=="4" (
    echo === CUSTOM RPC SETUP ===
    echo.
    echo Enter your custom Base network RPC URL
    echo Example: https://your-rpc-provider.com/base
    echo.
    
    :ask_custom
    set /p "RPC_URL=Enter your custom RPC URL: "
    if "!RPC_URL!"=="" (
        echo.
        echo ERROR: URL cannot be empty!
        echo.
        goto ask_custom
    )
    echo.
    echo  Custom RPC configured successfully!
    
) else (
    echo.
    echo ERROR: Invalid choice! Please enter 1, 2, 3, or 4.
    echo.
    goto ask_rpc
)

echo.
echo ================================
echo    PRIVATE KEY CONFIGURATION  
echo ================================
echo.
echo Choose how to set up your funding wallet:
echo.
echo [1] Import existing private key
echo [2] Generate new private key
echo.

:ask_pk
set /p "PK_CHOICE=Enter your choice (1-2): "

echo.
if "!PK_CHOICE!"=="1" (
    echo === IMPORT EXISTING PRIVATE KEY ===
    echo.
    echo WARNING: Make sure you are in a secure environment!
    echo Your private key will be stored in the .env file.
    echo Never share your private key with anyone!
    echo.
    
    :ask_import
    set /p "PRIVATE_KEY=Enter your private key (without 0x prefix): "
    if "!PRIVATE_KEY!"=="" (
        echo.
        echo ERROR: Private key cannot be empty!
        echo.
        goto ask_import
    )
    
    :: Remove 0x prefix if present
    if "!PRIVATE_KEY:~0,2!"=="0x" set "PRIVATE_KEY=!PRIVATE_KEY:~2!"
    
    :: Basic length validation - create temp file to count characters
    echo !PRIVATE_KEY!> "%TEMP%\keycheck.tmp"
    for %%A in ("%TEMP%\keycheck.tmp") do set "FILESIZE=%%~zA"
    del "%TEMP%\keycheck.tmp" 2>nul
    
    :: Subtract 2 for CRLF characters
    set /a "KEY_LENGTH=!FILESIZE!-2"
    
    if not "!KEY_LENGTH!"=="64" (
        echo.
        echo ERROR: Private key should be exactly 64 characters long!
        echo You entered !KEY_LENGTH! characters.
        echo Please check your private key and try again.
        echo.
        goto ask_import
    )
    
    echo.
    echo Private key imported successfully!
    echo Length: !KEY_LENGTH! characters - valid
    
) else if "!PK_CHOICE!"=="2" (
    echo === GENERATE NEW PRIVATE KEY ===
    echo.
    echo Generating a new private key using Node.js...
    
    :: Check if Node.js is available
    node --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo ERROR: Node.js is required to generate a private key!
        echo Please install Node.js from https://nodejs.org
        echo.
        pause
        exit /b 1
    )
    
    :: Generate using Node.js
    echo const crypto = require('crypto'^); > "%TEMP%\genkey.js"
    echo console.log(crypto.randomBytes(32^).toString('hex'^)^); >> "%TEMP%\genkey.js"
    
    for /f %%i in ('node "%TEMP%\genkey.js"') do set "PRIVATE_KEY=%%i"
    del "%TEMP%\genkey.js" 2>nul
    
    echo.
    echo ================================
    echo        NEW PRIVATE KEY
    echo ================================
    echo.
    echo Generated private key: !PRIVATE_KEY!
    echo.
    echo CRITICAL: SAVE THIS INFORMATION SECURELY!
    echo.
    echo - Write it down on paper and store safely
    echo - Do NOT share this key with anyone
    echo - This key controls your wallet funds
    echo - If you lose it, you lose access to your funds
    echo.
    echo ================================
    echo.
    pause
    
) else (
    echo.
    echo ERROR: Invalid choice! Please enter 1 or 2.
    echo.
    goto ask_pk
)

:: Create the .env file
echo.
echo ================================
echo       CREATING .ENV FILE
echo ================================
echo.

(
echo # BasedBonkBot Configuration
echo # Generated on %date% at %time%
echo.
echo # RPC Configuration
echo RPC_URL=!RPC_URL!
echo.
echo # Private Keys ^(without 0x prefix^)
echo PK_MAIN=!PRIVATE_KEY!
echo.
echo # Server Configuration
echo PORT=3000
echo.
echo # Gas Settings
echo GAS_PRICE_GWEI=1
echo GAS_LIMIT=21000
echo GAS_MAX=0.000003
echo.
echo # Batch Configuration
echo DEFAULT_WALLET_COUNT=1000
echo DEFAULT_CHUNK_SIZE=500
echo DEFAULT_BATCH_SIZE=50
) > "%ENV_FILE%"

echo  Configuration file created: %ENV_FILE%
echo.

:: Install dependencies
echo.
echo [6/6] Installing dependencies...
cd /d "%PROJECT_DIR%"

if exist "package.json" (
    echo Running npm install...
    npm install
    if errorlevel 1 (
        echo.
        echo WARNING: npm install had some issues, but continuing...
        echo You may need to run 'npm install' manually later.
    ) else (
        echo  Dependencies installed successfully

        echo ================================
        echo        SETUP COMPLETE! 
        echo ================================
        echo.
        echo Your BasedBonkBot is now configured and ready to use!
        echo.
        echo  Project Location: %PROJECT_DIR%
        echo  Config File: %ENV_FILE%
        echo.
        echo  NEXT STEPS:
        echo 1. Start Web Interface:
        echo    npm start
        echo.
        echo 2. Web GUI will be at: http://localhost:3000
        echo.
        echo ================================
        echo.
    )
) else (
    echo ERROR: package.json not found - cannot install dependencies
    pause
    exit /b 1
)



pause
exit /b 0