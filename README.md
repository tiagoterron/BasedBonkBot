# 🚀 BasedBonkBot

An open-source Node.js automation tool for creating multiple wallets, distributing ETH via airdrops, deploying VolumeSwap contracts, and executing automated token swaps on Base network. Now featuring **Uniswap V3 integration**, **advanced gas management**, **configurable timing controls**, and **intelligent transaction optimization** for maximum efficiency and cost control.

> **📢 Open Source Project**: This project is completely open source and free to use. Feel free to fork, modify, and distribute according to your needs!

## ✨ Features

- **📝 Wallet Management**: Create thousands of wallets with automatic JSON storage
- **💰 Smart Airdrops**: Distribute ETH with customizable total amounts and batch sizes
- **🏭 Contract Deployment**: Deploy VolumeSwap contracts for any token automatically
- **📊 Volume Generation**: Infinite volume bot with balance validation and monitoring
- **💸 Fund Withdrawal**: Comprehensive withdrawal system for all deployed contracts
- **🔄 Multi-Protocol Swaps**: Support for Uniswap V2, V3, and multi-token swaps
- **⚡ Batch Processing**: Efficient parallel processing with configurable batch sizes
- **🛡️ Error Handling**: Robust error handling with detailed logging
- **🎯 Target-based Creation**: Smart wallet creation to reach exact counts
- **📊 Real-time Monitoring**: Live progress tracking and transaction monitoring
- **🔄 Continuous Automation**: Create, fund, swap, and recover in automated cycles
- **💸 Automatic ETH Recovery**: Smart ETH recovery system to minimize losses

### 🆕 NEW: Uniswap V3 Integration

- **🎯 V3 Fee Tiers**: Support for 0.05%, 0.3%, and 1% fee tiers
- **🔄 V3 Multicall**: Efficient multi-token V3 swaps with single transaction
- **⚡ V3 Optimization**: Enhanced gas estimation and routing for V3 pools
- **🔄 ETH→WETH Handling**: Automatic ETH to WETH conversion for V3 swaps
- **💎 V3 Analytics**: Fee tier performance tracking and optimization
- **🎛️ V3 Automation**: Full V3 continuous automation support

### 🆕 Advanced Gas Management & Timing Controls

- **⛽ Gas Cost Enforcement**: All functions now respect configurable gas limits
- **🎛️ Timing Controls**: Configurable delays for transactions, batches, and cycles
- **📊 Gas Efficiency Monitoring**: Real-time gas usage and efficiency reporting
- **🚫 Automatic Skipping**: Transactions exceeding gas limits are automatically skipped
- **⚖️ Dynamic Adjustments**: Smart timing adjustments based on success rates
- **💰 Cost Optimization**: Prevent expensive transactions during high gas periods
- **📈 Enhanced Analytics**: Detailed gas cost breakdowns and performance metrics

## 🏗️ Architecture

```
├── install.sh          # Setup and dependency management
├── script.js           # Core automation engine with V3 support
├── package.json        # Node.js dependencies
├── .env                # Configuration file (now with V3 and gas settings)
├── wallets.json        # Generated wallet storage
└── automation.log      # Execution logs
```

## 🚀 Quick Start

### 1. Install on Windows
```bash
curl -o install.bat "https://raw.githubusercontent.com/tiagoterron/BasedBonkBot/refs/heads/master/install.bat" && install.bat setup && cd BasedBonkBot
```

### 2. Install on Linux 
```bash
mkdir BasedBonkBot && cd BasedBonkBot
wget -O install.sh "https://raw.githubusercontent.com/tiagoterron/BasedBonkBot/refs/heads/master/install.sh" && chmod +x install.sh && ./install.sh setup
```

### 3. Install on  MacOS
```bash
mkdir BasedBonkBot && cd BasedBonkBot
curl -o install.sh "https://raw.githubusercontent.com/tiagoterron/BasedBonkBot/refs/heads/master/install.sh" && chmod +x install.sh && ./install.sh setup
```

### 3. Enhanced Configuration
Edit `.env` file with your settings:
```env
# RPC Configuration
RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Funding wallet private key (without 0x prefix)
PK_MAIN=your_private_key_here

PORT=3000

# Batch Configuration (optional)
DEFAULT_WALLET_COUNT=1000
DEFAULT_CHUNK_SIZE=500
DEFAULT_BATCH_SIZE=50

# 🆕 V3 Configuration
DEFAULT_V3_FEE=10000              # V3 fee tier (500, 3000, 10000)

# 🆕 Enhanced Gas Management Settings
GAS_MAX=0.0000008                 # Maximum gas cost per transaction (ETH)
GAS_PRICE_GWEI=1.0               # Force specific gas price (optional)
GAS_LIMIT=300000                 # Force specific gas limit (optional)
```

## 🏭 Enhanced VolumeSwap Contract Features

The bot includes a powerful VolumeSwap contract deployment and management system with V3 support:

### **Contract Capabilities (V2 + V3)**
- **🤖 Automated Trading**: Smart buy/sell logic for both V2 and V3 pools
- **🎯 V3 Integration**: executeV3Swap() function with fee tier optimization
- **🎲 Random Amounts**: Uses randomized percentages for natural trading patterns
- **⚖️ Balance Management**: Automatically switches between buying and selling
- **🔧 Owner Controls**: Configurable buy/sell percentages and maximum buy amounts
- **💸 Fund Recovery**: Complete withdrawal system for ETH and tokens
- **⛽ Gas Optimization**: Enhanced gas cost monitoring for both V2 and V3

### **Enhanced Deployment Process (V2/V3 Compatible)**
1. **Deploy Contract**: `node script.js deploy [token_address]` (works for both V2 and V3 tokens)
2. **Fund Contract**: Send ETH and tokens to the deployed contract address
3. **Generate V2 Volume**: `node script.js volumeV2 [range] [token] [timing]`
4. **Generate V3 Volume**: `node script.js volumeV3 [range] [token] [timing]` (NEW!)
5. **Monitor Progress**: Real-time stats, gas efficiency, V3 fee tier tracking
6. **Withdraw Funds**: `node script.js withdraw-token [token_address]` (V2/V3 compatible)

### **Enhanced Volume Generation Features (V2 + V3)**
- **🔍 Balance Validation**: Checks contract has sufficient ETH/token balance
- **🔄 Infinite Loops**: Continuous operation with cycle tracking
- **📊 Smart Logic**: V2 and V3 compatible buy/sell logic
- **🎯 V3 Fee Optimization**: Automatic fee tier selection and monitoring
- **📈 Statistics**: Real-time success rates and V3 performance metrics
- **🛡️ Error Recovery**: Automatic retry and error handling for both protocols
- **⏸️ Graceful Control**: Easy stop with Ctrl+C
- **⛽ Gas Management**: V3-aware gas cost enforcement and efficiency monitoring
- **🎛️ Timing Control**: V3-optimized delays and dynamic adjustments

## 📊 Enhanced Output Examples

### **Enhanced V3 Contract Deployment**
```
[2025-01-17T10:30:00.000Z] Deploying from main wallet: 0x123...ABC
[2025-01-17T10:30:00.000Z] Token address: 0xf83cde146AC35E99dd61b6448f7aD9a4534133cc
[2025-01-17T10:30:00.000Z] Gas cost: 0.0012 ETH (within limit: 0.002 ETH)
[2025-01-17T10:30:01.000Z] ✅ Deploy SUCCESS: 0xDEF456...
[2025-01-17T10:30:01.000Z] 📄 Deployed contract address: 0x789...GHI
[2025-01-17T10:30:01.000Z] ⛽ Gas used: 2,340,567 (efficiency: 87.3%)
[2025-01-17T10:30:01.000Z] 💰 Actual gas cost: 0.00104 ETH
[2025-01-17T10:30:01.000Z] 🎯 Contract supports both V2 and V3 operations
```

### **Enhanced V3 Volume Generation**
```
[2025-01-17T10:35:00.000Z] 🎯 Starting VolumeV3 for token: 0xf83cde146AC35E99dd61b6448f7aD9a4534133cc
[2025-01-17T10:35:00.000Z] ⏱️  V3 Timing Configuration:
[2025-01-17T10:35:00.000Z]    • Delay between transactions: 150ms
[2025-01-17T10:35:00.000Z]    • Delay between cycles: 3000ms
[2025-01-17T10:35:00.000Z]    • Gas max limit: 0.0000008 ETH
[2025-01-17T10:35:00.000Z]    • V3 Fee tier: 10000 basis points (1%)
[2025-01-17T10:35:01.000Z] ✅ Using existing contract: 0x789...GHI
[2025-01-17T10:35:01.000Z] 🔍 Checking contract balances...
[2025-01-17T10:35:01.000Z] 💰 Contract ETH balance: 2.5 ETH
[2025-01-17T10:35:01.000Z] 🪙 Contract Ebert balance: 50,000.0 EBERT
[2025-01-17T10:35:01.000Z] ✅ Contract has both ETH and token balance - full V3 buy/sell functionality available
[2025-01-17T10:35:02.000Z] 🔄 Starting infinite V3 volume bot loop for wallets 0-100
[2025-01-17T10:35:03.000Z] 📊 Cycle 1 - Wallet 1/100 (Index: 0)
[2025-01-17T10:35:03.000Z] V3 Gas cost: 0.0000007 ETH (within limit: 0.0000008 ETH)
[2025-01-17T10:35:04.000Z] ✅ Wallet 0 V3 successful - Gas efficiency: 82.1%
[2025-01-17T10:35:04.000Z] 💎 V3 Fee tier used: 10000 basis points
[2025-01-17T10:35:04.000Z] ⏱️  Waiting 150ms before next V3 transaction...
[2025-01-17T10:35:05.000Z] 📊 Cycle 1 - Wallet 2/100 (Index: 1)
[2025-01-17T10:35:05.000Z] V3 Gas cost: 0.0000012 ETH (exceeds limit: 0.0000008 ETH)
[2025-01-17T10:35:05.000Z] 💰 Wallet 1 V3 skipped due to high gas costs
...
[2025-01-17T10:37:00.000Z] 🔄 V3 Cycle 1 completed! Starting new cycle...
[2025-01-17T10:37:00.000Z] 📈 V3 Cumulative Stats:
[2025-01-17T10:37:00.000Z]    • Total Processed: 100
[2025-01-17T10:37:00.000Z]    • Successful: 73
[2025-01-17T10:37:00.000Z]    • Failed: 18
[2025-01-17T10:37:00.000Z]    • Gas limit exceeded: 9
[2025-01-17T10:37:00.000Z]    • Success Rate: 73.00%
[2025-01-17T10:37:00.000Z]    • Average V3 gas efficiency: 81.7%
[2025-01-17T10:37:00.000Z]    • V3 Fee tier performance: Excellent
[2025-01-17T10:37:00.000Z] 🔄 Looping back to wallet 0
[2025-01-17T10:37:00.000Z] ⏱️  Waiting 3000ms before next V3 cycle...
```

### **Enhanced V3 Multi-Swap Processing**
```
[2025-01-17T10:40:00.000Z] 🔄 Processing V3 multi-swap for wallets 0-99
[2025-01-17T10:40:00.000Z] 🎯 V3 Tokens: 0xf83cde146AC35E99dd61b6448f7aD9a4534133cc, 0x2Dc1C8BE620b95cBA25D78774F716F05B159C8B9
[2025-01-17T10:40:00.000Z] 💎 V3 Fee tier: 10000 basis points (1%)
[2025-01-17T10:40:01.000Z] ✅ Wallet 0: V3 Success - 2 tokens swapped via multicall
[2025-01-17T10:40:01.000Z]    TX: 0xabc123... (Gas efficiency: 84.2%)
[2025-01-17T10:40:01.000Z]    V3 multicall vs individual: 35% gas savings
[2025-01-17T10:40:02.000Z] 💰 Wallet 3: V3 Skipped - Gas cost 0.000001 ETH exceeds limit
[2025-01-17T10:40:03.000Z] ✅ Wallet 5: V3 Success - 2 tokens swapped (Gas efficiency: 86.1%)
[2025-01-17T10:40:04.000Z] 📈 V3 Batch completed:
[2025-01-17T10:40:04.000Z]    • V3 Successful: 18/25 (72.0%)
[2025-01-17T10:40:04.000Z]    • V3 Failed: 4
[2025-01-17T10:40:04.000Z]    • V3 Gas exceeded: 3
[2025-01-17T10:40:04.000Z]    • Average V3 gas efficiency: 83.7%
[2025-01-17T10:40:04.000Z]    • V3 Multicall efficiency: 87.2%
```

### **Enhanced Fund Withdrawal (V2/V3 Compatible)**
```
[2025-01-17T10:45:00.000Z] 🏦 Withdrawing from contract: 0x789...GHI
[2025-01-17T10:45:00.000Z] Gas cost check: 0.0000004 ETH (within limit: 0.0000008 ETH)
[2025-01-17T10:45:01.000Z] 🔍 Checking contract balances before withdrawal...
[2025-01-17T10:45:01.000Z] 💰 Contract ETH balance: 1.8 ETH
[2025-01-17T10:45:01.000Z] 🪙 Contract EBERT balance: 25,000.0 EBERT
[2025-01-17T10:45:01.000Z] 📊 Contract used for: V2 and V3 operations
[2025-01-17T10:45:02.000Z] ✅ Withdrawal SUCCESS: 0xABC123...
[2025-01-17T10:45:02.000Z] ⛽ Gas used: 145,678 (efficiency: 89.1%)
[2025-01-17T10:45:02.000Z] 💰 Actual gas cost: 0.00000035 ETH
[2025-01-17T10:45:02.000Z] 📈 ETH withdrawn: 1.8 ETH
[2025-01-17T10:45:02.000Z] 📈 EBERT withdrawn: 25,000.0 EBERT
[2025-01-17T10:45:02.000Z] 📊 Net ETH gain: 1.79999965 ETH
```

## 🔧 Enhanced Troubleshooting

### **V3-Specific Issues**

**❌ "V3 pool has insufficient liquidity"**
- Check if the V3 pool exists for your token pair
- Try different fee tiers (500, 3000, 10000)
- Verify token is available on Uniswap V3
- Monitor pool liquidity before large operations

**❌ "V3 gas cost higher than V2"**
- This is normal - V3 operations require more gas
- Adjust `GAS_MAX` for V3 operations: `GAS_MAX=0.000001`
- Use V3 multicall for better efficiency
- Consider V3 timing adjustments

**📊 V3 Low efficiency (<60%)**
- V3 pools may have complex routing
- Use larger delays: `delay_tx=200` for V3
- Check fee tier selection for your token pair
- Monitor V3 pool activity and adjust timing

### **Gas-Related Issues (V2 + V3)**

**❌ "Gas cost exceeds maximum limit"**
- This is normal behavior during high gas periods
- V3 operations typically need 20-40% more gas than V2
- Transactions are automatically skipped to save money
- Adjust `GAS_MAX` separately for V2 and V3 operations

**❌ "All V3 transactions being skipped"**
- V3 gas prices are higher than your current `GAS_MAX`
- Increase V3 gas limit: `GAS_MAX=0.000001`
- Use V3 multicall for better gas efficiency
- Consider running V3 operations during off-peak hours


## 🆕 New V3 Features Summary

### **🔥 V3 Integration System**
- ✅ Complete Uniswap V3 protocol support
- ✅ V3 fee tier selection and optimization (500, 3000, 10000)
- ✅ V3 multicall contract for efficient multi-token swaps
- ✅ Automatic ETH→WETH conversion for V3 operations
- ✅ V3-specific gas estimation and optimization

### **⚡ V3 Advanced Controls**
- ✅ V3-optimized timing controls and delays
- ✅ V3 vs V2 performance comparison and analytics
- ✅ V3 pool liquidity validation before operations
- ✅ V3 fee tier performance tracking and recommendations
- ✅ V3 multicall efficiency monitoring

### **📊 V3 Enhanced Monitoring**
- ✅ Real-time V3 gas cost calculations and V2 comparisons
- ✅ V3 success rate tracking with protocol-specific breakdowns
- ✅ V3 fee tier efficiency percentages and optimization
- ✅ V3 multicall vs individual swap performance analysis
- ✅ V3 pool activity and liquidity monitoring

### **🛡️ V3 Improved Reliability**
- ✅ V3-specific error handling and categorization
- ✅ V3 pool routing optimization and fallback mechanisms
- ✅ V3 liquidity validation and pool health checks
- ✅ V3 multicall transaction batching and optimization
- ✅ V3 fee tier auto-adjustment based on performance

## 🔧 Installation & Maintenance (V3 Enhanced)

### **Automated Setup with V3 Support**
```bash
# Complete setup with V3 support
./install.sh setup

# Update to latest version with V3 features
./install.sh update

# Validate script integrity including V3 components
./install.sh validate

# Check Node.js and V3 dependencies
./install.sh check-node
```

## ⚠️ Important Notes

- **🔐 Security**: Store private keys securely, never commit `.env` to version control
- **⛽ V3 Gas Management**: V3 operations typically use 20-40% more gas than V2
- **🎯 V3 Fee Tiers**: Choose appropriate fee tiers for your token pairs
- **📊 V3 Performance**: Monitor V3 vs V2 efficiency for optimization
- **🎛️ V3 Timing Control**: V3 operations may need slightly longer delays
- **⏰ Rate Limits**: Built-in intelligent delays prevent RPC rate limiting
- **💾 Backup**: Keep backups of `wallets.json` - contains all your generated wallets
- **🧪 V3 Testing**: Test V3 operations with small amounts first
- **🔄 V3 Automation**: V3 continuous automation commands run indefinitely
- **💸 V3 Recovery**: Enhanced ETH recovery includes V3-aware gas validation
- **🏭 V3 Contract Funding**: VolumeSwap contracts work with both V2 and V3 tokens
- **📊 V3 Volume Generation**: Monitor V3 pool liquidity and fee tier performance
- **🔄 V3 Infinite Loops**: V3 volume bots run continuously with enhanced monitoring
- **💰 V3 Cost Control**: V3 gas management prevents unexpected high costs
- **🎯 V3 Optimization**: Use V3 multicall for better gas efficiency
- **📈 V3 Scaling**: Start with conservative V3 settings and scale based on performance

## 🚀 Getting Started with V3 Features

1. **Install and Setup**: Use the automated installer with V3 support
2. **Configure V3 Settings**: Set appropriate `DEFAULT_V3_FEE` and `GAS_MAX` in `.env`
3. **Test V3 Operations**: Try V3 swaps with small amounts first
4. **Monitor V3 Performance**: Watch V3 gas efficiency and fee tier performance
5. **Optimize V3 Timing**: Adjust delays based on V3 network conditions
6. **Scale V3 Gradually**: Increase V3 batch sizes and instance counts as needed
7. **Compare V2 vs V3**: Use analytics to choose optimal protocol for your needs

The enhanced BasedBonkBot now provides complete Uniswap V3 integration alongside V2 support, with intelligent cost control and performance optimization for both protocols. Perfect for maximizing opportunities across all Uniswap liquidity pools!

## 🔮 V3 Roadmap & Future Features

### **Planned V3 Features**
- **🤖 V3 AI-Powered Trading**: Machine learning for optimal fee tier selection
- **📊 V3 Advanced Analytics**: Detailed V3 vs V2 performance comparison dashboard
- **🔄 V3 Multi-Chain Support**: V3 operations across multiple EVM chains
- **🎯 V3 Concentrated Liquidity**: Integration with V3 liquidity provision
- **📱 V3 Web Dashboard**: Real-time V3 pool monitoring and control
- **🔔 V3 Notifications**: V3-specific alerts and performance notifications
- **⛽ V3 Dynamic Gas Pricing**: AI-powered V3 gas optimization strategies

### **V3 Smart Contract Enhancements**
- **🎯 V3 Fee Tier Auto-Selection**: Dynamic fee tier optimization based on volatility
- **⏰ V3 Time-Based Logic**: V3 pool activity-based trading schedules
- **📈 V3 Volume Targets**: V3-specific volume milestones and tracking
- **🔄 V3 Multi-Pool Support**: Single contract handling multiple V3 pools
- **💰 V3 Profit Tracking**: V3-specific P&L tracking with fee tier analysis
- **⛽ V3 Gas-Aware Trading**: V3 smart contract gas optimization features

### **V3 Infrastructure Improvements**
- **☁️ V3 Cloud Deployment**: V3-optimized cloud instance deployment
- **🔄 V3 Auto-Scaling**: Dynamic V3 instance scaling based on pool activity
- **🛡️ V3 Enhanced Security**: V3-specific security features and validations
- **📊 V3 Database Integration**: V3 pool data and analytics storage
- **🌐 V3 API Interface**: RESTful API for V3 operations and monitoring
- **⛽ V3 Gas Oracle Integration**: V3-specific gas price optimization

## 🤝 Contributing & Support (V3 Enhanced)

This is an **open source project** with complete V3 support - we welcome contributions! 



### **Support the V3 Project**
If you find this project useful, consider supporting development:

**Donation Address**: `0xEd1fed9A43B434a053159732b606bbbc7FE9498e`

Your donations help maintain and improve features for the community!

## 📄 License

**MIT License** - This project is completely open source and free to use, modify, and distribute.

## 🔗 Links

- **GitHub Repository**: [BasedBonkBot](https://github.com/tiagoterron/BasedBonkBot)
- **Base Network**: [Base Chain](https://base.org/)
- **Uniswap V2**: [Uniswap V2 Protocol](https://uniswap.org/blog/uniswap-v2)
- **Uniswap V3**: [Uniswap V3 Protocol](https://uniswap.org/blog/uniswap-v3)
- **Base Gas Tracker**: [Base Gas Tracker](https://basescan.org/gastracker)
- **V3 Pool Explorer**: [Uniswap V3 Analytics](https://info.uniswap.org/)

---

**⚡ Ready to generate volume with V3 support and intelligent gas management? Start with `./install.sh setup` and experience the enhanced V2 + V3 automation features!**

*The new V3 integration alongside existing V2 support provides complete Uniswap protocol coverage with professional-grade automation and intelligent cost optimization. Monitor your V2 vs V3 performance, optimize your fee tiers, and maximize your results across all liquidity pools while minimizing costs!*