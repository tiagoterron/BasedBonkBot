#!/bin/bash

# BasedBonkBot Automation Script - Complete Installation
# This script handles setup and downloads the entire project structure

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="BasedBonkBot"
GITHUB_REPO="tiagoterron/BasedBonkBot"
GITHUB_BRANCH="main"
ENV_FILE="$SCRIPT_DIR/.env"
LOG_FILE="$SCRIPT_DIR/automation.log"

# Temporary directory for downloads
TEMP_DIR=$(mktemp -d)
DOWNLOAD_DIR="$TEMP_DIR/$PROJECT_NAME"

# Node.js configuration
NODEJS_MIN_VERSION="16"
NVM_INSTALL_URL="https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error_log() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

warning_log() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

info_log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1" | tee -a "$LOG_FILE"
}

# Function to get system information
get_system_info() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Function to check Node.js version
check_nodejs_version() {
    if command -v node &> /dev/null; then
        local current_version=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ $current_version -ge $NODEJS_MIN_VERSION ]]; then
            log "✅ Node.js version $(node --version) is installed and compatible"
            return 0
        else
            warning_log "Node.js version $(node --version) is too old. Minimum required: v${NODEJS_MIN_VERSION}"
            return 1
        fi
    else
        warning_log "Node.js is not installed"
        return 1
    fi
}

# Function to install Node.js via package manager (Linux/macOS)
install_nodejs_package_manager() {
    local system=$(get_system_info)
    
    case $system in
        linux)
            if command -v apt-get &> /dev/null; then
                log "📦 Installing Node.js via apt-get..."
                sudo apt-get update
                sudo apt-get install -y nodejs npm
            elif command -v yum &> /dev/null; then
                log "📦 Installing Node.js via yum..."
                sudo yum install -y nodejs npm
            elif command -v dnf &> /dev/null; then
                log "📦 Installing Node.js via dnf..."
                sudo dnf install -y nodejs npm
            elif command -v pacman &> /dev/null; then
                log "📦 Installing Node.js via pacman..."
                sudo pacman -S nodejs npm
            elif command -v zypper &> /dev/null; then
                log "📦 Installing Node.js via zypper..."
                sudo zypper install -y nodejs npm
            else
                error_log "No supported package manager found for Linux"
                return 1
            fi
            ;;
        macos)
            if command -v brew &> /dev/null; then
                log "📦 Installing Node.js via Homebrew..."
                brew install node
            else
                error_log "Homebrew not found. Please install Homebrew first or install Node.js manually"
                return 1
            fi
            ;;
        *)
            error_log "Unsupported system for automatic Node.js installation"
            return 1
            ;;
    esac
}

# Function to install Node.js via NVM
install_nodejs_nvm() {
    log "📦 Installing Node.js via NVM..."
    
    # Download and install NVM
    if command -v curl &> /dev/null; then
        curl -o- "$NVM_INSTALL_URL" | bash
    elif command -v wget &> /dev/null; then
        wget -qO- "$NVM_INSTALL_URL" | bash
    else
        error_log "Neither curl nor wget found. Cannot install NVM."
        return 1
    fi
    
    # Source NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
    
    # Install latest LTS Node.js
    if command -v nvm &> /dev/null; then
        log "Installing latest LTS Node.js via NVM..."
        nvm install --lts
        nvm use --lts
        nvm alias default lts/*
        log "✅ Node.js installed via NVM"
        return 0
    else
        error_log "NVM installation failed"
        return 1
    fi
}

# Function to install Node.js with user choice
install_nodejs() {
    local system=$(get_system_info)
    
    log "🔧 Node.js installation required..."
    echo ""
    echo "Choose installation method:"
    echo "1) Package Manager (recommended for most users)"
    echo "2) NVM (Node Version Manager - recommended for developers)"
    echo "3) Manual installation (visit nodejs.org)"
    echo "4) Skip installation"
    echo ""
    
    read -p "Enter your choice (1-4): " choice
    
    case $choice in
        1)
            if install_nodejs_package_manager; then
                log "✅ Node.js installed via package manager"
            else
                error_log "Package manager installation failed"
                return 1
            fi
            ;;
        2)
            if install_nodejs_nvm; then
                log "✅ Node.js installed via NVM"
            else
                error_log "NVM installation failed"
                return 1
            fi
            ;;
        3)
            echo ""
            log "📝 Manual installation instructions:"
            echo "1. Visit https://nodejs.org"
            echo "2. Download the LTS version for your system"
            echo "3. Install the downloaded package"
            echo "4. Restart your terminal and run this script again"
            echo ""
            exit 0
            ;;
        4)
            warning_log "Skipping Node.js installation. Script may not work properly."
            return 1
            ;;
        *)
            error_log "Invalid choice. Please run the script again."
            return 1
            ;;
    esac
    
    # Verify installation
    if check_nodejs_version; then
        log "✅ Node.js installation verified"
        return 0
    else
        error_log "Node.js installation verification failed"
        return 1
    fi
}

# Function to ensure Node.js is available
ensure_nodejs() {
    if ! check_nodejs_version; then
        log "🔧 Node.js setup required..."
        
        echo ""
        echo "Node.js is required for this script to work."
        echo "Would you like to install it automatically? (y/n)"
        read -p "Install Node.js? [y/N]: " install_choice
        
        if [[ $install_choice =~ ^[Yy]$ ]]; then
            if ! install_nodejs; then
                error_log "Node.js installation failed. Please install manually."
                exit 1
            fi
        else
            error_log "Node.js is required. Please install it manually and run the script again."
            echo ""
            echo "Installation options:"
            echo "1. Visit https://nodejs.org and download the LTS version"
            echo "2. Use your system's package manager:"
            echo "   - Ubuntu/Debian: sudo apt-get install nodejs npm"
            echo "   - CentOS/RHEL: sudo yum install nodejs npm"
            echo "   - macOS: brew install node"
            echo "3. Use NVM: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
            echo ""
            exit 1
        fi
    fi
}

# Function to backup existing .env file
backup_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        local backup_file="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$ENV_FILE" "$backup_file"
        log "📋 Backed up existing .env file to: $(basename "$backup_file")"
        return 0
    fi
    return 1
}

# Function to extract env values from existing file
extract_env_values() {
    local env_file="$1"
    if [[ -f "$env_file" ]]; then
        # Extract RPC_URL
        local rpc_url=$(grep "^RPC_URL=" "$env_file" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//')
        # Extract PK_MAIN
        local pk_main=$(grep "^PK_MAIN=" "$env_file" 2>/dev/null | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//')
        
        echo "RPC_URL=$rpc_url"
        echo "PK_MAIN=$pk_main"
    fi
}

# Function to download project from GitHub
download_project() {
    log "📥 Downloading BasedBonkBot project from GitHub..."
    
    # Clean up any existing temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    # Try different methods to download the project
    if command -v git &> /dev/null; then
        log "📦 Using Git to clone repository..."
        if git clone "https://github.com/$GITHUB_REPO.git" "$DOWNLOAD_DIR"; then
            log "✅ Successfully cloned repository using Git"
            return 0
        else
            warning_log "Git clone failed, trying alternative method..."
        fi
    fi
    
    # Fallback to ZIP download
    log "📦 Downloading ZIP archive..."
    local zip_url="https://github.com/$GITHUB_REPO/archive/refs/heads/$GITHUB_BRANCH.zip"
    local zip_file="$TEMP_DIR/project.zip"
    
    if command -v curl &> /dev/null; then
        if curl -L "$zip_url" -o "$zip_file"; then
            log "✅ Downloaded ZIP using curl"
        else
            error_log "Failed to download using curl"
            return 1
        fi
    elif command -v wget &> /dev/null; then
        if wget "$zip_url" -O "$zip_file"; then
            log "✅ Downloaded ZIP using wget"
        else
            error_log "Failed to download using wget"
            return 1
        fi
    else
        error_log "Neither git, curl, nor wget found. Cannot download project."
        return 1
    fi
    
    # Extract ZIP if downloaded
    if [[ -f "$zip_file" ]]; then
        log "📦 Extracting ZIP archive..."
        if command -v unzip &> /dev/null; then
            cd "$TEMP_DIR"
            if unzip -q "$zip_file"; then
                # Move extracted folder to expected location
                mv "$PROJECT_NAME-$GITHUB_BRANCH" "$PROJECT_NAME" 2>/dev/null || true
                log "✅ Successfully extracted ZIP archive"
                return 0
            else
                error_log "Failed to extract ZIP archive"
                return 1
            fi
        else
            error_log "unzip command not found. Cannot extract ZIP archive."
            return 1
        fi
    fi
    
    return 1
}

# Function to copy project files while preserving .env
copy_project_files() {
    log "📋 Copying project files..."
    
    if [[ ! -d "$DOWNLOAD_DIR" ]]; then
        error_log "Downloaded project directory not found"
        return 1
    fi
    
    # Backup existing .env if it exists
    local env_backup=""
    if backup_env_file; then
        env_backup=$(extract_env_values "$ENV_FILE")
    fi
    
    # Create list of items to exclude from copying
    local exclude_items=(".git" ".gitignore" "README.md" "LICENSE" ".env")
    
    # Copy all files except excluded ones
    log "📂 Copying project structure..."
    
    # Copy files and directories
    for item in "$DOWNLOAD_DIR"/*; do
        local basename_item=$(basename "$item")
        local should_skip=false
        
        # Check if item should be excluded
        for exclude in "${exclude_items[@]}"; do
            if [[ "$basename_item" == "$exclude" ]]; then
                should_skip=true
                break
            fi
        done
        
        if [[ "$should_skip" == "false" ]]; then
            if [[ -d "$item" ]]; then
                log "📁 Copying directory: $basename_item"
                cp -r "$item" "$SCRIPT_DIR/"
            elif [[ -f "$item" ]]; then
                log "📄 Copying file: $basename_item"
                cp "$item" "$SCRIPT_DIR/"
            fi
        else
            log "⏭️ Skipping: $basename_item"
        fi
    done
    
    # Restore .env file with preserved values
    if [[ -n "$env_backup" ]]; then
        log "🔧 Restoring .env configuration..."
        
        # Create new .env with preserved values
        cat > "$ENV_FILE" << EOF
# RPC Configuration
$(echo "$env_backup" | grep "RPC_URL=")

# Private Keys (without 0x prefix)
$(echo "$env_backup" | grep "PK_MAIN=")

PORT=3000

# Optional: Gas Settings
GAS_PRICE_GWEI=1
GAS_LIMIT=21000
GAS_MAX=0.000003

# Batch Configuration
DEFAULT_WALLET_COUNT=1000
DEFAULT_CHUNK_SIZE=500
DEFAULT_BATCH_SIZE=50

# Web GUI Configuration
WEB_PORT=3000
WEB_HOST=localhost
EOF
        
        chmod 600 "$ENV_FILE"
        log "✅ Restored .env with preserved RPC_URL and PK_MAIN"
    fi
    
    log "✅ Project files copied successfully"
    return 0
}

# Function to install dependencies
install_dependencies() {
    log "📦 Installing Node.js dependencies..."
    cd "$SCRIPT_DIR"
    
    if [[ -f "package.json" ]]; then
        if command -v npm &> /dev/null; then
            npm install
            log "✅ Dependencies installed with npm"
        elif command -v yarn &> /dev/null; then
            yarn install
            log "✅ Dependencies installed with yarn"
        else
            error_log "Neither npm nor yarn found. This shouldn't happen after Node.js installation."
            return 1
        fi
    else
        warning_log "package.json not found. Creating basic package.json..."
        create_package_json
        npm install
    fi
}

# Create basic package.json if missing
create_package_json() {
    log "Creating basic package.json..."
    cat > "$SCRIPT_DIR/package.json" << 'EOF'
{
  "name": "basedbonkbot",
  "version": "1.0.0",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "gui": "npm start",
    "bot": "node controllers/bot.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "axios": "^1.7.9",
    "body-parser": "^1.20.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "ethers": "5.7",
    "express": "^4.21.2",
    "nodemon": "^3.1.9"
  }
}
EOF
    log "✅ Created basic package.json"
}

# Function to validate private key format
validate_private_key() {
    local key=$1
    # Remove 0x prefix if present
    key=${key#0x}
    
    # Check if it's 64 hex characters
    if [[ ${#key} -eq 64 ]] && [[ $key =~ ^[0-9a-fA-F]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Function to generate a new private key using Node.js
generate_private_key() {
    local temp_script=$(mktemp)
    cat > "$temp_script" << 'EOF'
const crypto = require('crypto');
const privateKey = crypto.randomBytes(32).toString('hex');
console.log(privateKey);
EOF
    
    local generated_key=$(node "$temp_script")
    rm "$temp_script"
    echo "$generated_key"
}

# Function to get wallet address from private key
derive_address_after_setup() {
    local private_key=$1
    
    # Check if ethers is available (after npm install)
    if [[ -d "$SCRIPT_DIR/node_modules/ethers" ]]; then
        local temp_script=$(mktemp)
        cat > "$temp_script" << EOF
try {
    const { ethers } = require('ethers');
    const wallet = new ethers.Wallet('$private_key');
    console.log(wallet.address);
} catch (error) {
    console.log('Unable to derive address');
}
EOF
        
        local address=$(cd "$SCRIPT_DIR" && node "$temp_script" 2>/dev/null)
        rm "$temp_script"
        echo "$address"
    else
        echo "DERIVE_LATER"
    fi
}

# Enhanced function to create .env file with user input
create_env_template() {
    if [[ -f "$ENV_FILE" ]]; then
        echo ""
        echo -e "${YELLOW}⚠️  .env file already exists.${NC}"
        
        # Check if it has required values
        local has_rpc=$(grep "^RPC_URL=" "$ENV_FILE" 2>/dev/null)
        local has_pk=$(grep "^PK_MAIN=" "$ENV_FILE" 2>/dev/null)
        
        if [[ -n "$has_rpc" && -n "$has_pk" ]]; then
            echo -e "${GREEN}✅ Existing .env file has required configuration.${NC}"
            read -p "Do you want to reconfigure anyway? [y/N]: " reconfigure_choice
            
            if [[ ! $reconfigure_choice =~ ^[Yy]$ ]]; then
                log "Keeping existing .env file"
                return 0
            fi
        fi
        
        read -p "Do you want to overwrite it? [y/N]: " overwrite_choice
        
        if [[ ! $overwrite_choice =~ ^[Yy]$ ]]; then
            log "Keeping existing .env file"
            return 0
        fi
        
        # Backup existing .env file
        backup_env_file
    fi
    
    log "🔧 Configuring environment variables..."
    
    # Get RPC URL with explicit output
    echo ""
    echo -e "${BLUE}🌐 RPC URL Configuration${NC}"
    echo "Choose your RPC provider:"
    echo "1) Alchemy (recommended)"
    echo "2) Infura"
    echo "3) QuickNode" 
    echo "4) Other/Custom"
    echo ""
    
    local rpc_choice
    local rpc_url=""
    while true; do
        read -p "Enter your choice (1-4): " rpc_choice
        
        case $rpc_choice in
            1)
                echo ""
                log "🔗 Configuring Alchemy RPC..."
                echo "Please provide your Alchemy API key."
                echo "You can get one free at: https://www.alchemy.com"
                echo ""
                
                while true; do
                    read -p "Enter your Alchemy API key: " alchemy_key
                    if [[ -n "$alchemy_key" ]]; then
                        rpc_url="https://base-mainnet.g.alchemy.com/v2/$alchemy_key"
                        log "✅ Alchemy RPC configured"
                        break 2
                    else
                        error_log "API key cannot be empty. Please try again."
                    fi
                done
                ;;
            2)
                echo ""
                log "🔗 Configuring Infura RPC..."
                echo "Please provide your Infura project ID."
                echo "You can get one free at: https://infura.io"
                echo ""
                
                while true; do
                    read -p "Enter your Infura project ID: " infura_id
                    if [[ -n "$infura_id" ]]; then
                        rpc_url="https://base-mainnet.infura.io/v3/$infura_id"
                        log "✅ Infura RPC configured"
                        break 2
                    else
                        error_log "Project ID cannot be empty. Please try again."
                    fi
                done
                ;;
            3)
                echo ""
                log "🔗 Configuring QuickNode RPC..."
                echo "Please provide your QuickNode endpoint URL."
                echo "You can get one at: https://quicknode.com"
                echo ""
                
                while true; do
                    read -p "Enter your QuickNode URL: " quicknode_url
                    if [[ -n "$quicknode_url" ]]; then
                        rpc_url="$quicknode_url"
                        log "✅ QuickNode RPC configured"
                        break 2
                    else
                        error_log "URL cannot be empty. Please try again."
                    fi
                done
                ;;
            4)
                echo ""
                log "🔗 Configuring custom RPC..."
                echo "Please provide your custom RPC URL."
                echo ""
                
                while true; do
                    read -p "Enter your RPC URL: " custom_url
                    if [[ -n "$custom_url" ]]; then
                        # Basic URL validation
                        if [[ $custom_url =~ ^https?:// ]]; then
                            rpc_url="$custom_url"
                            log "✅ Custom RPC configured"
                            break 2
                        else
                            error_log "Invalid URL format. Must start with http:// or https://"
                        fi
                    else
                        error_log "URL cannot be empty. Please try again."
                    fi
                done
                ;;
            *)
                error_log "Invalid choice. Please enter 1-4."
                ;;
        esac
    done
    
    # Get private key
    echo ""
    echo -e "${BLUE}📋 Private Key Configuration${NC}"
    echo "Choose how you want to configure your funding wallet:"
    echo "1) Import existing private key"
    echo "2) Generate new private key"
    echo ""
    
    local private_key=""
    while true; do
        read -p "Enter your choice (1-2): " pk_choice
        
        case $pk_choice in
            1)
                echo ""
                log "🔑 Importing existing private key..."
                echo -e "${YELLOW}⚠️  WARNING: Make sure you're in a secure environment!${NC}"
                echo "Your private key will be stored in the .env file."
                echo ""
                
                while true; do
                    read -s -p "Enter your private key (without 0x prefix): " user_private_key
                    echo ""
                    
                    if [[ -z "$user_private_key" ]]; then
                        error_log "Private key cannot be empty. Please try again."
                        continue
                    fi
                    
                    if validate_private_key "$user_private_key"; then
                        # Remove 0x prefix if present
                        private_key=${user_private_key#0x}
                        log "✅ Private key format is valid"
                        break 2
                    else
                        error_log "Invalid private key format. Must be 64 hexadecimal characters."
                        echo "Please try again or choose option 2 to generate a new key."
                        echo ""
                    fi
                done
                ;;
            2)
                log "🎲 Generating new private key..."
                local generated_key=$(generate_private_key)
                
                if [[ -n "$generated_key" ]] && validate_private_key "$generated_key"; then
                    echo ""
                    echo -e "${GREEN}✅ Generated new private key:${NC}"
                    echo -e "${YELLOW}$generated_key${NC}"
                    echo ""
                    echo -e "${RED}⚠️  IMPORTANT: Save this information securely!${NC}"
                    echo "This is the only time the private key will be displayed in plain text."
                    echo ""
                    
                    read -p "Press Enter after you've saved the private key securely..."
                    private_key="$generated_key"
                    break
                else
                    error_log "Failed to generate private key. Please try again."
                fi
                ;;
            *)
                error_log "Invalid choice. Please enter 1 or 2."
                ;;
        esac
    done
    
    # Create the .env file
    log "📝 Creating .env file..."
    cat > "$ENV_FILE" << EOF
# RPC Configuration
RPC_URL=$rpc_url

# Private Keys (without 0x prefix)
PK_MAIN=$private_key

PORT=3000

# Optional: Gas Settings
GAS_PRICE_GWEI=1
GAS_LIMIT=21000
GAS_MAX=0.000003

# Batch Configuration
DEFAULT_WALLET_COUNT=1000
DEFAULT_CHUNK_SIZE=500
DEFAULT_BATCH_SIZE=50

EOF
    
    # Set secure permissions on .env file
    chmod 600 "$ENV_FILE"
    
    echo ""
    log "✅ .env file created successfully!"
    echo -e "${GREEN}Configuration Summary:${NC}"
    echo "- RPC URL: Configured ✅"
    echo "- Private Key: Configured ✅"
    echo "- File permissions: Set to 600 (owner read/write only) ✅"
    
    # Show wallet address in summary
    local wallet_address=$(derive_address_after_setup "$private_key")
    if [[ -n "$wallet_address" && "$wallet_address" != "Unable to derive address" ]]; then
        echo "- Funding Wallet Address: $wallet_address ✅"
        echo ""
        echo -e "${BLUE}💰 FUNDING INSTRUCTIONS:${NC}"
        echo -e "${YELLOW}Send ETH to: $wallet_address${NC}"
        echo "This wallet will be used to fund all created wallets for gas fees."
    else
        echo "- Wallet Address: Will be derived when running wallet operations ⏳"
    fi
    echo ""
}

# Function to validate project structure
validate_project_structure() {
    log "🔍 Validating project structure..."
    
    local required_dirs=("controllers" "express" "utils")
    local required_files=("index.js" "package.json")
    local validation_success=true
    
    # Check directories
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$SCRIPT_DIR/$dir" ]]; then
            log "✅ Directory found: $dir"
        else
            warning_log "⚠️ Directory missing: $dir"
            validation_success=false
        fi
    done
    
    # Check files
    for file in "${required_files[@]}"; do
        if [[ -f "$SCRIPT_DIR/$file" ]]; then
            log "✅ File found: $file"
        else
            warning_log "⚠️ File missing: $file"
            validation_success=false
        fi
    done
}

# Function to check system status
check_system_status() {
    echo -e "${BLUE}📊 BasedBonkBot System Status${NC}"
    echo ""
    
    # Check Node.js
    if check_nodejs_version; then
        echo -e "${GREEN}✅ Node.js: $(node --version)${NC}"
    else
        echo -e "${RED}❌ Node.js: Not installed or too old${NC}"
    fi
    
    # Check dependencies
    if [[ -d "$SCRIPT_DIR/node_modules" ]]; then
        echo -e "${GREEN}✅ Dependencies: Installed${NC}"
    else
        echo -e "${RED}❌ Dependencies: Not installed${NC}"
    fi
    
    # Check project structure
    if [[ -d "$SCRIPT_DIR/controllers" && -f "$SCRIPT_DIR/controllers/bot.js" ]]; then
        echo -e "${GREEN}✅ Bot Controller: Found${NC}"
    else
        echo -e "${RED}❌ Bot Controller: Missing${NC}"
    fi
    
    if [[ -f "$SCRIPT_DIR/express/index.js" ]]; then
        echo -e "${GREEN}✅ Web Server: Found${NC}"
    else
        echo -e "${RED}❌ Web Server: Missing${NC}"
    fi
    
    if [[ -f "$ENV_FILE" ]]; then
        echo -e "${GREEN}✅ .env file: Found${NC}"
        
        # Check if required env vars are present
        local has_rpc=$(grep "^RPC_URL=" "$ENV_FILE" 2>/dev/null)
        local has_pk=$(grep "^PK_MAIN=" "$ENV_FILE" 2>/dev/null)
        
        if [[ -n "$has_rpc" && -n "$has_pk" ]]; then
            echo -e "${GREEN}✅ Configuration: Complete${NC}"
        else
            echo -e "${YELLOW}⚠️ Configuration: Incomplete${NC}"
        fi
    else
        echo -e "${RED}❌ .env file: Missing${NC}"
    fi
}
# Function to start Web GUI server
start_web_gui() {
    cd "$SCRIPT_DIR"
    
    if [[ ! -f "index.js" ]]; then
        error_log "Main server not found. Cannot start Web GUI."
        echo "Run '$0 setup' or '$0 update' to download Web GUI files."
        return 1
    fi
    
    log "🌐 Starting BasedBonkBot Web GUI..."
    echo -e "${BLUE}Web GUI will be available at: http://localhost:3000${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
    echo ""
    
    npm start
}

# Function to show quick start guide
show_quick_start() {
    echo -e "${CYAN}🚀 BasedBonkBot Quick Start Guide${NC}"
    echo ""
    echo -e "${BLUE}1. First Time Setup:${NC}"
    echo "   $0 setup"
    echo ""
    echo -e "${BLUE}2. Create Wallets:${NC}"
    echo "   node controllers/bot.js create 1000"
    echo ""
    echo -e "${BLUE}3. Check Status:${NC}"
    echo "   node controllers/bot.js check"
    echo ""
    echo -e "${BLUE}4. Fund Wallets (Airdrop):${NC}"
    echo "   node controllers/bot.js airdrop-batch 500"
    echo ""
    echo -e "${BLUE}5. Execute Swaps:${NC}"
    echo "   node controllers/bot.js swap-batch 50"
    echo ""
    echo -e "${BLUE}6. Full Automation:${NC}"
    echo "   node controllers/bot.js full 5000 500 50"
    echo ""
    echo -e "${BLUE}7. Web GUI:${NC}"
    echo "   $0 gui"
    echo "   # Then visit http://localhost:3000"
    echo ""
    echo -e "${PURPLE}💡 Pro Tips:${NC}"
    echo "• Always ensure your funding wallet has sufficient ETH"
    echo "• Start with small batch sizes to test"
    echo "• Monitor gas prices and network congestion"
    echo "• Use 'node controllers/bot.js check' to monitor progress"
    echo "• The Web GUI provides real-time monitoring and control"
}

# Function to clean up temporary files and logs
cleanup() {
    echo -e "${BLUE}🧹 Cleaning up temporary files...${NC}"
    
    # Remove backup files older than 7 days
    find "$SCRIPT_DIR" -name "*.backup*" -type f -mtime +7 -delete 2>/dev/null
    
    # Clean up temporary download directory
    if [[ -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
        log "🗑️ Cleaned up temporary download directory"
    fi
    
    # Truncate log file if it's too large (>10MB)
    if [[ -f "$LOG_FILE" ]]; then
        local log_size=$(du -m "$LOG_FILE" | cut -f1)
        if [[ $log_size -gt 10 ]]; then
            echo "Log file is large (${log_size}MB). Truncating..."
            tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp"
            mv "$LOG_FILE.tmp" "$LOG_FILE"
            log "Log file truncated to last 1000 lines"
        fi
    fi
    
    # Remove temporary Node.js files
    rm -f /tmp/tmp.* 2>/dev/null
    
    log "✅ Cleanup completed"
}

# Function to update the entire project
update_project() {
    echo -e "${CYAN}🔄 Updating BasedBonkBot Project...${NC}"
    log "🔄 Starting project update..."
    
    # Backup .env file before update
    local env_backup=""
    if [[ -f "$ENV_FILE" ]]; then
        env_backup=$(extract_env_values "$ENV_FILE")
        log "📋 Backing up current configuration..."
    fi
    
    # Download latest project
    if ! download_project; then
        error_log "Failed to download project update"
        return 1
    fi
    
    # Copy new files while preserving .env
    if ! copy_project_files; then
        error_log "Failed to copy project files"
        return 1
    fi
    
    # Reinstall dependencies
    if ! install_dependencies; then
        error_log "Failed to install dependencies"
        return 1
    fi
    
    # Validate project structure
    if ! validate_project_structure; then
        error_log "Project structure validation failed"
        return 1
    fi
    
    # Clean up temporary files
    rm -rf "$TEMP_DIR"
    
    log "✅ Project update completed successfully!"
    echo ""
    echo -e "${GREEN}🎉 BasedBonkBot updated to latest version!${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Check status: $0 status"
    echo "2. Test configuration: node controllers/bot.js check"
    echo "3. Start Web GUI: $0 gui"
}


# Create log file if it doesn't exist
touch "$LOG_FILE"

# Cleanup temp directory on script exit
trap cleanup EXIT

# Main script execution
case ${1:-help} in
    setup)
        echo -e "${CYAN}🤖 Starting BasedBonkBot Complete Setup...${NC}"
        log "🔧 Setting up BasedBonkBot environment..."
        
        # Ensure Node.js is available
        ensure_nodejs
        
        # Download project from GitHub
        if ! download_project; then
            error_log "Failed to download BasedBonkBot project"
            exit 1
        fi
        
        # Copy project files
        if ! copy_project_files; then
            error_log "Failed to copy project files"
            exit 1
        fi
        
        # Install dependencies
        if ! install_dependencies; then
            error_log "Failed to install dependencies"
            exit 1
        fi
        
        # Create .env configuration
        create_env_template
        
        # Validate project structure
        if ! validate_project_structure; then
            warning_log "Project structure validation had issues, but continuing..."
        fi
        
        # Show final wallet address after dependencies are installed
        if [[ -f "$ENV_FILE" ]]; then
            local final_private_key=$(grep "PK_MAIN=" "$ENV_FILE" | cut -d'=' -f2)
            if [[ -n "$final_private_key" ]]; then
                local final_address=$(derive_address_after_setup "$final_private_key")
                if [[ -n "$final_address" && "$final_address" != "Unable to derive address" && "$final_address" != "DERIVE_LATER" ]]; then
                    echo ""
                    echo -e "${GREEN}🎯 FINAL SETUP SUMMARY${NC}"
                    echo -e "${BLUE}Funding Wallet Address: $final_address${NC}"
                    echo -e "${YELLOW}👆 Send ETH to this address for gas fees!${NC}"
                    echo ""
                fi
            fi
        fi
        
        log "✅ BasedBonkBot setup completed!"
        echo ""
        echo -e "${GREEN}🚀 Setup Complete! Next Steps:${NC}"
        echo "🌐 Launch Web GUI: npm run start"
        ;;
    
    update)
        echo -e "${CYAN}🔄 Updating BasedBonkBot Project...${NC}"
        log "🔄 Updating BasedBonkBot project..."
        ensure_nodejs
        update_project
        log "✅ Update completed!"
        ;;
    
    pull)
        echo -e "${CYAN}🔄 Pulling Latest Install Script and Updating...${NC}"
        log "🔄 Pulling latest install script..."
        
        # Create backup of current script
        if [[ -f "$0" ]]; then
            cp "$0" "$0.backup.$(date +%Y%m%d_%H%M%S)"
            log "📋 Backed up current install script"
        fi
        
        # Download and execute latest install script
        temp_script=$(mktemp)
        if command -v wget &> /dev/null; then
            if wget -O "$temp_script" "https://raw.githubusercontent.com/$GITHUB_REPO/refs/heads/$GITHUB_BRANCH/install.sh"; then
                chmod +x "$temp_script"
                log "✅ Downloaded latest install script"
                echo -e "${BLUE}🚀 Executing latest install script...${NC}"
                exec "$temp_script" update
            else
                error_log "❌ Failed to download install script"
                rm -f "$temp_script"
                exit 1
            fi
        elif command -v curl &> /dev/null; then
            if curl -s -L "https://raw.githubusercontent.com/$GITHUB_REPO/refs/heads/$GITHUB_BRANCH/install.sh" -o "$temp_script"; then
                chmod +x "$temp_script"
                log "✅ Downloaded latest install script"
                echo -e "${BLUE}🚀 Executing latest install script...${NC}"
                exec "$temp_script" update
            else
                error_log "❌ Failed to download install script"
                rm -f "$temp_script"
                exit 1
            fi
        else
            error_log "Neither wget nor curl found. Cannot download install script."
            exit 1
        fi
        ;;
    
    validate)
        echo -e "${CYAN}🔍 Validating BasedBonkBot Project...${NC}"
        log "🔍 Validating BasedBonkBot project..."
        ensure_nodejs
        if validate_project_structure; then
            log "✅ Project validation passed"
            echo -e "${GREEN}✅ BasedBonkBot project validated successfully!${NC}"
        else
            error_log "❌ Project validation failed"
            echo -e "${RED}❌ Project validation failed. Run '$0 update' to fix.${NC}"
            exit 1
        fi
        ;;
    
    check-node)
        echo -e "${CYAN}🔍 Checking Node.js Installation...${NC}"
        log "🔍 Checking Node.js installation..."
        if check_nodejs_version; then
            log "✅ Node.js is properly installed"
            echo -e "${GREEN}✅ Node.js is properly installed and compatible${NC}"
        else
            warning_log "Node.js is not installed or version is too old"
            echo -e "${RED}❌ Node.js issue detected${NC}"
            echo "Run '$0 setup' to install Node.js automatically"
        fi
        ;;
    
    status)
        check_system_status
        ;;
esac

log "Script execution completed"