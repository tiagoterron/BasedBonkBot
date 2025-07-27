//V 1.0.8
const express = require('express');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const bodyParser = require('body-parser');
const cors = require('cors');
// const statsRoutes = require('./source/stats-api');
const os = require('os');

function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  
  for (const interfaceName in networkInterfaces) {
    const addresses = networkInterfaces[interfaceName];
    
    for (const address of addresses) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  
  return '127.0.0.1'; // fallback
}

const hostname = getLocalIP();

const app = express();


const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
};

// Fix: Remove quotes around corsOptions
app.use(cors(corsOptions)); // Not 'corsOptions'
app.options('*', cors(corsOptions));
app.use(express.static("public"));
app.use('/images', express.static(path.join('./', 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const buildPath = path.resolve(__dirname, '../app');
app.use(express.static(buildPath));



app.use(bodyParser.json());


const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });


const { 
    config,
    provider,
    addTokens,
    addSingleToken,
    loadTokens,
    saveTokens,
    getTokenByAddress,
    getTokensBySymbol,
    errorLog,
    sleep,
    log,
    saveWallets,
    randomIndex,
    loadWallets,
    createWallets,
    savePrivateKey,
    analyzeTransactionGas,
    analyzeGasPrice,
    getGasEstimates,
    contracts,
    routerAbi,
    airdropAbi,
    multicallAbi,
    turboDeployerAbi,
    volumeSwapAbi,
    ERC20_ABI,
    defaultTokens,
    LockyFiDeployerAbi,
    getContractAddress,
    createWalletsToTarget,
    checkWallets,
    loadWalletsBalances,
    loadWalletsBalanceSorted
} = require("../controllers/helper")

app.use(express.json());
app.use(express.static('public')); // Serve the HTML file
app.use(express.static('app/dist')); // Serve the HTML file

// Load environment variables for RPC connection
require('dotenv').config();

// Store active processes and WebSocket connections
const activeProcesses = new Map();
const wsConnections = new Set();

// Gas price cache to avoid excessive API calls
let gasPriceCache = {
    data: null,
    lastUpdate: 0,
    cacheTime: 30000 // 30 seconds cache
};

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');
    wsConnections.add(ws);
    
    // Send initial connection confirmation
    ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        timestamp: new Date().toISOString()
    }));
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        wsConnections.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsConnections.delete(ws);
    });
});

// Broadcast message to all connected WebSocket clients
function broadcast(message) {
    const messageStr = JSON.stringify(message);
    wsConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(messageStr);
            } catch (error) {
                console.error('Error sending WebSocket message:', error);
                wsConnections.delete(ws);
            }
        }
    });
}

// Enhanced gas price calculation with real blockchain data
async function calculateGasPrices() {
    try {
        // Check cache first
        const now = Date.now();
        if (gasPriceCache.data && (now - gasPriceCache.lastUpdate) < gasPriceCache.cacheTime) {
            return gasPriceCache.data;
        }

        console.log('Fetching fresh gas price data...');

        // Initialize provider
        const rpcUrl = process.env.RPC_URL || "https://base-mainnet.g.alchemy.com/v2/your-api-key";
        let provider;
        
        try {
            provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            
            // Test connection
            await provider.getNetwork();
        } catch (rpcError) {
            console.warn('RPC connection failed, using fallback provider');
            // Fallback to a public Base RPC
            provider = new ethers.providers.JsonRpcProvider("https://mainnet.base.org");
        }

        // Get current gas price from blockchain
        const currentGasPrice = await provider.getGasPrice();
        const currentGasPriceGwei = parseFloat(ethers.utils.formatUnits(currentGasPrice, 9));

        console.log(`Current gas price: ${currentGasPriceGwei} Gwei`);

        // Apply the same gas price logic as your script
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let adjustedGasPrice = currentGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : currentGasPrice.mul(120).div(100); // 5x minimum or 20% boost

        const adjustedGasPriceGwei = parseFloat(ethers.utils.formatUnits(adjustedGasPrice, 9));
        const recommendedGasPriceGwei = adjustedGasPriceGwei * 1.1; // 10% higher for recommended

        // Fetch ETH price from CoinGecko
        let ethPriceUSD = 0; // Fallback price
        
        try {
            const ethPriceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', {
                timeout: 5000
            });
            
            if (ethPriceResponse.ok) {
                const ethPriceData = await ethPriceResponse.json();
                ethPriceUSD = ethPriceData.ethereum.usd;
                console.log(`ETH price: $${ethPriceUSD}`);
            }
        } catch (priceError) {
            console.warn('Failed to fetch ETH price, using fallback:', priceError.message);
        }

        // Calculate costs for micro transactions
        // Standard ETH transfer: 21,000 gas
        // Smart contract swap: ~150,000-300,000 gas (we'll use 200,000 as average)
        
        const microTxGasLimit = 21000; // Simple ETH transfer
        const swapTxGasLimit = 200000; // Average for swaps
        
        // Calculate costs using adjusted gas price
        const microTxGasCostETH = (adjustedGasPriceGwei * microTxGasLimit) / 1e9; // Convert Gwei to ETH
        const microTxGasCostUSD = microTxGasCostETH * ethPriceUSD;
        
        const swapTxGasCostETH = (adjustedGasPriceGwei * swapTxGasLimit) / 1e9;
        const swapTxGasCostUSD = swapTxGasCostETH * ethPriceUSD;
        
        // Calculate for 1000 transactions
        const cost1000MicroTxUSD = microTxGasCostUSD * 1000;
        const cost1000SwapTxUSD = swapTxGasCostUSD * 1000;

        // Create result object
        const result = {
            timestamp: new Date().toISOString(),
            network: 'Base Mainnet',
            
            // Raw gas prices
            currentGasPriceGwei: currentGasPriceGwei,
            adjustedGasPriceGwei: adjustedGasPriceGwei,
            recommendedGasPriceGwei: recommendedGasPriceGwei,
            
            // ETH price
            ethPriceUSD: ethPriceUSD,
            
            // Micro transaction costs (21,000 gas)
            costPerMicroTxETH: microTxGasCostETH.toFixed(8),
            costPerMicroTxUSD: microTxGasCostUSD.toFixed(6),
            costPer1000MicroTxUSD: cost1000MicroTxUSD.toFixed(2),
            
            // Swap transaction costs (200,000 gas average)
            costPerSwapTxETH: swapTxGasCostETH.toFixed(8),
            costPerSwapTxUSD: swapTxGasCostUSD.toFixed(6),
            costPer1000SwapTxUSD: cost1000SwapTxUSD.toFixed(2),
            
            // For backward compatibility with frontend
            costPerTxUSD: microTxGasCostUSD.toFixed(6),
            costPer1000TxUSD: cost1000MicroTxUSD.toFixed(2),
            
            // Gas limits used
            microTxGasLimit: microTxGasLimit,
            swapTxGasLimit: swapTxGasLimit,
            
            // Network health indicators
            gasMultiplier: adjustedGasPriceGwei / currentGasPriceGwei,
            networkCongestion: currentGasPriceGwei >= 0.05 ? 'High' : currentGasPriceGwei > 0.02 ? 'Medium' : 'Low'
        };

        // Update cache
        gasPriceCache.data = result;
        gasPriceCache.lastUpdate = now;

        console.log('Gas price calculation completed:', {
            gasPrice: `${adjustedGasPriceGwei.toFixed(3)} Gwei`,
            ethPrice: `$${ethPriceUSD}`,
            cost1000MicroTx: `$${cost1000MicroTxUSD.toFixed(2)}`,
            cost1000SwapTx: `$${cost1000SwapTxUSD.toFixed(2)}`
        });

        return result;

    } catch (error) {
        console.error('Error calculating gas prices:', error);
        
        // Return fallback data if calculation fails
        const fallbackData = {
            timestamp: new Date().toISOString(),
            network: 'Fallback Data',
            error: error.message,
            
            currentGasPriceGwei: 1.0,
            adjustedGasPriceGwei: 1.2,
            recommendedGasPriceGwei: 1.32,
            
            ethPriceUSD: 3500,
            
            costPerMicroTxETH: "0.0000252",
            costPerMicroTxUSD: "0.088200",
            costPer1000MicroTxUSD: "88.20",
            
            costPerSwapTxETH: "0.0024000",
            costPerSwapTxUSD: "8.400000",
            costPer1000SwapTxUSD: "8400.00",
            
            costPerTxUSD: "0.088200",
            costPer1000TxUSD: "88.20",
            
            microTxGasLimit: 21000,
            swapTxGasLimit: 200000,
            
            gasMultiplier: 1.2,
            networkCongestion: 'Unknown'
        };
        
        return fallbackData;
    }
}

// Gas prices API endpoint
app.get('/api/gas-prices', async (req, res) => {
    try {
        const gasData = await calculateGasPrices();

        
        res.json({
            success: true,
            ...gasData
        });
        
    } catch (error) {
        console.error('Gas prices API error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Failed to fetch gas prices',
            details: error.message
        });
    }
});

// Gas cost estimation for specific transaction types
app.post('/api/estimate-gas', async (req, res) => {
    try {
        const { transactionType = 'micro', quantity = 1 } = req.body;
        
        const gasData = await calculateGasPrices();
        
        let gasLimit, costPerTx, costPerTxUSD;
        
        switch (transactionType.toLowerCase()) {
            case 'micro':
            case 'transfer':
                gasLimit = gasData.microTxGasLimit;
                costPerTx = gasData.costPerMicroTxETH;
                costPerTxUSD = gasData.costPerMicroTxUSD;
                break;
                
            case 'swap':
            case 'uniswap':
                gasLimit = gasData.swapTxGasLimit;
                costPerTx = gasData.costPerSwapTxETH;
                costPerTxUSD = gasData.costPerSwapTxUSD;
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid transaction type. Use "micro" or "swap"'
                });
        }
        
        const totalCostETH = (parseFloat(costPerTx) * quantity).toFixed(8);
        const totalCostUSD = (parseFloat(costPerTxUSD) * quantity).toFixed(2);
        
        res.json({
            success: true,
            transactionType,
            quantity,
            gasPrice: gasData.adjustedGasPriceGwei,
            gasLimit,
            costPerTransaction: {
                eth: costPerTx,
                usd: costPerTxUSD
            },
            totalCost: {
                eth: totalCostETH,
                usd: totalCostUSD
            },
            networkInfo: {
                congestion: gasData.networkCongestion,
                ethPrice: gasData.ethPriceUSD,
                timestamp: gasData.timestamp
            }
        });
        
    } catch (error) {
        console.error('Gas estimation error:', error);
        
        res.status(500).json({
            success: false,
            error: 'Failed to estimate gas costs',
            details: error.message
        });
    }
});

// Validate token address format
function isValidTokenAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Validate numeric inputs
function isValidNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const num = parseFloat(value);
    return !isNaN(num) && num >= min && num <= max;
}

// Enhanced command validation
function validateCommand(command, args) {
    const errors = [];
    
    switch (command) {
        case 'volumeV2':
        case 'volumeV3':
            if (args[0] && !isValidNumber(args[0], 0)) {
                errors.push('Start index must be a valid number >= 0');
            }
            if (args[1] && !isValidNumber(args[1], 1)) {
                errors.push('End index must be a valid number >= 1');
            }
            if (args[2] && !isValidTokenAddress(args[2])) {
                errors.push('Token address must be a valid Ethereum address (0x...)');
            }
            // if (args[4] && !isValidNumber(args[3], 50, 60000)) {
            //     errors.push('TX delay must be between 50-60000 milliseconds');
            // }
            // if (args[5] && !isValidNumber(args[4], 1000, 300000)) {
            //     errors.push('Cycle delay must be between 1000-300000 milliseconds');
            // }
            break;
            
        case 'create':
        case 'target':
            if (args[0] && !isValidNumber(args[0], 1, 50000)) {
                errors.push('Wallet count must be between 1-50000');
            }
            break;
            
        case 'swap':
        case 'multiswap':
        case 'swapv3':
        case 'multiswapV3':
    // args[0] = batchSize (must be >= 1)
    if (args[0] && !isValidNumber(args[0], 1)) {
        errors.push('Batch size must be >= 1');
    }
    
    // args[1] = tokenAddresses (comma-separated string, optional - can use defaults)
    if (args[1] && args[1].trim()) {
        const tokenAddresses = args[1].split(',').map(addr => addr.trim()).filter(addr => addr);
        for (const tokenAddr of tokenAddresses) {
            if (!isValidTokenAddress(tokenAddr)) {
                errors.push(`Invalid token address: ${tokenAddr}`);
            }
        }
        if (tokenAddresses.length === 0) {
            errors.push('At least one valid token address required when tokens are specified');
        }
    }
    
    // args[2] = startAt (must be >= 0)
    if (args[2] && !isValidNumber(args[2], 0)) {
        errors.push('Start index must be >= 0');
    }
    
    // args[3] = endAt (must be >= 1 and > startAt if both provided)
    if (args[3] && !isValidNumber(args[3], 1)) {
        errors.push('End index must be >= 1');
    }
    
    // Validate startAt < endAt if both provided
    if (args[2] && args[3]) {
        const startAt = parseInt(args[2]);
        const endAt = parseInt(args[3]);
        if (startAt >= endAt) {
            errors.push('Start index must be less than end index');
        }
    }
    
    // args[4] = delayBetweenBatches (must be >= 0 if provided)
    if (args[4] && !isValidNumber(args[4], 0)) {
        errors.push('Delay between batches must be >= 0');
    }
    
    // args[5] = delayBetweenTx (must be >= 0 if provided)
    if (args[5] && !isValidNumber(args[5], 0)) {
        errors.push('Delay between transactions must be >= 0');
    }
    
    break;
            
        case 'deploy':
        case 'withdraw-token':
            if (!args[0] || !isValidTokenAddress(args[0])) {
                errors.push('Valid token address is required');
            }
            break;
    }
    
    return errors;
}

// Add these API endpoints to your existing Express server

// ============================================================================
// WALLET MANAGEMENT APIs
// ============================================================================

// Get comprehensive wallet statistics
app.get('/api/wallets/stats', async (req, res) => {
    try {
        const wallets = loadWallets();
        
        if (wallets.length === 0) {
            return res.json({
                success: true,
                totalWallets: 0,
                wallets: [],
                mainWallet: null,
                summary: {
                    totalETH: "0",
                    avgBalance: "0",
                    fundedWallets: 0,
                    emptyWallets: 0
                }
            });
        }

        // Get main wallet info
        let mainWalletInfo = null;
        if (config.fundingPrivateKey) {
            try {
                const mainWallet = new ethers.Wallet(config.fundingPrivateKey, provider);
                const mainBalance = await provider.getBalance(mainWallet.address);
                
                mainWalletInfo = {
                    address: mainWallet.address,
                    balance: ethers.utils.formatEther(mainBalance),
                    balanceWei: mainBalance.toString()
                };
            } catch (error) {
                console.error('Error fetching main wallet:', error);
                mainWalletInfo = {
                    error: 'Failed to load main wallet',
                    details: error.message
                };
            }
        }

        // Sample first 5 wallets for balance checking (to avoid rate limiting)
        const sampleSize = Math.min(5, wallets.length);
        const sampleWallets = [];
        let totalETH = ethers.BigNumber.from(0);
        let fundedWallets = 0;
        
        for (let i = 0; i < sampleSize; i++) {
            try {
                const balance = await provider.getBalance(wallets[i][0]);
                const balanceETH = ethers.utils.formatEther(balance);
                
                sampleWallets.push({
                    index: i,
                    address: wallets[i][0],
                    balance: balanceETH,
                    balanceWei: balance.toString()
                });
                
                totalETH = totalETH.add(balance);
                if (balance.gt(0)) fundedWallets++;
                
                // Small delay to avoid rate limiting
                if (i < sampleSize - 1) await sleep(100);
                
            } catch (error) {
                console.error(`Error checking wallet ${i}:`, error);
                sampleWallets.push({
                    index: i,
                    address: wallets[i][0],
                    balance: "0",
                    balanceWei: "0",
                    error: error.message
                });
            }
        }

        const avgBalance = sampleSize > 0 ? 
            ethers.utils.formatEther(totalETH.div(sampleSize)) : "0";

        res.json({
            success: true,
            totalWallets: wallets.length,
            sampleSize: sampleSize,
            sampleWallets: sampleWallets,
            mainWallet: mainWalletInfo,
            summary: {
                totalETHSample: ethers.utils.formatEther(totalETH),
                avgBalance: avgBalance,
                fundedWallets: fundedWallets,
                emptyWallets: sampleSize - fundedWallets,
                estimatedTotalValue: parseFloat(avgBalance) * wallets.length
            },
            firstWallet: wallets.length > 0 ? wallets[0][0] : null,
            lastWallet: wallets.length > 0 ? wallets[wallets.length - 1][0] : null
        });

    } catch (error) {
        console.error('Error fetching wallet stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch wallet statistics',
            details: error.message
        });
    }
});


app.get('/api/wallets/balances', async (req, res) => {
    try {
        const wallets = await loadWalletsBalanceSorted();


        res.status(200).json(wallets);

    } catch (error) {
        console.error('Error fetching wallet stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch wallet statistics',
            details: error.message
        });
    }
});


// Get specific wallet details
app.get('/api/wallets/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const wallets = loadWallets();
        
        if (index < 0 || index >= wallets.length) {
            return res.status(404).json({
                success: false,
                error: 'Wallet index out of range'
            });
        }

        const walletAddress = wallets[index][0];
        const balance = await provider.getBalance(walletAddress);
        
        res.json({
            success: true,
            index: index,
            address: walletAddress,
            balance: ethers.utils.formatEther(balance),
            balanceWei: balance.toString(),
            hasPrivateKey: true
        });

    } catch (error) {
        console.error('Error fetching wallet details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch wallet details',
            details: error.message
        });
    }
});

// Get main wallet detailed information
app.get('/api/wallet/main', async (req, res) => {
    try {
        if (!config.fundingPrivateKey) {
            return res.json({
                success: false,
                error: 'Main wallet not configured (PK_MAIN missing in .env)'
            });
        }

        const mainWallet = new ethers.Wallet(config.fundingPrivateKey, provider);
        const balance = await provider.getBalance(mainWallet.address);
        
        // Get transaction count (nonce)
        const nonce = await provider.getTransactionCount(mainWallet.address);
        
        // Get recent gas price for cost estimation
        const gasPrice = await provider.getGasPrice();
        const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 9);

        res.json({
            success: true,
            address: mainWallet.address,
            balance: ethers.utils.formatEther(balance),
            balanceWei: balance.toString(),
            nonce: nonce,
            gasPrice: gasPriceGwei,
            network: await provider.getNetwork(),
            canFund: balance.gt(ethers.utils.parseEther("0.001")) // Can fund if > 0.001 ETH
        });

    } catch (error) {
        console.error('Error fetching main wallet:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch main wallet information',
            details: error.message
        });
    }
});

// Create new wallets via API
app.post('/api/wallets/create', async (req, res) => {
    try {
        const { count = 10 } = req.body;
        
        if (!isValidNumber(count, 1, 10000)) {
            return res.status(400).json({
                success: false,
                error: 'Count must be between 1 and 10000'
            });
        }

        const existingWallets = loadWallets();
        const newWallets = [];
        
        for (let i = 0; i < count; i++) {
            const wallet = ethers.Wallet.createRandom();
            newWallets.push([wallet.address, wallet.privateKey]);
        }
        
        const allWallets = [...existingWallets, ...newWallets];
        saveWallets(allWallets);

        res.json({
            success: true,
            created: count,
            totalWallets: allWallets.length,
            newAddresses: newWallets.map(w => w[0])
        });

    } catch (error) {
        console.error('Error creating wallets:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create wallets',
            details: error.message
        });
    }
});

// Update .env file endpoint
app.post('/api/settings/update-env', async (req, res) => {
    try {
        const { rpcUrl, gasMax } = req.body;
        
        // Validate inputs
        if (!rpcUrl || !gasMax) {
            return res.status(400).json({
                success: false,
                error: 'RPC URL and Gas Max are required'
            });
        }
        
        const fs = require('fs');
        const path = require('path');
        
        const envPath = path.join(__dirname, '.env');
        
        let envContent = '';
        
        // Read existing .env file if it exists
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        // Parse existing env content into key-value pairs
        const envLines = envContent.split('\n');
        const envVars = {};
        
        envLines.forEach(line => {
            if (line.trim() && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    envVars[key.trim()] = valueParts.join('=').trim();
                }
            }
        });
        
        // Update the specific variables
        envVars['RPC_URL'] = rpcUrl;
        envVars['GAS_MAX'] = gasMax;
        
        // Rebuild the .env content
        const updatedLines = [];
        
        // Add header comment
        updatedLines.push('# TurboBot Configuration');
        updatedLines.push('# Updated via Web Interface: ' + new Date().toISOString());
        updatedLines.push('');
        
        // Add essential variables first
        const essentialVars = ['RPC_URL', 'GAS_MAX', 'PK_MAIN'];
        essentialVars.forEach(key => {
            if (envVars[key] !== undefined) {
                updatedLines.push(`${key}=${envVars[key]}`);
                delete envVars[key]; // Remove from remaining vars
            }
        });
        
        updatedLines.push('');
        updatedLines.push('# Other Configuration');
        
        // Add remaining variables
        Object.entries(envVars).forEach(([key, value]) => {
            updatedLines.push(`${key}=${value}`);
        });
        
        // Write the updated content back to .env
        const newEnvContent = updatedLines.join('\n');
        fs.writeFileSync(envPath, newEnvContent, 'utf8');
        
        console.log('✅ .env file updated successfully');
        console.log(`   RPC_URL: ${rpcUrl}`);
        console.log(`   GAS_MAX: ${gasMax}`);
        
        res.json({
            success: true,
            message: '.env file updated successfully',
            updatedVars: {
                RPC_URL: rpcUrl,
                GAS_MAX: gasMax
            }
        });
        
    } catch (error) {
        console.error('Error updating .env file:', error);
        
        res.status(500).json({
            success: false,
            error: 'Failed to update .env file',
            details: error.message
        });
    }
});

app.get('/api/settings', (req, res) => {
    try {
        // Return current configuration (without sensitive data)
        const safeConfig = {
            rpcUrl: config.rpcUrl,
            gasMax: config.gasSettings.gasMax,
            hasMainWallet: !!config.fundingPrivateKey,
            defaultWalletCount: config.defaultWalletCount,
            defaultChunkSize: config.defaultChunkSize,
            defaultBatchSize: config.defaultBatchSize,
            defaultV3Fee: config.defaultV3Fee
        };
        
        res.json({
            success: true,
            settings: safeConfig
        });
        
    } catch (error) {
        console.error('Settings API error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get settings',
            details: error.message
        });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const { rpcUrl, gasMax } = req.body;
        
        // Validate inputs
        if (!rpcUrl || typeof rpcUrl !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Valid RPC URL is required'
            });
        }
        
        if (!gasMax || isNaN(parseFloat(gasMax)) || parseFloat(gasMax) <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Valid Gas Max value is required'
            });
        }
        
        // Validate RPC URL format
        try {
            new URL(rpcUrl);
        } catch (urlError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid RPC URL format'
            });
        }
        
        // Update configuration
        config.rpcUrl = rpcUrl;
        config.gasSettings.gasMax = gasMax;
        
        // Update the provider with new RPC URL
        const { ethers } = require('ethers');
        const newProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
        
        // Test the new provider
        try {
            await newProvider.getNetwork();
            console.log(`✅ Settings updated - RPC: ${rpcUrl}, Gas Max: ${gasMax} ETH`);
        } catch (providerError) {
            console.warn(`⚠️ Settings updated but provider test failed: ${providerError.message}`);
        }
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            settings: {
                rpcUrl: config.rpcUrl,
                gasMax: config.gasSettings.gasMax
            }
        });
        
    } catch (error) {
        console.error('Settings update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update settings',
            details: error.message
        });
    }
});

app.post('/api/settings/test-rpc', async (req, res) => {
    try {
        const { rpcUrl } = req.body;
        
        if (!rpcUrl) {
            return res.status(400).json({
                success: false,
                error: 'RPC URL is required'
            });
        }
        
        // Validate URL format
        try {
            new URL(rpcUrl);
        } catch (urlError) {
            return res.status(400).json({
                success: false,
                error: 'Invalid RPC URL format'
            });
        }
        
        // Test connection
        const { ethers } = require('ethers');
        const testProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
        
        // Get network info with timeout
        const networkPromise = testProvider.getNetwork();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), 10000)
        );
        
        const network = await Promise.race([networkPromise, timeoutPromise]);
        
        // Get additional network info
        let blockNumber;
        try {
            blockNumber = await testProvider.getBlockNumber();
        } catch (blockError) {
            blockNumber = null;
        }
        
        const networkInfo = {
            name: network.name,
            chainId: network.chainId,
            blockNumber: blockNumber
        };
        
        res.json({
            success: true,
            message: 'RPC connection successful',
            networkInfo: networkInfo
        });
        
    } catch (error) {
        console.error('RPC test error:', error);
        
        let errorMessage = error.message;
        if (error.code === 'NETWORK_ERROR') {
            errorMessage = 'Network connection failed - check URL and internet connection';
        } else if (error.code === 'SERVER_ERROR') {
            errorMessage = 'RPC server error - the endpoint may be down or invalid';
        }
        
        res.json({
            success: false,
            error: errorMessage
        });
    }
});


app.post('/api/contract/find-address', async (req, res) => {
   try {
       const { tokenAddress } = req.body;
       
       // Validate required parameters
       if (!tokenAddress || !isValidTokenAddress(tokenAddress)) {
           return res.status(400).json({
               success: false,
               error: 'Valid token address is required'
           });
       }
       
       let mainWallet = new ethers.Wallet(config.fundingPrivateKey);

       // Call the helper function
       const result = await getContractAddress(tokenAddress, mainWallet.address, contracts.deployerContract);
       
       if (result.success) {
           // Check contract funding (ETH and token balance)
           let ethBalance = "0";
           let tokenBalance = "0";
           let tokenSymbol = "UNKNOWN";
           let tokenDecimals = 18;
           let tokenName = "Unknown Token";
           let hasError = false;
           let errorDetails = null;
           
           try {
               // Get ETH balance of the contract
               const ethBalanceWei = await provider.getBalance(result.contractAddress);
               ethBalance = ethers.utils.formatEther(ethBalanceWei);
               
               // Get token contract details and balance
               const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
               
               // Get token info
               try {
                   tokenSymbol = await tokenContract.symbol();
               } catch (e) {
                   console.log('Could not fetch token symbol');
               }
               
               try {
                   tokenDecimals = await tokenContract.decimals();
               } catch (e) {
                   console.log('Could not fetch token decimals');
               }
               
               try {
                   tokenName = await tokenContract.name();
               } catch (e) {
                   console.log('Could not fetch token name');
               }
               
               // Get token balance of the contract
               const tokenBalanceWei = await tokenContract.balanceOf(result.contractAddress);
               tokenBalance = ethers.utils.formatUnits(tokenBalanceWei, tokenDecimals);
               
               console.log(`Contract ${result.contractAddress} balances:`);
               console.log(`ETH: ${ethBalance} ETH`);
               console.log(`${tokenSymbol}: ${tokenBalance} ${tokenSymbol}`);
               
           } catch (balanceError) {
               console.error('Error fetching contract balances:', balanceError);
               hasError = true;
               errorDetails = balanceError.message;
           }
           
           // Get current ETH price for USD calculations
           let ethPriceUSD = 0;
           try {
               const gasData = await calculateGasPrices();
               ethPriceUSD = gasData.ethPriceUSD || 0;
           } catch (priceError) {
               console.log('Could not fetch ETH price for USD calculation');
           }
           
           const ethBalanceUSD = parseFloat(ethBalance) * ethPriceUSD;
           
           res.json({
               success: true,
               contractAddress: result.contractAddress,
               tokenAddress: result.tokenAddress,
               ownerAddress: result.ownerAddress,
               deployerContract: contracts.deployerContract,
               timestamp: new Date().toISOString(),
               balances: {
                   eth: {
                       balance: ethBalance,
                       balanceUSD: ethBalanceUSD.toFixed(6),
                       hasBalance: parseFloat(ethBalance) > 0
                   },
                   token: {
                       balance: tokenBalance,
                       symbol: tokenSymbol,
                       name: tokenName,
                       decimals: tokenDecimals,
                       hasBalance: parseFloat(tokenBalance) > 0,
                       address: tokenAddress
                   }
               },
               fundingStatus: {
                   hasFunding: parseFloat(ethBalance) > 0 || parseFloat(tokenBalance) > 0,
                   ethFunded: parseFloat(ethBalance) > 0,
                   tokenFunded: parseFloat(tokenBalance) > 0,
                   totalValueUSD: ethBalanceUSD.toFixed(2)
               },
               balanceCheckError: hasError,
               balanceErrorDetails: errorDetails
           });
       } else {
           res.json({
               success: false,
               reason: result.reason,
               error: result.error || 'Contract not found',
               contractAddress: result.contractAddress,
               tokenAddress: tokenAddress,
               ownerAddress: mainWallet.address,
               deployerContract: contracts.deployerContract
           });
       }
       
   } catch (error) {
       console.error('Contract finder API error:', error);
       
       res.status(500).json({
           success: false,
           error: 'Failed to find contract address',
           details: error.message
       });
   }
});

// ============================================================================
// TOKEN DATABASE APIs  
// ============================================================================

app.get('/api/', (req, res) => {
    res.json({
        status: true
    })
})

// Get all tokens in database
app.get('/api/tokens', (req, res) => {
    try {
        const tokens = loadTokens();
        
        // Group tokens by symbol for better organization
        const tokensBySymbol = {};
        tokens.forEach(token => {
            if (!tokensBySymbol[token.symbol]) {
                tokensBySymbol[token.symbol] = [];
            }
            tokensBySymbol[token.symbol].push(token);
        });

        res.json({
            success: true,
            totalTokens: tokens.length,
            uniqueSymbols: Object.keys(tokensBySymbol).length,
            tokens: tokens,
            tokensBySymbol: tokensBySymbol,
            recentlyAdded: tokens
                .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
                .slice(0, 10)
        });

    } catch (error) {
        console.error('Error fetching tokens:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch tokens',
            details: error.message
        });
    }
});

// Get specific token by address
app.get('/api/tokens/:address', (req, res) => {
    try {
        const address = req.params.address;
        
        if (!isValidTokenAddress(address)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid token address format'
            });
        }

        const token = getTokenByAddress(address);
        
        if (!token) {
            return res.status(404).json({
                success: false,
                error: 'Token not found in database'
            });
        }

        res.json({
            success: true,
            token: token
        });

    } catch (error) {
        console.error('Error fetching token:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch token',
            details: error.message
        });
    }
});

// Add new token(s) to database
app.post('/api/tokens/add', async (req, res) => {
    try {
        const { addresses } = req.body;
        
        if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Addresses array is required'
            });
        }

        // Validate all addresses
        const invalidAddresses = addresses.filter(addr => !isValidTokenAddress(addr));
        if (invalidAddresses.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid addresses: ${invalidAddresses.join(', ')}`
            });
        }

        // Add tokens using the enhanced function from your codebase
        const result = await addTokens(addresses);

        res.json({
            success: true,
            message: `Successfully processed ${addresses.length} token addresses`,
            added: result.added.length,
            failed: result.failed.length,
            duplicates: result.summary.duplicateCount,
            totalTokens: result.total,
            details: {
                successful: result.added,
                failed: result.failed
            }
        });

    } catch (error) {
        console.error('Error adding tokens:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add tokens',
            details: error.message
        });
    }
});

// Search tokens by symbol
app.get('/api/tokens/search/:symbol', (req, res) => {
    try {
        const symbol = req.params.symbol;
        const tokens = getTokensBySymbol(symbol);

        res.json({
            success: true,
            symbol: symbol,
            found: tokens.length,
            tokens: tokens
        });

    } catch (error) {
        console.error('Error searching tokens:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to search tokens',
            details: error.message
        });
    }
});

// Get default tokens configuration
app.get('/api/tokens/defaults', (req, res) => {
    try {
        res.json({
            success: true,
            defaultTokens: defaultTokens,
            v2Tokens: defaultTokens.V2 || [],
            v3Tokens: defaultTokens.V3 || []
        });

    } catch (error) {
        console.error('Error fetching default tokens:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch default tokens',
            details: error.message
        });
    }
});

// ============================================================================
// SYSTEM CONFIGURATION APIs
// ============================================================================

// Get current configuration
app.get('/api/config', (req, res) => {
    try {
        // Don't expose sensitive data like private keys
        const safeConfig = {
            rpcUrl: config.rpcUrl ? config.rpcUrl.replace(/\/[a-zA-Z0-9]+$/, '/***') : null,
            hasMainWallet: !!config.fundingPrivateKey,
            defaultWalletCount: config.defaultWalletCount,
            defaultChunkSize: config.defaultChunkSize,
            defaultBatchSize: config.defaultBatchSize,
            defaultV3Fee: config.defaultV3Fee,
            gasSettings: {
                gasMax: config.gasSettings.gasMax,
                hasCustomGasPrice: !!config.gasSettings.gasPrice,
                hasCustomGasLimit: !!config.gasSettings.gasLimit
            },
            contracts: contracts
        };

        res.json({
            success: true,
            config: safeConfig
        });

    } catch (error) {
        console.error('Error fetching config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch configuration',
            details: error.message
        });
    }
});

// Get comprehensive dashboard data (combines everything)
app.get('/api/dashboard', async (req, res) => {
    try {
        // Get wallet stats (limited sample to avoid long response time)
        const wallets = loadWallets();
        let mainWalletInfo = null;
        
        if (config.fundingPrivateKey) {
            try {
                const mainWallet = new ethers.Wallet(config.fundingPrivateKey, provider);
                const mainBalance = await provider.getBalance(mainWallet.address);
                
                mainWalletInfo = {
                    address: mainWallet.address,
                    balance: ethers.utils.formatEther(mainBalance),
                    balanceWei: mainBalance.toString()
                };
            } catch (error) {
                mainWalletInfo = { error: 'Failed to load main wallet' };
            }
        }

        // Get token stats
        const tokens = loadTokens();
        const tokensBySymbol = {};
        tokens.forEach(token => {
            if (!tokensBySymbol[token.symbol]) {
                tokensBySymbol[token.symbol] = [];
            }
            tokensBySymbol[token.symbol].push(token);
        });

        // Get gas prices
        const gasData = await calculateGasPrices();

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            dashboard: {
                wallets: {
                    total: wallets.length,
                    firstAddress: wallets.length > 0 ? wallets[0][0] : null,
                    lastAddress: wallets.length > 0 ? wallets[wallets.length - 1][0] : null
                },
                mainWallet: mainWalletInfo,
                tokens: {
                    total: tokens.length,
                    uniqueSymbols: Object.keys(tokensBySymbol).length,
                    recent: tokens
                        .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
                        .slice(0, 5)
                },
                gas: {
                    ...gasData
                },
                system: {
                    activeProcesses: activeProcesses.size,
                    wsConnections: wsConnections.size,
                    uptime: process.uptime()
                }
            }
        });

    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard data',
            details: error.message
        });
    }
});

// Enhanced execute endpoint with real-time streaming
app.post('/api/execute', async (req, res) => {
    const { command, args = [] } = req.body;
    
    console.log(`Executing command: ${command} ${args.join(' ')}`);
    
    // Validate the command and arguments
    const validationErrors = validateCommand(command, args);
    if (validationErrors.length > 0) {
        return res.json({
            success: false,
            error: 'Validation failed: ' + validationErrors.join(', '),
            validationErrors
        });
    }
    
    // Generate unique process ID
    const processId = Date.now().toString();
    
    try {
        // Check if script.js exists
        const scriptPath = path.join(__dirname, '../controllers/bot.js');
        if (!fs.existsSync(scriptPath)) {
            return res.json({
                success: false,
                error: 'script.js not found. Please run setup first.'
            });
        }
        
        // Spawn the Node.js process
        const childProcess = spawn('node', ['../controllers/bot.js', command, ...args], {
            cwd: __dirname,
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        
        // Store the process
        activeProcesses.set(processId, {
            process: childProcess,
            command: `${command} ${args.join(' ')}`,
            startTime: new Date(),
            output: '',
            errors: ''
        });
        
        let fullOutput = '';
        let hasError = false;
        let exitCode = null;
        
        // Handle stdout data
        childProcess.stdout.on('data', (data) => {
            const output = data.toString();
            fullOutput += output;
            
            broadcast({
                type: 'output',
                processId,
                data: output,
                timestamp: new Date().toISOString(),
                command: command
            });
            
            if (activeProcesses.has(processId)) {
                activeProcesses.get(processId).output += output;
            }
        });
        
        // Handle stderr data
        childProcess.stderr.on('data', (data) => {
            const error = data.toString();
            fullOutput += error;
            hasError = true;
            
            broadcast({
                type: 'error',
                processId,
                data: error,
                timestamp: new Date().toISOString(),
                command: command
            });
            
            if (activeProcesses.has(processId)) {
                activeProcesses.get(processId).errors += error;
            }
        });
        
        // Handle process completion
        childProcess.on('close', (code) => {
            exitCode = code;
            const success = code === 0 && !hasError;
            
            broadcast({
                type: 'complete',
                processId,
                success,
                exitCode: code,
                timestamp: new Date().toISOString(),
                command: command
            });
            
            activeProcesses.delete(processId);
            
            res.json({
                success,
                output: fullOutput,
                error: success ? null : `Process exited with code ${code}`,
                exitCode: code,
                processId,
                command: `${command} ${args.join(' ')}`
            });
        });
        
        // Handle process errors
        childProcess.on('error', (error) => {
            console.error('Process error:', error);
            
            broadcast({
                type: 'process_error',
                processId,
                error: error.message,
                timestamp: new Date().toISOString(),
                command: command
            });
            
            activeProcesses.delete(processId);
            
            res.json({
                success: false,
                error: `Failed to start process: ${error.message}`,
                processId,
                command: `${command} ${args.join(' ')}`
            });
        });
        
        // Set timeout for long-running processes
        setTimeout(() => {
            if (activeProcesses.has(processId)) {
                console.log(`Process ${processId} still running after 5 minutes, continuing...`);
                
                broadcast({
                    type: 'long_running',
                    processId,
                    message: 'Process is still running (5+ minutes). This is normal for automation commands.',
                    timestamp: new Date().toISOString(),
                    command: command
                });
            }
        }, 300000);
        
    } catch (error) {
        console.error('Execute error:', error);
        
        res.json({
            success: false,
            error: error.message,
            command: `${command} ${args.join(' ')}`
        });
    }
});

// Stop a specific process
app.post('/api/stop/:processId', (req, res) => {
    const processId = req.params.processId;
    
    if (activeProcesses.has(processId)) {
        const processInfo = activeProcesses.get(processId);
        
        try {
            processInfo.process.kill('SIGTERM');
            
            broadcast({
                type: 'stopped',
                processId,
                message: 'Process stopped by user',
                timestamp: new Date().toISOString(),
                command: processInfo.command
            });
            
            activeProcesses.delete(processId);
            
            res.json({ success: true, message: 'Process stopped' });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    } else {
        res.json({ success: false, error: 'Process not found' });
    }
});

// Enhanced stop all processes with force kill option
app.post('/api/stop-all', (req, res) => {
    const stoppedProcesses = [];
    
    activeProcesses.forEach((processInfo, processId) => {
        try {
            processInfo.process.kill('SIGTERM');
            stoppedProcesses.push(processId);
        } catch (error) {
            console.error(`Error stopping process ${processId}:`, error);
        }
    });
    
    broadcast({
        type: 'all_stopped',
        message: `Stopped ${stoppedProcesses.length} process(es)`,
        timestamp: new Date().toISOString(),
        stoppedProcesses
    });
    
    activeProcesses.clear();
    
    res.json({ 
        success: true, 
        message: `Stopped ${stoppedProcesses.length} process(es)`,
        stoppedProcesses 
    });
});

// Force kill all processes (for emergency situations)
app.post('/api/force-kill', (req, res) => {
    const killedProcesses = [];
    
    activeProcesses.forEach((processInfo, processId) => {
        try {
            processInfo.process.kill('SIGKILL'); // Force kill
            killedProcesses.push(processId);
        } catch (error) {
            console.error(`Error force killing process ${processId}:`, error);
        }
    });
    
    broadcast({
        type: 'all_stopped',
        message: `Force killed ${killedProcesses.length} process(es)`,
        timestamp: new Date().toISOString(),
        killedProcesses
    });
    
    activeProcesses.clear();
    
    res.json({ 
        success: true, 
        message: `Force killed ${killedProcesses.length} process(es)`,
        killedProcesses 
    });
});

// Get active processes
app.get('/api/processes', (req, res) => {
    const processes = Array.from(activeProcesses.entries()).map(([id, info]) => ({
        id,
        command: info.command,
        startTime: info.startTime,
        outputLength: info.output.length,
        errorLength: info.errors.length
    }));
    
    res.json({ processes });
});

// Get enhanced system status
app.get('/api/status', (req, res) => {
    const scriptExists = fs.existsSync(path.join(__dirname, 'script.js'));
    const envExists = fs.existsSync(path.join(__dirname, '.env'));
    
    res.json({
        scriptExists,
        envExists,
        activeProcesses: activeProcesses.size,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connections: wsConnections.size,
        gasCacheStatus: {
            hasCache: gasPriceCache.data !== null,
            lastUpdate: gasPriceCache.lastUpdate,
            cacheAge: gasPriceCache.lastUpdate ? Date.now() - gasPriceCache.lastUpdate : 0
        }
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    // res.sendFile(path.join(__dirname, 'public', 'index.html'));
    console.log(`Loading file!`)
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('/app', (req, res) => {
    // res.sendFile(path.join(__dirname, 'app/dist', 'index.html'));
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});


// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    
    // Stop all active processes
    activeProcesses.forEach((processInfo, processId) => {
        try {
            console.log(`Stopping process ${processId}: ${processInfo.command}`);
            processInfo.process.kill('SIGTERM');
        } catch (error) {
            console.error(`Error stopping process ${processId}:`, error);
        }
    });
    
    // Close WebSocket connections
    wsConnections.forEach(ws => {
        try {
            ws.close();
        } catch (error) {
            console.error('Error closing WebSocket:', error);
        }
    });
    
    server.close(() => {
        console.log('Server shut down gracefully');
        process.exit(0);
    });
});


// Add stats functions import
// const { 
//     getLiveStats, 
//     getDailyStats, 
//     getMonthlyStats, 
//     getStatsSummary,
//     exportHistoricalData,
//     updateWalletStats 
// } = require('./source/stats-tracker');

const getLiveStats = () => {}
const getDailyStats = () => {}
const getStatsSummary = () => {}

// Add stats routes directly to your existing app
app.get('/api/stats/live', (req, res) => {
    try {
        const stats = getLiveStats();
        
        // Format for your frontend dashboard
        const response = {
            successful: stats.successfulTransactions,
            failed: stats.failedTransactions,
            successRate: `${stats.successRate}%`,
            gasUsed: `${parseFloat(stats.totalGasCost).toFixed(6)}`,
            fundedWallets: stats.fundedWallets,
            totalBalance: parseFloat(stats.totalBalance).toFixed(4),
            lastUpdated: stats.lastUpdated,
            totalTransactions: stats.totalTransactions,
            gasLimitExceeded: stats.gasLimitExceeded,
            operationTypes: stats.operationTypes,
            averageGasPerTx: stats.averageGasPerTx,
            totalTokensSwapped: stats.totalTokensSwapped || 0
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error fetching live stats:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch live statistics',
            message: error.message 
        });
    }
});

app.get('/api/stats/daily/:date?', (req, res) => {
    try {
        const date = req.params.date;
        const stats = getDailyStats(date);
        
        const response = {
            date: stats.date,
            successful: stats.successfulTransactions,
            failed: stats.failedTransactions,
            total: stats.totalTransactions,
            successRate: stats.totalTransactions > 0 ? 
                ((stats.successfulTransactions / stats.totalTransactions) * 100).toFixed(2) + '%' : '0%',
            gasUsed: `${parseFloat(stats.totalGasCost).toFixed(6)}`,
            gasLimitExceeded: stats.gasLimitExceeded,
            operationTypes: stats.operationTypes,
            hourlyBreakdown: stats.hourlyBreakdown,
            averageGasPerTx: stats.averageGasPerTx,
            firstTransaction: stats.firstTransaction,
            lastTransaction: stats.lastTransaction
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error fetching daily stats:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch daily statistics',
            message: error.message 
        });
    }
});

app.get('/api/stats/summary', (req, res) => {
    try {
        const summary = getStatsSummary();
        
        const response = {
            cards: {
                successful: {
                    value: summary.live.successfulTransactions,
                    label: "Successful",
                    change: summary.today.successfulTransactions,
                    changeLabel: "today"
                },
                failed: {
                    value: summary.live.failedTransactions,
                    label: "Failed", 
                    change: summary.today.failedTransactions,
                    changeLabel: "today"
                },
                successRate: {
                    value: `${summary.live.successRate}%`,
                    label: "Success Rate",
                    change: summary.today.successfulTransactions > 0 ? 
                        ((summary.today.successfulTransactions / summary.today.totalTransactions) * 100).toFixed(1) + '%' : '0%',
                    changeLabel: "today"
                },
                gasUsed: {
                    value: parseFloat(summary.live.totalGasCost).toFixed(6),
                    label: "Gas Used (ETH)",
                    change: parseFloat(summary.today.totalGasCost).toFixed(6),
                    changeLabel: "today"
                },
                fundedWallets: {
                    value: summary.live.fundedWallets,
                    label: "Funded Wallets",
                    change: 0,
                    changeLabel: "active"
                },
                totalBalance: {
                    value: parseFloat(summary.live.totalBalance).toFixed(4),
                    label: "Total Balance",
                    change: 0,
                    changeLabel: "ETH"
                }
            },
            charts: {
                hourlyActivity: summary.today.hourlyBreakdown,
                operationTypes: summary.today.operationTypes,
                monthlyTrend: summary.thisMonth
            },
            lastUpdated: summary.live.lastUpdated
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error fetching summary stats:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch statistics summary',
            message: error.message 
        });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 TurboBot Web GUI running on http://${hostname}:${PORT}`);
    console.log(`📊 WebSocket server ready for real-time updates`);
    console.log(`📁 Serving files from: ${__dirname}/public`);
    console.log(`⛽ Gas price API available at /api/gas-prices`);
    console.log(`📈 Gas estimation API available at /api/estimate-gas`);
    
    // Initialize gas price cache on startup
    calculateGasPrices().then(() => {
        console.log('✅ Initial gas price data loaded');
    }).catch(error => {
        console.warn('⚠️  Failed to load initial gas price data:', error.message);
    });
});

module.exports = {
    app
}