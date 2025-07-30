//V 1.0.8
const { ethers, utils } = require('ethers');
const fs = require('fs');
const path = require('path');
const { start } = require('repl');
require('dotenv').config();

// const { trackTransaction, updateWalletStats, getLiveStats } = require('./source/stats-tracker');
// const { 
//     executeSwapWithStats, 
//     trackBatchOperation, 
//     executeBatchWithStats,
//     createStatsWrapper 
// } = require('./source/stats-integration');

const { 
    config,
    provider,
    addTokens,
    addSingleToken,
    loadTokens,
    getWalletBalances,
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
    loadWalletsBalanceSortedArray
} = require("./helper")

async function trackBatchOperation(){}
async function trackTransaction(){}


async function deployContract(tokenAddress) {
    try {
        if (!config.fundingPrivateKey) {
            throw new Error('PK_MAIN not configured in .env file');
        }

        // Use main wallet (PK_MAIN) for deployment
        const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        
        console.log(`Deploying from main wallet: ${mainSigner.address}`);
        console.log(`Token address: ${tokenAddress}`);
        console.log(`Deployer contract: ${contracts.deployerContract}`);
        
        // Check wallet balance first
        const balance = await provider.getBalance(mainSigner.address);
        const minBalance = ethers.utils.parseUnits("0.0001", 18); // 0.001 ETH minimum
        
        if (balance.lt(minBalance)) {
            throw new Error(`Insufficient balance for ${mainSigner.address}: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        }
        
        console.log(`Main wallet balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        
        // Create contract instance
        const deployerContract = new ethers.Contract(contracts.deployerContract, turboDeployerAbi, mainSigner);
      
        // Check if already deployed by this owner for this token
        try {
            const alreadyDeployed = await deployerContract.hasDeployed(mainSigner.address, tokenAddress);
            if (alreadyDeployed) {
                const existingContract = await deployerContract.getContractByOwnerAndToken(mainSigner.address, tokenAddress);
                console.log(`⚠️  Contract already deployed for this token: ${existingContract}`);
                return { 
                    success: false, 
                    reason: 'already_deployed',
                    existingContract: existingContract
                };
            }
        } catch (checkError) {
            console.log(`Could not check existing deployment: ${checkError.message}`);
        }
        
        // Build raw transaction data
        const tx = {
            to: deployerContract.address,
            data: deployerContract.interface.encodeFunctionData("deploy", [tokenAddress, mainSigner.address]),
            value: 0 // No ETH value needed for deployment
        };
        
        // Get nonce using "latest" instead of "pending"
        const nonce = await mainSigner.getTransactionCount("latest");
        
        // Get base gas price and apply multiplier
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Force minimum gas price for Base network
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
         
        // Estimate gas limit
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                ...tx,
                from: mainSigner.address
            });
            
            // Add 50% buffer to gas limit
            gasLimit = gasLimit.mul(150).div(100);
        } catch (gasError) {
            console.error(`Gas estimation failed:`, gasError.message);
            // Use fallback gas limit for contract deployment
            gasLimit = ethers.BigNumber.from("500000");
        }
        
        // Check if we have enough balance for gas
        const totalGasCost = gasPrice.mul(gasLimit);
        if (balance.lt(totalGasCost)) {
            throw new Error(`Insufficient balance for gas. Need ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
        }
        
        console.log(`Gas limit: ${gasLimit.toString()}, Total gas cost: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
       
        // Send transaction with raw transaction method
        const transaction = await mainSigner.sendTransaction({
            ...tx,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        });
        
        console.log(`Deploy transaction sent: ${transaction.hash}`);
        console.log(`⏳ Waiting for confirmation...`);
        
        // Wait for confirmation with timeout
        let receipt;
        try {
            // Wait up to 2 minutes for confirmation
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            // Try to get receipt manually after waiting
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                throw new Error(`Receipt error: ${receiptError.message}`);
            }
        }
        
        if (receipt && receipt.status === 1) {
            console.log(`✅ Deploy SUCCESS: ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            
            // Parse the deployment event to get the deployed contract address
            let deployedContractAddress = null;
            try {
                const deployedEvent = receipt.logs.find(log => {
                    try {
                        const parsed = deployerContract.interface.parseLog(log);
                        return parsed.name === 'Deployed';
                    } catch (e) {
                        return false;
                    }
                });
                
                if (deployedEvent) {
                    const parsed = deployerContract.interface.parseLog(deployedEvent);
                    deployedContractAddress = parsed.args.deployedContract;
                    console.log(`📄 Deployed contract address: ${deployedContractAddress}`);
                    console.log(`🎯 Token: ${parsed.args.token}`);
                    console.log(`👤 Owner: ${parsed.args.owner}`);

                    console.log(`\n🚨 IMPORTANT NEXT STEPS:`);
                    console.log(`📤 You must now send funds (ETH/funds) to the contract address:`);
                    console.log(`   Contract Address: ${deployedContractAddress}`);
                    console.log(`   Token Address: ${tokenAddress}`);
                    console.log(`\n💡 Instructions:`);
                    console.log(`   1. Transfer your ${tokenAddress} tokens to ${deployedContractAddress}`);
                    console.log(`   2. The contract needs token balance to execute swaps properly and generate volume`);
                    console.log(`   3. Without tokens in the contract, swap functions will fail`);
                    console.log(`\n⚠️  Make sure to transfer tokens before running swap operations!`);
                    console.log(`────────────────────────────────────────────────────────────────\n`);
                }
            } catch (eventError) {
                console.log(`Could not parse deployment event: ${eventError.message}`);
            }
            
            return { 
                success: true, 
                txHash: receipt.transactionHash,
                deployedContract: deployedContractAddress,
                tokenAddress: tokenAddress,
                owner: mainSigner.address,
                gasUsed: receipt.gasUsed.toString(),
                gasCost: ethers.utils.formatUnits(receipt.gasUsed.mul(gasPrice), 18)
            };
        } else {
            throw new Error(`Transaction failed: ${receipt?.transactionHash || transaction.hash}`);
        }
        
    } catch (err) {
        console.error(`Error deploying contract:`, err.message);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            throw new Error(`Insufficient funds in main wallet`);
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW') {
            throw new Error(`Nonce issue with main wallet`);
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            throw new Error(`Gas price too low`);
        } else if (err.message.includes('gas')) {
            throw new Error(`Gas related error: ${err.message}`);
        } else if (err.message.includes('already deployed')) {
            throw new Error(`Contract already deployed for this token`);
        }
        
        throw err;
    }
}

// Individual operation functions
async function sendAirdropWallets(start, end, wallets, totalEthAmount = null) {
    const startTime = Date.now();
    try {
        if (!config.fundingPrivateKey) {
            throw new Error('PK_MAIN not configured in .env file');
        }
        
        const signer = new ethers.Wallet(config.fundingPrivateKey, provider);
        const recipients = wallets.slice(start, end).map(wallet => wallet[0]);
        
        let amountPerWallet;
        let totalValue;
        
        if (totalEthAmount) {
            // Distribute the total amount among all recipients in this batch
            totalValue = ethers.utils.parseUnits(totalEthAmount.toString(), 18);
            amountPerWallet = totalValue.div(recipients.length);
            log(`Distributing ${totalEthAmount} ETH among ${recipients.length} wallets (${ethers.utils.formatEther(amountPerWallet)} ETH each)`);
        } else {
            // Use default amount per wallet
            const defaultAmount = "0.0015";
            amountPerWallet = ethers.utils.parseUnits(defaultAmount, 18);
            totalValue = amountPerWallet.mul(recipients.length);
            log(`Sending default ${defaultAmount} ETH to each of ${recipients.length} wallets`);
        }
        
        log(`Sending airdrop to wallets ${start} - ${end}`);
        log(`Total amount: ${ethers.utils.formatEther(totalValue)} ETH`);
        log(`Amount per wallet: ${ethers.utils.formatEther(amountPerWallet)} ETH`);
        
        const balance = await provider.getBalance(signer.address);
        log(`Funding Wallet address: ${signer.address}`);
        log(`Funding wallet balance: ${ethers.utils.formatEther(balance)} ETH`);
        
        // Check if we have enough balance
        if (balance.lt(totalValue)) {
            throw new Error(`Insufficient balance. Need ${ethers.utils.formatEther(totalValue)} ETH but have ${ethers.utils.formatEther(balance)} ETH`);
        }
        
        // Setup airdrop contract
        const airdrop = new ethers.Contract("0x4F50E08aa6059aC120AD7Bb82c097Fd89f517Da3", airdropAbi, signer);
        
        // Prepare transaction data
        const tx = {
            to: airdrop.address,
            data: airdrop.interface.encodeFunctionData("sendAirdropETH", [recipients]),
            value: totalValue
        };
        
        // Get transaction parameters
        const nonce = await signer.getTransactionCount("pending");
        const gasPrice = await provider.getGasPrice();
        const gasLimit = await provider.estimateGas({
            ...tx,
            from: signer.address
        });
        
        log(`Transaction nonce: ${nonce}`);
        log(`Gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        log(`Estimated gas limit: ${gasLimit.toString()}`);
        log(`Gas cost: ${ethers.utils.formatEther(gasPrice.mul(gasLimit))} ETH`);
        
        // Send transaction
        const transaction = await signer.sendTransaction({
            ...tx,
            gasLimit: gasLimit.mul(100).div(100), // 200% of estimated gas
            gasPrice: gasPrice.mul(100).div(100), // 200% of current gas price
            nonce,
        });
        
        log(`📤 Transaction sent: ${transaction.hash}`);
        log(`⏳ Waiting for confirmation...`);
        
        // Wait for transaction confirmation
        const receipt = await transaction.wait();
        
        if (receipt.status === 1) {
            log(`✅ Airdrop completed: ${receipt.transactionHash}`);
            log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            log(`💰 Total ETH distributed: ${ethers.utils.formatEther(totalValue)} ETH`);
        } else {
            throw new Error(`Transaction failed: ${receipt.transactionHash}`);
        }
        
        // Wait 2 seconds before returning (as in your example)
        await sleep(2000);
        
        const result =  {
            success: true,
            transactionHash: receipt.transactionHash,
            gasUsed: receipt.gasUsed.toString(),
            totalAmount: ethers.utils.formatEther(totalValue),
            amountPerWallet: ethers.utils.formatEther(amountPerWallet),
            recipients: recipients.length
        };
        
        trackTransaction({
            success: result.success,
            gasUsed: result.gasUsed,
            gasCost: ethers.utils.formatEther(gasPrice.mul(receipt.gasUsed)),
            operationType: "airdrops",
            transactionHash: result.transactionHash,
            additionalData: {
                executionTime: Date.now() - startTime,
                recipients: result.recipients,
                totalAmount: result.totalAmount,
                amountPerWallet: result.amountPerWallet
            }
        });

        return result

    } catch (err) {

         trackTransaction({
            success: false,
            gasUsed: "0",
            gasCost: "0",
            operationType: "airdrops",
            additionalData: {
                error: err.message,
                executionTime: Date.now() - startTime,
                targetRecipients: end - start
            }
        });

        errorLog(`Airdrop failed for range ${start}-${end}: ${err.message}`);
        throw err;
    }
}

async function executeSwap(index, wallets, tokenAddress) {
    const startTime = Date.now();
    try {
        if (index >= wallets.length) {
            console.log(`Index ${index} exceeds wallet array length`);
            return { success: false, reason: 'index_out_of_bounds' };
        }

        const signer = new ethers.Wallet(wallets[index][1], provider);
        console.log(`Sending microtx: ${signer.address}`);

        // Check wallet balance first
        const balance = await provider.getBalance(signer.address);
        const minBalance = ethers.utils.parseUnits("0.000001", 18); // 0.000001 ETH minimum
        
        if (balance.lt(minBalance)) {
            console.log(`Insufficient balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_funds' };
        }
        
        console.log(`Wallet balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        
        // Get gas max limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        const routerContract = new ethers.Contract(contracts.uniswapRouter, routerAbi, signer);
        
        const amount = ethers.utils.parseUnits("10", "wei");
        const path = [
            "0x4200000000000000000000000000000000000006", // WETH
            tokenAddress
        ];
        const to = signer.address; // Send tokens to the wallet itself
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
        
        const tx = {
            to: routerContract.address,
            data: routerContract.interface.encodeFunctionData("swapExactETHForTokens", [
                0, // amountOutMin (accept any amount)
                path,
                to,
                deadline
            ]),
            value: amount
        };
        
        // Enhanced gas price calculation
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Force minimum gas price for Base network
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas limit with fallback
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                ...tx,
                from: signer.address,
            });
            
            // Add 20% buffer to gas limit
            gasLimit = gasLimit.mul(120).div(100);
            console.log(`Estimated gas limit: ${gasLimit.toString()}`);
        } catch (gasError) {
            console.log(`Gas estimation failed, using fallback: ${gasError.message}`);
            gasLimit = ethers.BigNumber.from("200000"); // fallback for simple swaps
        }
        
        // Calculate total gas cost
        const totalGasCost = gasPrice.mul(gasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        const totalTxCost = totalGasCost.add(amount);
        
        console.log(`Total gas cost: ${totalGasCostETH} ETH`);
        console.log(`Gas max limit: ${gasMaxETH} ETH`);
        console.log(`Total tx cost: ${ethers.utils.formatUnits(totalTxCost, 18)} ETH`);
        
        // Check gas cost against gasMax
        if (totalGasCost.gt(gasMaxWei)) {
            console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Swap cancelled to stay within gas limits`);
            return { 
                success: false, 
                reason: 'gas_cost_exceeds_max',
                gasRequested: totalGasCostETH,
                gasMaxAllowed: gasMaxETH
            };
        }
        
        // Check if wallet has enough balance for gas + swap amount
        if (balance.lt(totalTxCost)) {
            console.log(`Insufficient balance for gas + swap. Need ${ethers.utils.formatUnits(totalTxCost, 18)} ETH, have ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_gas' };
        }
        
        console.log(`✅ Gas cost within limits, proceeding with swap...`);
        console.log(`Router: ${routerContract.address}`);
        console.log(`Token: ${tokenAddress}`);
        console.log(`Amount: ${amount.toString()} wei`);
        console.log(`Path: WETH -> ${tokenAddress}`);
        
        // Get nonce
        const nonce = await signer.getTransactionCount("latest");
        
        // Send transaction
        const transaction = await signer.sendTransaction({
            ...tx,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        });

        console.log(`Swap transaction sent: ${transaction.hash}`);
        
        // Wait for confirmation with timeout
        let receipt;
        try {
            // Wait up to 2 minutes for confirmation
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            // Try to get receipt manually after waiting
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                return { success: false, reason: 'receipt_error', txHash: transaction.hash };
            }
        }
        
        if (receipt && receipt.status === 1) {
            const actualGasCost = gasPrice.mul(receipt.gasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            const gasEfficiency = ((receipt.gasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ Swap ${index} successful: ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()} (estimated: ${gasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${gasEfficiency}%`);
            
            const result =  { 
                success: true, 
                txHash: receipt.transactionHash,
                gasUsed: receipt.gasUsed.toString(),
                gasEstimated: gasLimit.toString(),
                actualGasCost: actualGasCostETH,
                estimatedGasCost: totalGasCostETH,
                gasEfficiency,
                walletIndex: index,
                walletAddress: signer.address,
                tokenAddress,
                hash: receipt.transactionHash // Legacy compatibility
            };

            
            trackTransaction({
            success: result.success,
            gasUsed: result.gasUsed,
            gasCost: result.actualGasCost,
            operationType: "V2_swaps",
            tokensSwapped: 1,
            walletAddress: result.walletAddress,
            tokenAddress: result.tokenAddress,
            transactionHash: result.txHash,
            additionalData: {
                walletIndex: index,
                executionTime: Date.now() - startTime,
                gasEfficiency: result.gasEfficiency
            }});

            return result;
        } else {
            console.log(`❌ Swap ${index} failed: ${receipt?.transactionHash || transaction.hash}`);

            trackTransaction({
            success: false,
            gasUsed: "0",
            gasCost: "0",
            operationType: "V2_swaps",
            additionalData: {
                error: err.message,
                walletIndex: index,
                executionTime: Date.now() - startTime
            }
        });
            return { 
                success: false, 
                reason: 'transaction_failed', 
                txHash: receipt?.transactionHash || transaction.hash 
            };
        }
        
    } catch (err) {
        console.error(`Error for wallet ${index}:`, err.message);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            console.log(`No funds in wallet ${index}`);
            return { success: false, reason: 'insufficient_funds' };
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW' || err.message.includes('nonce too low')) {
            console.log(`Nonce issue in wallet ${index}`);
            return { success: false, reason: 'nonce_error' };
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            console.log(`Gas price too low for wallet ${index}`);
            return { success: false, reason: 'gas_price_low' };
        } else if (err.message.includes('gas')) {
            console.log(`Gas related error for wallet ${index}:`, err.message);
            return { success: false, reason: 'gas_error' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            console.log(`ABI parsing error for wallet ${index}:`, err.message);
            return { success: false, reason: 'abi_error' };
        } else if (err.message.includes('insufficient liquidity') || err.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
            console.log(`Insufficient liquidity for wallet ${index}`);
            return { success: false, reason: 'insufficient_liquidity' };
        } else if (err.message.includes('execution reverted')) {
            console.log(`Contract execution reverted for wallet ${index}:`, err.message);
            return { success: false, reason: 'execution_reverted' };
        }
        
        // Return error instead of throwing
        console.error(`Unexpected error in wallet ${index}:`, err.message);
        return { success: false, reason: 'unknown_error', error: err.message };
    }
}

// async function executeMultiSwap(index, wallets, tokens = null, version = "V3") {
//     try {
//         if (index >= wallets.length) {
//             console.log(`Index ${index} exceeds wallet array length`);
//             return { success: false, reason: 'index_out_of_bounds' };
//         }

//         const signer = new ethers.Wallet(wallets[index][1], provider);
//         console.log(`Wallet ${index}: ${signer.address}`);

//         // Check wallet balance first
//         const currentBalance = await provider.getBalance(signer.address);
//         const minBalance = ethers.utils.parseUnits("0.000001", 18); // 0.000001 ETH minimum
        
//         if (currentBalance.lt(minBalance)) {
//             console.log(`Insufficient balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
//             return { success: false, reason: 'insufficient_funds' };
//         }
        
//         console.log(`Wallet balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
        
//         // Get gas max limit from config
//         const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
//             config.gasSettings.gasMax : 
//             config.gasSettings.gasMax.toString();
//         const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
//         // Your BasedBonkSwaps contract
//         const contractAddress = contracts.basedBonkSwapsContract || "0xe86e08B971f4977DA8f0b6d579687F14Ee08437a";
        
//         // Router address - Base network router
//         const routerAddress = contracts.uniswapRouter || "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
//         const routerV3Address = contracts.uniswapRouterV3 || "0x2626664c2603336E57B271c5C0b26F421741e481";
        
//         // Define the token addresses you want to swap
//         const tokensToSwap = tokens || defaultTokens[version]

//         const numberOfTokens = tokensToSwap.length;
//         console.log(`Number of tokens to swap: ${numberOfTokens} (${version})`);
//         console.log(`Tokens: ${tokensToSwap.slice(0, 3).join(', ')}${tokensToSwap.length > 3 ? '...' : ''}`);
        
//         // Create contract interface
//         const contractInterface = new ethers.utils.Interface([
//             version === "V2" ? 
//             "function executeMultiSwapV2((address,address,address)[] swapDetailsV2, address tokenOwner) external payable" :
//             "function executeMultiSwapV3((address,address,address,uint24)[] swapDetailsV3, address tokenOwner) external payable"
//         ]);
        
//         // Create swap details based on version
//         let swapDetails;
//         let functionName;
        
//         if (version === "V2") {
//             swapDetails = tokensToSwap.map(tokenAddress => [
//                 tokenAddress,      // tokenAddress
//                 routerAddress,     // router
//                 signer.address     // recipient
//             ]);
//             functionName = "executeMultiSwapV2";
//         } else {
//             const v3Fee = 3000; // 0.3% fee tier
//             swapDetails = tokensToSwap.map(tokenAddress => [
//                 tokenAddress,      // tokenAddress
//                 routerV3Address,   // router
//                 signer.address,    // recipient
//                 v3Fee             // feeV3
//             ]);
//             functionName = "executeMultiSwapV3";
//         }

//         console.log(`Creating ${version} swap details for ${numberOfTokens} tokens...`);
        
//         // Get the main signer address (tokenOwner)
//         const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
//         const tokenOwner = mainSigner.address;
        
//         // Enhanced gas price calculation
//         const baseGasPrice = await provider.getGasPrice();
//         console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
//         // Force minimum gas price for Base network
//         const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
//         let gasPrice = baseGasPrice.lt(minGasPrice) ? 
//             minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
//         console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
//         // Estimate gas limit with fallback
//         let gasLimit;
//         try {
//             gasLimit = await provider.estimateGas({
//                 to: contractAddress,
//                 data: contractInterface.encodeFunctionData(functionName, [swapDetails, tokenOwner]),
//                 value: currentBalance.sub(ethers.utils.parseUnits("0.000005", 18)), // Reserve for gas
//                 from: signer.address
//             });
//             console.log(`Estimated gas limit: ${gasLimit.toString()}`);
            
//             // Add 30% buffer to gas limit
//             gasLimit = gasLimit.mul(130).div(100);
//         } catch (gasError) {
//             console.log(`Gas estimation failed, using fallback: ${gasError.message}`);
//             // Fallback: 200k base + 30k per additional token
//             gasLimit = ethers.BigNumber.from("200000").add(
//                 ethers.BigNumber.from("30000").mul(Math.max(0, numberOfTokens - 1))
//             );
//         }
        
//         // Calculate total gas cost
//         const totalGasCost = gasPrice.mul(gasLimit);
//         const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
//         // Calculate available ETH for swap (total balance - gas cost)
//         const availableForSwap = currentBalance.sub(totalGasCost);
        
//         console.log(`Gas limit with buffer: ${gasLimit.toString()}`);
//         console.log(`Total gas cost: ${totalGasCostETH} ETH`);
//         console.log(`Gas max limit: ${gasMaxETH} ETH`);
//         console.log(`Available for swap: ${ethers.utils.formatUnits(availableForSwap, 18)} ETH`);
        
//         // Check gas cost against gasMax
//         if (totalGasCost.gt(gasMaxWei)) {
//             console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
//             console.log(`⚠️  Multi-swap cancelled to stay within gas limits`);
//             return { 
//                 success: false, 
//                 reason: 'gas_cost_exceeds_max',
//                 gasRequested: totalGasCostETH,
//                 gasMaxAllowed: gasMaxETH,
//                 tokensCount: numberOfTokens
//             };
//         }
        
//         // Check if we have enough for minimal swap
//         const minSwapAmount = ethers.utils.parseUnits("0.0001", 18); // 0.0001 ETH minimum
//         if (availableForSwap.lt(minSwapAmount)) {
//             console.log(`Insufficient funds for swap. Available: ${ethers.utils.formatUnits(availableForSwap, 18)} ETH`);
//             return { success: false, reason: 'insufficient_funds_for_swap' };
//         }
        
//         console.log(`✅ Gas cost within limits, proceeding with ${version} multi-swap...`);
//         console.log(`Contract: ${contractAddress}`);
//         console.log(`Router: ${version === "V2" ? routerAddress : routerV3Address}`);
//         console.log(`Token Owner (return address): ${tokenOwner}`);
        
//         // Get nonce for swap transaction
//         const swapNonce = await signer.getTransactionCount("latest");
        
//         // Create transaction data
//         const txData = contractInterface.encodeFunctionData(functionName, [swapDetails, tokenOwner]);
        
//         // Execute the multi-swap transaction
//         const swapTransaction = await signer.sendTransaction({
//             to: contractAddress,
//             data: txData,
//             value: availableForSwap, // Send all available ETH (contract will handle 10 wei per token + fees)
//             gasLimit,
//             gasPrice,
//             nonce: swapNonce,
//             type: 0 // Force legacy transaction type
//         });
        
//         console.log(`${version} multi-swap transaction sent: ${swapTransaction.hash}`);
//         console.log(`Value sent: ${ethers.utils.formatUnits(availableForSwap, 18)} ETH`);
        
//         // Wait for confirmation with timeout
//         let receipt;
//         try {
//             // Wait up to 2 minutes for confirmation
//             receipt = await Promise.race([
//                 swapTransaction.wait(),
//                 new Promise((_, reject) => 
//                     setTimeout(() => reject(new Error("Transaction timeout")), 120000)
//                 )
//             ]);
//         } catch (waitError) {
//             console.error(`Transaction wait failed: ${waitError.message}`);
            
//             // Try to get receipt manually after waiting
//             await sleep(3000);
//             try {
//                 receipt = await provider.getTransactionReceipt(swapTransaction.hash);
//                 if (!receipt) {
//                     throw new Error("Transaction not found");
//                 }
//             } catch (receiptError) {
//                 console.error(`Failed to get receipt: ${receiptError.message}`);
//                 return { success: false, reason: 'receipt_error', txHash: swapTransaction.hash };
//             }
//         }
        
//         if (receipt && receipt.status === 1) {
//             const actualGasCost = gasPrice.mul(receipt.gasUsed);
//             const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
//             const gasEfficiency = ((receipt.gasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1);
            
//             // Calculate swap cost (10 wei per token + fees)
//             const swapCostWei = ethers.BigNumber.from("10").mul(numberOfTokens);
//             const swapCostETH = ethers.utils.formatUnits(swapCostWei, 18);
            
//             console.log(`✅ ${version} multi-swap successful: ${receipt.transactionHash}`);
//             console.log(`⛽ Gas used: ${receipt.gasUsed.toString()} (estimated: ${gasLimit.toString()})`);
//             console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
//             console.log(`🔄 Swap cost: ${swapCostETH} ETH (${swapCostWei.toString()} wei)`);
//             console.log(`📊 Gas efficiency: ${gasEfficiency}%`);
//             console.log(`🎯 Tokens swapped: ${numberOfTokens} (${version})`);
//             console.log(`💸 Remaining ETH returned to main wallet: ${tokenOwner}`);
            
//             return { 
//                 success: true, 
//                 txHash: receipt.transactionHash,
//                 gasUsed: receipt.gasUsed.toString(),
//                 gasEstimated: gasLimit.toString(),
//                 actualGasCost: actualGasCostETH,
//                 estimatedGasCost: totalGasCostETH,
//                 swapCost: swapCostETH,
//                 gasEfficiency,
//                 tokensSwapped: numberOfTokens,
//                 swapVersion: version,
//                 walletIndex: index,
//                 walletAddress: signer.address,
//                 returnAddress: tokenOwner
//             };
//         } else {
//             console.log(`❌ ${version} multi-swap failed: ${receipt?.transactionHash || swapTransaction.hash}`);
//             return { 
//                 success: false, 
//                 reason: 'transaction_failed', 
//                 txHash: receipt?.transactionHash || swapTransaction.hash 
//             };
//         }
        
//     } catch (err) {
//         console.error(`Error for wallet ${index}:`, err.message);
        
//         // Handle specific error types
//         if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
//             console.log(`No funds in wallet ${index}`);
//             return { success: false, reason: 'insufficient_funds' };
//         } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW' || err.message.includes('nonce too low')) {
//             console.log(`Nonce issue in wallet ${index}`);
//             return { success: false, reason: 'nonce_error' };
//         } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
//             console.log(`Gas price too low for wallet ${index}`);
//             return { success: false, reason: 'gas_price_low' };
//         } else if (err.message.includes('gas')) {
//             console.log(`Gas related error for wallet ${index}:`, err.message);
//             return { success: false, reason: 'gas_error' };
//         } else if (err.message.includes('INVALID_ARGUMENT')) {
//             console.log(`ABI parsing error for wallet ${index}:`, err.message);
//             return { success: false, reason: 'abi_error' };
//         } else if (err.message.includes('insufficient liquidity') || err.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
//             console.log(`Insufficient liquidity for wallet ${index}`);
//             return { success: false, reason: 'insufficient_liquidity' };
//         } else if (err.message.includes('execution reverted')) {
//             console.log(`Contract execution reverted for wallet ${index}:`, err.message);
//             return { success: false, reason: 'execution_reverted' };
//         }
        
//         // Only throw truly unexpected errors
//         console.error(`Unexpected error in wallet ${index}:`, err.message);
//         return { success: false, reason: 'unknown_error', error: err.message };
//     }
// }

async function multiSwapV2Batch(wallets, batchSize = config.defaultBatchSize, tokenAddresses, startAt, endsAt, delayBetweenBatches = 2000, delayBetweenTx = 100) {
    const batchStartTime = Date.now(); // Track total batch execution time
    
    log(`Starting V2 Multi-Swap batch processing with enhanced controls:`);
    log(`• Batch size: ${batchSize}`);
    log(`• Token addresses: ${tokenAddresses ? tokenAddresses.split(',').length : 'default'} tokens`);
    log(`• Wallet range: ${startAt} to ${endsAt}`);
    log(`• Delay between batches: ${delayBetweenBatches}ms`);
    log(`• Delay between transactions: ${delayBetweenTx}ms`);
    
    // Parse token addresses
    let tokens = null;
    if (tokenAddresses && tokenAddresses.trim()) {
        tokens = tokenAddresses.split(',').map(addr => addr.trim()).filter(addr => addr);
        log(`• Using custom tokens: ${tokens.slice(0, 3).join(', ')}${tokens.length > 3 ? '...' : ''}`);
    } else {
        log(`• Using default V2 tokens`);
    }
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    log(`• Gas max limit: ${gasMaxETH} ETH`);

    if (wallets.length === 0) {
        // Track batch failure - no wallets
        trackTransaction({
            success: false,
            gasUsed: "0",
            gasCost: "0",
            operationType: "V2_swaps",
            additionalData: {
                error: 'no_wallets_found',
                batchSize,
                tokenCount: tokens?.length || 0,
                executionTime: Date.now() - batchStartTime
            }
        }).catch(err => console.warn('Stats tracking failed:', err.message));
        
        throw new Error('No wallets found. Create wallets first.');
    }

    // Validate range
    const actualEnd = Math.min(endsAt, wallets.length);
    if (startAt >= actualEnd) {
        // Track batch failure - invalid range
        trackTransaction({
            success: false,
            gasUsed: "0",
            gasCost: "0",
            operationType: "V2_swaps",
            additionalData: {
                error: 'invalid_range',
                startAt,
                endsAt,
                actualEnd,
                totalWallets: wallets.length,
                batchSize,
                executionTime: Date.now() - batchStartTime
            }
        }).catch(err => console.warn('Stats tracking failed:', err.message));
        
        throw new Error(`Invalid range: startAt (${startAt}) must be less than endsAt (${actualEnd})`);
    }

    let successfulSwaps = 0;
    let failedSwaps = 0;
    let gasLimitExceeded = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let totalTokensSwapped = 0;
    let totalGasCost = ethers.BigNumber.from("0");
    let totalGasUsed = ethers.BigNumber.from("0");
    
    // Track batch operation start
    trackTransaction({
        success: true,
        gasUsed: "0",
        gasCost: "0",
        operationType: "V2_swaps",
        additionalData: {
            batchSize,
            tokenCount: tokens?.length || 0,
            walletRange: `${startAt}-${actualEnd}`,
            totalWallets: actualEnd - startAt,
            delayBetweenBatches,
            delayBetweenTx,
            customTokensUsed: tokens?.length || 0
        }
    }).catch(err => console.warn('Stats tracking failed:', err.message));
    
    // Calculate total batches for progress tracking
    const totalBatches = Math.ceil((actualEnd - startAt) / batchSize);
    log(`📊 Processing ${totalBatches} batches for ${actualEnd - startAt} wallets total\n`);
    
    for (let start = startAt; start < actualEnd; start += batchSize) {
        const end = Math.min(start + batchSize, actualEnd);
        batchCount++;
        const currentBatchStartTime = Date.now();
        
        log(`🔄 Processing V2 Multi-Swap batch ${batchCount}/${totalBatches} (wallets ${start}-${end-1})`);
        
        // Track batch-specific results
        let batchSuccessful = 0;
        let batchFailed = 0;
        let batchGasExceeded = 0;
        let batchTokensSwapped = 0;
        let batchGasCost = ethers.BigNumber.from("0");
        let batchGasUsed = ethers.BigNumber.from("0");
        
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            // Add delay between transactions within batch if specified
            if (delayBetweenTx > 0 && i > start) {
                await sleep(delayBetweenTx);
            }
            
            batchPromises.push(
                executeMultiSwap(i, wallets, tokens)
                    .then((result) => {
                        totalProcessed++;
                        
                        // Accumulate gas statistics
                        if (result.actualGasCost) {
                            const gasCostWei = ethers.utils.parseUnits(result.actualGasCost, 18);
                            totalGasCost = totalGasCost.add(gasCostWei);
                            batchGasCost = batchGasCost.add(gasCostWei);
                        }
                        if (result.gasUsed) {
                            const gasUsedBN = ethers.BigNumber.from(result.gasUsed);
                            totalGasUsed = totalGasUsed.add(gasUsedBN);
                            batchGasUsed = batchGasUsed.add(gasUsedBN);
                        }
                        
                        if (result.success) {
                            successfulSwaps++;
                            batchSuccessful++;
                            totalTokensSwapped += result.tokensSwapped || 0;
                            batchTokensSwapped += result.tokensSwapped || 0;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                            log(`   Tokens swapped: ${result.tokensSwapped}, Router: V2`);
                            if (result.gasEfficiency) {
                                log(`   Gas efficiency: ${result.gasEfficiency}%`);
                            }
                        } else if (result.reason === 'gas_cost_exceeds_max') {
                            gasLimitExceeded++;
                            batchGasExceeded++;
                            log(`💰 Wallet ${i}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                            if (result.tokensCount) {
                                log(`   Would have swapped: ${result.tokensCount} tokens`);
                            }
                        } else {
                            failedSwaps++;
                            batchFailed++;
                            const reason = result.reason || 'unknown';
                            log(`❌ Wallet ${i}: Failed - ${reason}`);
                            
                            // Enhanced error reporting for V2
                            if (reason === 'insufficient_liquidity') {
                                log(`   V2 liquidity issue - try different tokens or smaller amounts`);
                            } else if (reason === 'execution_reverted') {
                                log(`   Contract execution failed - check token addresses and router`);
                            } else if (reason === 'insufficient_funds') {
                                log(`   Wallet balance too low for gas + swap amounts`);
                            }
                        }
                        return result;
                    })
                    .catch((error) => {
                        totalProcessed++;
                        failedSwaps++;
                        batchFailed++;
                        log(`💥 Wallet ${i}: Error - ${error.message}`);
                        return { success: false, reason: 'exception', error: error.message };
                    })
            );
        }
        
        // Wait for all transactions in current batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Track individual batch completion
        const batchExecutionTime = Date.now() - currentBatchStartTime;
        trackTransaction({
            success: batchSuccessful > 0,
            gasUsed: batchGasUsed.toString(),
            gasCost: ethers.utils.formatEther(batchGasCost),
            operationType: "V2_swaps",
            tokensSwapped: batchTokensSwapped,
            additionalData: {
                batchNumber: batchCount,
                totalBatches,
                walletRange: `${start}-${end-1}`,
                batchSuccessful,
                batchFailed,
                batchGasExceeded,
                batchTokensSwapped,
                batchSize: end - start,
                executionTime: batchExecutionTime,
                delayBetweenTx,
                customTokensInBatch: tokens?.length || 0
            }
        }).catch(err => console.warn('Stats tracking failed:', err.message));
        
        // Calculate batch success rate
        const batchTotal = batchResults.length;
        const batchSuccessRate = batchTotal > 0 ? ((batchSuccessful / batchTotal) * 100).toFixed(1) : '0.0';
        
        log(`📈 Batch ${batchCount} completed:`);
        log(`   • Successful: ${batchSuccessful}/${batchTotal} (${batchSuccessRate}%)`);
        log(`   • Failed: ${batchFailed}`);
        log(`   • Gas exceeded: ${batchGasExceeded}`);
        log(`   • Tokens swapped in batch: ${batchTokensSwapped}`);
        
        // Overall progress
        const overallProcessed = totalProcessed;
        const overallSuccessRate = overallProcessed > 0 ? ((successfulSwaps / overallProcessed) * 100).toFixed(1) : '0.0';
        const avgTokensPerWallet = successfulSwaps > 0 ? (totalTokensSwapped / successfulSwaps).toFixed(1) : '0.0';
        
        log(`📊 Overall progress: ${overallProcessed}/${actualEnd - startAt} (${overallSuccessRate}% success rate)`);
        log(`💎 Total tokens swapped: ${totalTokensSwapped} (avg: ${avgTokensPerWallet} per successful wallet)`);
        
        // Delay between batches (except for the last batch)
        if (end < actualEnd) {
            log(`⏱️  Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await sleep(delayBetweenBatches);
        }
    }
    
    // Final summary
    const totalWallets = actualEnd - startAt;
    const finalSuccessRate = totalProcessed > 0 ? ((successfulSwaps / totalProcessed) * 100).toFixed(2) : '0.00';
    const finalAvgTokensPerWallet = successfulSwaps > 0 ? (totalTokensSwapped / successfulSwaps).toFixed(2) : '0.00';
    const totalExecutionTime = Date.now() - batchStartTime;
    
    log(`\n🎯 V2 Multi-Swap Batch Processing Complete!`);
    log(`📊 Final Results:`);
    log(`   • Total wallets processed: ${totalProcessed}/${totalWallets}`);
    log(`   • Successful multi-swaps: ${successfulSwaps}`);
    log(`   • Failed multi-swaps: ${failedSwaps}`);
    log(`   • Gas limit exceeded: ${gasLimitExceeded}`);
    log(`   • Success rate: ${finalSuccessRate}%`);
    log(`   • Total tokens swapped: ${totalTokensSwapped}`);
    log(`   • Average tokens per successful wallet: ${finalAvgTokensPerWallet}`);
    log(`   • Batches processed: ${batchCount}`);
    
    // Token-specific summary if custom tokens were used
    if (tokens && tokens.length > 0) {
        log(`🪙 Token Summary:`);
        log(`   • Custom tokens used: ${tokens.length}`);
        log(`   • Token addresses: ${tokens.slice(0, 5).join(', ')}${tokens.length > 5 ? '...' : ''}`);
        log(`   • Router: Uniswap V2 compatible`);
    }
    
    // Track final batch operation completion
    trackTransaction({
        success: successfulSwaps > 0,
        gasUsed: totalGasUsed.toString(),
        gasCost: ethers.utils.formatEther(totalGasCost),
        operationType: "V2_swaps",
        tokensSwapped: totalTokensSwapped,
        additionalData: {
            totalProcessed,
            successfulSwaps,
            failedSwaps,
            gasLimitExceeded,
            successRate: parseFloat(finalSuccessRate),
            batchesProcessed: batchCount,
            totalBatches,
            walletsInRange: totalWallets,
            totalTokensSwapped,
            averageTokensPerWallet: parseFloat(finalAvgTokensPerWallet),
            customTokensUsed: tokens ? tokens.length : 0,
            swapType: 'V2_Multi',
            routerType: 'V2',
            totalExecutionTime,
            batchSize,
            delayBetweenBatches,
            delayBetweenTx,
            averageTimePerWallet: totalProcessed > 0 ? Math.round(totalExecutionTime / totalProcessed) : 0,
            gasEfficiency: totalGasUsed.gt(0) ? 
                ((successfulSwaps / totalProcessed) * 100).toFixed(2) : '0.00'
        }
    }).catch(err => console.warn('Stats tracking failed:', err.message));
    
    // Return detailed results
    return {
        totalProcessed,
        successfulSwaps,
        failedSwaps,
        gasLimitExceeded,
        successRate: parseFloat(finalSuccessRate),
        batchesProcessed: batchCount,
        walletsInRange: totalWallets,
        totalTokensSwapped,
        averageTokensPerWallet: parseFloat(finalAvgTokensPerWallet),
        customTokensUsed: tokens ? tokens.length : 0,
        swapType: 'V2_Multi',
        routerType: 'V2',
        totalExecutionTime,
        totalGasCost: ethers.utils.formatEther(totalGasCost),
        totalGasUsed: totalGasUsed.toString(),
        averageTimePerWallet: totalProcessed > 0 ? Math.round(totalExecutionTime / totalProcessed) : 0
    };
}

async function executeMultiSwap(index, wallets, tokens = null, version = "V2") {
    try {
        if (index >= wallets.length) {
            console.log(`Index ${index} exceeds wallet array length`);
            return { success: false, reason: 'index_out_of_bounds' };
        }

        const signer = new ethers.Wallet(wallets[index][1], provider);
        console.log(`Wallet ${index}: ${signer.address}`);

        // Check wallet balance first
        const currentBalance = await provider.getBalance(signer.address);
        const minBalance = ethers.utils.parseUnits("0.000001", 18);
        
        if (currentBalance.lt(minBalance)) {
            console.log(`Insufficient balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
            return { success: false, reason: 'insufficient_funds' };
        }
        
        console.log(`Wallet balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
        
        // Get gas max limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        // Contract and router addresses
        const contractAddress = contracts.basedBonkSwapsContract || "0xe86e08B971f4977DA8f0b6d579687F14Ee08437a";
        const routerAddress = contracts.uniswapRouter || "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
        const routerV3Address = contracts.uniswapRouterV3 || "0x2626664c2603336E57B271c5C0b26F421741e481";
        
        // Define tokens to swap
        const tokensToSwap = tokens || defaultTokens[version] || [
            "0xBA5E66FB16944Da22A62Ea4FD70ad02008744460"
        ];

        const numberOfTokens = tokensToSwap.length;
        console.log(`Number of tokens to swap: ${numberOfTokens} (${version})`);
        
        // Create contract interface
        const contractInterface = new ethers.utils.Interface([
            version === "V2" ? 
            "function executeMultiSwapV2((address,address,address)[] swapDetailsV2, address tokenOwner) external payable" :
            "function executeMultiSwapV3((address,address,address,uint24)[] swapDetailsV3, address tokenOwner) external payable"
        ]);
        
        // Create swap details
        let swapDetails;
        let functionName;
        
        if (version === "V2") {
            swapDetails = tokensToSwap.map(tokenAddress => [
                tokenAddress,
                routerAddress,
                signer.address
            ]);
            functionName = "executeMultiSwapV2";
        } else {
            const v3Fee = 10000;
            swapDetails = tokensToSwap.map(tokenAddress => [
                tokenAddress,
                routerV3Address,
                signer.address,
                v3Fee
            ]);
            functionName = "executeMultiSwapV3";
        }

        console.log(`Creating ${version} swap details for ${numberOfTokens} tokens...`);
        
        // Get main signer address
        const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        const tokenOwner = mainSigner.address;
        
        // Get gas price
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        const minGasPrice = ethers.utils.parseUnits("0.001", 9);
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100);
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas with very small test value that wallet can afford
        let gasLimit;
        const testValue = currentBalance.div(10); // Use 10% of balance for estimation
        
        try {
            const txData = contractInterface.encodeFunctionData(functionName, [swapDetails, tokenOwner]);
            
            gasLimit = await provider.estimateGas({
                to: contractAddress,
                data: txData,
                value: testValue,
                from: signer.address
            });
            
            console.log(`Estimated gas limit: ${gasLimit.toString()}`);
            gasLimit = gasLimit.mul(120).div(100); // 20% buffer
            
        } catch (gasError) {
            console.log(`Gas estimation failed, using fallback:`);
            gasLimit = ethers.BigNumber.from("200000"); // Conservative fallback
        }
        
        // Calculate gas cost
        const totalGasCost = gasPrice.mul(gasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
        console.log(`Gas limit with buffer: ${gasLimit.toString()}`);
        console.log(`Total gas cost: ${totalGasCostETH} ETH`);
        console.log(`Gas max limit: ${gasMaxETH} ETH`);
        
        // Check gas cost against limit
        if (totalGasCost.gt(gasMaxWei)) {
            console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            return { 
                success: false, 
                reason: 'gas_cost_exceeds_max',
                gasRequested: totalGasCostETH,
                gasMaxAllowed: gasMaxETH,
                tokensCount: numberOfTokens
            };
        }
        
        // Calculate value to send: balance - gas cost (with large buffer for safety)
        const gasBuffer = ethers.utils.parseUnits("0.0000005", 18); // 0.000005 ETH buffer 
        const valueToSend = currentBalance.sub(totalGasCost).sub(gasBuffer);
        
        if (valueToSend.lte(0)) {
            console.log(`Insufficient funds after gas. Balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH, Gas: ${totalGasCostETH} ETH`);
            return { success: false, reason: 'insufficient_funds_for_swap' };
        }
        
        console.log(`Value to send to contract: ${ethers.utils.formatUnits(valueToSend, 18)} ETH`);
        console.log(`Gas cost: ${totalGasCostETH} ETH`);
        
        console.log(`✅ Proceeding with ${version} multi-swap...`);
        console.log(`Contract: ${contractAddress}`);
        console.log(`Token Owner (return address): ${tokenOwner}`);
        
        // Execute transaction
        const nonce = await signer.getTransactionCount("latest");
        const txData = contractInterface.encodeFunctionData(functionName, [swapDetails, tokenOwner]);
        
        const transaction = await signer.sendTransaction({
            to: contractAddress,
            data: txData,
            value: valueToSend,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            nonce: nonce,
            type: 0
        });
        
        console.log(`${version} multi-swap transaction sent: ${transaction.hash}`);
        console.log(`Value sent: ${ethers.utils.formatUnits(valueToSend, 18)} ETH`);
        
        // Wait for confirmation
        let receipt;
        try {
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                return { success: false, reason: 'receipt_error', txHash: transaction.hash };
            }
        }
        
        if (receipt && receipt.status === 1) {
            const actualGasCost = gasPrice.mul(receipt.gasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            const gasEfficiency = ((receipt.gasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ ${version} multi-swap successful: ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()} (estimated: ${gasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${gasEfficiency}%`);
            console.log(`🎯 Tokens swapped: ${numberOfTokens} (${version})`);
            console.log(`💸 Contract handles fees and returns remaining ETH to: ${tokenOwner}`);
            
            return { 
                success: true, 
                txHash: receipt.transactionHash,
                gasUsed: receipt.gasUsed.toString(),
                gasEstimated: gasLimit.toString(),
                actualGasCost: actualGasCostETH,
                estimatedGasCost: totalGasCostETH,
                gasEfficiency,
                tokensSwapped: numberOfTokens,
                swapVersion: version,
                walletIndex: index,
                walletAddress: signer.address,
                returnAddress: tokenOwner,
                valueSent: ethers.utils.formatUnits(valueToSend, 18)
            };
        } else {
            console.log(`❌ ${version} multi-swap failed: ${receipt?.transactionHash || transaction.hash}`);
            return { 
                success: false, 
                reason: 'transaction_failed', 
                txHash: receipt?.transactionHash || transaction.hash 
            };
        }
        
    } catch (err) {
        console.error(`Error for wallet ${index}:`, err.message);
        
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            console.log(`No funds in wallet ${index}`);
            return { success: false, reason: 'insufficient_funds' };
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW' || err.message.includes('nonce too low')) {
            console.log(`Nonce issue in wallet ${index}`);
            return { success: false, reason: 'nonce_error' };
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            console.log(`Gas price too low for wallet ${index}`);
            return { success: false, reason: 'gas_price_low' };
        } else if (err.message.includes('gas')) {
            console.log(`Gas related error for wallet ${index}:`, err.message);
            return { success: false, reason: 'gas_error' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            console.log(`ABI parsing error for wallet ${index}:`, err.message);
            return { success: false, reason: 'abi_error' };
        } else if (err.message.includes('insufficient liquidity') || err.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
            console.log(`Insufficient liquidity for wallet ${index}`);
            return { success: false, reason: 'insufficient_liquidity' };
        } else if (err.message.includes('execution reverted')) {
            console.log(`Contract execution reverted for wallet ${index}:`, err.message);
            return { success: false, reason: 'execution_reverted' };
        }
        
        console.error(`Unexpected error in wallet ${index}:`, err.message);
        return { success: false, reason: 'unknown_error', error: err.message };
    }
}

async function multiSwapV3Batch(wallets, batchSize = config.defaultBatchSize, tokenAddresses, startAt, endsAt, delayBetweenBatches = 2000, delayBetweenTx = 100) {
    log(`Starting V3 Multi-Swap batch processing with enhanced controls:`);
    log(`• Batch size: ${batchSize}`);
    log(`• Token addresses: ${tokenAddresses ? tokenAddresses.split(',').length : 'default'} tokens`);
    log(`• Wallet range: ${startAt} to ${endsAt}`);
    log(`• Delay between batches: ${delayBetweenBatches}ms`);
    log(`• Delay between transactions: ${delayBetweenTx}ms`);
    
    // Parse token addresses
    let tokens = null;
    if (tokenAddresses && tokenAddresses.trim()) {
        tokens = tokenAddresses.split(',').map(addr => addr.trim()).filter(addr => addr);
        log(`• Using custom tokens: ${tokens.slice(0, 3).join(', ')}${tokens.length > 3 ? '...' : ''}`);
    } else {
        log(`• Using default V3 tokens`);
    }
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    log(`• Gas max limit: ${gasMaxETH} ETH`);

    if (wallets.length === 0) {
        throw new Error('No wallets found. Create wallets first.');
    }

    // Validate range
    const actualEnd = Math.min(endsAt, wallets.length);
    if (startAt >= actualEnd) {
        throw new Error(`Invalid range: startAt (${startAt}) must be less than endsAt (${actualEnd})`);
    }

    let successfulSwaps = 0;
    let failedSwaps = 0;
    let gasLimitExceeded = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    let totalTokensSwapped = 0;
    
    // Calculate total batches for progress tracking
    const totalBatches = Math.ceil((actualEnd - startAt) / batchSize);
    log(`📊 Processing ${totalBatches} batches for ${actualEnd - startAt} wallets total\n`);
    
    for (let start = startAt; start < actualEnd; start += batchSize) {
        const end = Math.min(start + batchSize, actualEnd);
        batchCount++;
        
        log(`🔄 Processing V3 Multi-Swap batch ${batchCount}/${totalBatches} (wallets ${start}-${end-1})`);
        
        // Track batch-specific results
        let batchSuccessful = 0;
        let batchFailed = 0;
        let batchGasExceeded = 0;
        let batchTokensSwapped = 0;
        
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            // Add delay between transactions within batch if specified
            if (delayBetweenTx > 0 && i > start) {
                await sleep(delayBetweenTx);
            }
            
            batchPromises.push(
                executeMultiSwap(i, wallets, tokens, "V3")
                    .then((result) => {
                        totalProcessed++;
                        if (result.success) {
                            successfulSwaps++;
                            batchSuccessful++;
                            totalTokensSwapped += result.tokensSwapped || 0;
                            batchTokensSwapped += result.tokensSwapped || 0;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                            log(`   Tokens swapped: ${result.tokensSwapped}, Fee tier: ${result.feeTier}bp`);
                            if (result.gasEfficiency) {
                                log(`   Gas efficiency: ${result.gasEfficiency}%`);
                            }
                        } else if (result.reason === 'gas_cost_exceeds_max') {
                            gasLimitExceeded++;
                            batchGasExceeded++;
                            log(`💰 Wallet ${i}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                            if (result.tokensCount) {
                                log(`   Would have swapped: ${result.tokensCount} tokens`);
                            }
                        } else {
                            failedSwaps++;
                            batchFailed++;
                            const reason = result.reason || 'unknown';
                            log(`❌ Wallet ${i}: Failed - ${reason}`);
                            
                            // Enhanced error reporting for V3
                            if (reason === 'insufficient_liquidity') {
                                log(`   V3 liquidity issue - try different fee tier or tokens`);
                            } else if (reason === 'v3_math_error') {
                                log(`   V3 math overflow - amount may be too small for fee tier`);
                            } else if (reason === 'execution_reverted') {
                                log(`   Contract execution failed - check token addresses`);
                            }
                        }
                        return result;
                    })
                    .catch((error) => {
                        totalProcessed++;
                        failedSwaps++;
                        batchFailed++;
                        log(`💥 Wallet ${i}: Error - ${error.message}`);
                        return { success: false, reason: 'exception', error: error.message };
                    })
            );
        }
        
        // Wait for all transactions in current batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Calculate batch success rate
        const batchTotal = batchResults.length;
        const batchSuccessRate = batchTotal > 0 ? ((batchSuccessful / batchTotal) * 100).toFixed(1) : '0.0';
        
        log(`📈 Batch ${batchCount} completed:`);
        log(`   • Successful: ${batchSuccessful}/${batchTotal} (${batchSuccessRate}%)`);
        log(`   • Failed: ${batchFailed}`);
        log(`   • Gas exceeded: ${batchGasExceeded}`);
        log(`   • Tokens swapped in batch: ${batchTokensSwapped}`);
        
        // Overall progress
        const overallProcessed = totalProcessed;
        const overallSuccessRate = overallProcessed > 0 ? ((successfulSwaps / overallProcessed) * 100).toFixed(1) : '0.0';
        const avgTokensPerWallet = successfulSwaps > 0 ? (totalTokensSwapped / successfulSwaps).toFixed(1) : '0.0';
        
        log(`📊 Overall progress: ${overallProcessed}/${actualEnd - startAt} (${overallSuccessRate}% success rate)`);
        log(`💎 Total tokens swapped: ${totalTokensSwapped} (avg: ${avgTokensPerWallet} per successful wallet)`);
        
        // Delay between batches (except for the last batch)
        if (end < actualEnd) {
            log(`⏱️  Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await sleep(delayBetweenBatches);
        }
    }
    
    // Final summary
    const totalWallets = actualEnd - startAt;
    const finalSuccessRate = totalProcessed > 0 ? ((successfulSwaps / totalProcessed) * 100).toFixed(2) : '0.00';
    const finalAvgTokensPerWallet = successfulSwaps > 0 ? (totalTokensSwapped / successfulSwaps).toFixed(2) : '0.00';
    
    log(`\n🎯 V3 Multi-Swap Batch Processing Complete!`);
    log(`📊 Final Results:`);
    log(`   • Total wallets processed: ${totalProcessed}/${totalWallets}`);
    log(`   • Successful multi-swaps: ${successfulSwaps}`);
    log(`   • Failed multi-swaps: ${failedSwaps}`);
    log(`   • Gas limit exceeded: ${gasLimitExceeded}`);
    log(`   • Success rate: ${finalSuccessRate}%`);
    log(`   • Total tokens swapped: ${totalTokensSwapped}`);
    log(`   • Average tokens per successful wallet: ${finalAvgTokensPerWallet}`);
    log(`   • Batches processed: ${batchCount}`);
    
    // Token-specific summary if custom tokens were used
    if (tokens && tokens.length > 0) {
        log(`🪙 Token Summary:`);
        log(`   • Custom tokens used: ${tokens.length}`);
        log(`   • Token addresses: ${tokens.slice(0, 5).join(', ')}${tokens.length > 5 ? '...' : ''}`);
    }
    
    // Return detailed results
    return {
        totalProcessed,
        successfulSwaps,
        failedSwaps,
        gasLimitExceeded,
        successRate: parseFloat(finalSuccessRate),
        batchesProcessed: batchCount,
        walletsInRange: totalWallets,
        totalTokensSwapped,
        averageTokensPerWallet: parseFloat(finalAvgTokensPerWallet),
        customTokensUsed: tokens ? tokens.length : 0,
        swapType: 'V3_Multi'
    };
}

async function executeV3Swap(index, wallets, tokenAddress) {
    try {
        if (index >= wallets.length) {
            console.log(`Index ${index} exceeds wallet array length`);
            return { success: false, reason: 'index_out_of_bounds' };
        }
        
        const signer = new ethers.Wallet(wallets[index][1], provider);
        console.log(`Index: ${index} ${signer.address}`);

        // Check wallet balance first
        const balance = await provider.getBalance(signer.address);
        const minBalance = ethers.utils.parseUnits("0.000001", 18); // 0.000001 ETH minimum
        
        if (balance.lt(minBalance)) {
            console.log(`Insufficient balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_funds' };
        }
        
        console.log(`Wallet balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        
        // Get gas max limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        const amount = ethers.utils.parseUnits("10", "wei");
        const weth = "0x4200000000000000000000000000000000000006";
        const contractAddress = '0xe9d7E6669C39350DD6664fd6fB66fCE4D871D374'
        const token = tokenAddress || random(defaultTokens["V3"]);
        const fee = 10000;
        
        // Build exact transaction data
        const functionSelector = "0xd014efef";
        const encodedParams = ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "address"],
            [weth, token, fee, signer.address]
        );
        
        const txData = functionSelector + encodedParams.slice(2);
        
        // Enhanced gas price calculation
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Force minimum gas price for Base network
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas limit with fallback
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                to: contractAddress,
                data: txData,
                value: amount,
                from: signer.address
            });
            
            // Add 20% buffer to gas limit
            gasLimit = gasLimit.mul(120).div(100);
            console.log(`Estimated gas limit: ${gasLimit.toString()}`);
        } catch (gasError) {
            console.log(`Gas estimation failed, using fallback: ${gasError.message}`);
            gasLimit = ethers.BigNumber.from("200000");
        }
        
        // Calculate total gas cost
        const totalGasCost = gasPrice.mul(gasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
        console.log(`Total gas cost: ${totalGasCostETH} ETH`);
        console.log(`Gas max limit: ${gasMaxETH} ETH`);
        
        // Check gas cost against gasMax
        if (totalGasCost.gt(gasMaxWei)) {
            console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Transaction cancelled to stay within gas limits`);
            return { 
                success: false, 
                reason: 'gas_cost_exceeds_max',
                gasRequested: totalGasCostETH,
                gasMaxAllowed: gasMaxETH
            };
        }
        
        // Check if wallet has enough balance for gas + swap amount
        const totalCost = totalGasCost.add(amount);
        if (balance.lt(totalCost)) {
            console.log(`Insufficient balance for gas + swap. Need ${ethers.utils.formatUnits(totalCost, 18)} ETH, have ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_gas' };
        }
        
        console.log(`✅ Gas cost within limits, proceeding with V3 swap...`);
        console.log(`Contract: ${contractAddress}`);
        console.log(`WETH: ${weth}`);
        console.log(`Token: ${token}`);
        console.log(`Fee: ${fee}`);
        console.log(`Amount: ${amount.toString()} wei`);
        
        // Get nonce
        const nonce = await signer.getTransactionCount("latest");
        
        const tx = {
            to: contractAddress,
            data: txData,
            value: amount,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        };
        
        // Send transaction
        const transaction = await signer.sendTransaction(tx);
        console.log(`Transaction sent: ${transaction.hash}`);
        
        // Wait for confirmation with timeout
        let receipt;
        try {
            // Wait up to 2 minutes for confirmation
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            // Try to get receipt manually after waiting
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                return { success: false, reason: 'receipt_error', txHash: transaction.hash };
            }
        }
        
        if (receipt && receipt.status === 1) {
            const actualGasCost = gasPrice.mul(receipt.gasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            const gasEfficiency = ((receipt.gasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ V3 Swap Success! Hash: ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()} (estimated: ${gasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${gasEfficiency}%`);
            
            return { 
                success: true, 
                txHash: receipt.transactionHash,
                gasUsed: receipt.gasUsed.toString(),
                gasEstimated: gasLimit.toString(),
                actualGasCost: actualGasCostETH,
                estimatedGasCost: totalGasCostETH,
                gasEfficiency,
                walletIndex: index,
                walletAddress: signer.address,
                tokenAddress: token,
                hash: receipt.transactionHash // Legacy compatibility
            };
        } else {
            console.log(`❌ V3 Swap Failed: ${receipt?.transactionHash || transaction.hash}`);
            return { 
                success: false, 
                reason: 'transaction_failed', 
                txHash: receipt?.transactionHash || transaction.hash 
            };
        }
        
    } catch (err) {
        console.error(`Error for wallet ${index}:`, err.message);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            console.log(`No funds in wallet ${index}`);
            return { success: false, reason: 'insufficient_funds' };
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW' || err.message.includes('nonce too low')) {
            console.log(`Nonce issue in wallet ${index}`);
            return { success: false, reason: 'nonce_error' };
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            console.log(`Gas price too low for wallet ${index}`);
            return { success: false, reason: 'gas_price_low' };
        } else if (err.message.includes('gas')) {
            console.log(`Gas related error for wallet ${index}:`, err.message);
            return { success: false, reason: 'gas_error' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            console.log(`ABI parsing error for wallet ${index}:`, err.message);
            return { success: false, reason: 'abi_error' };
        } else if (err.message.includes('insufficient liquidity') || err.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
            console.log(`Insufficient liquidity for wallet ${index}`);
            return { success: false, reason: 'insufficient_liquidity' };
        }
        
        // Only throw truly unexpected errors
        console.error(`Unexpected error in wallet ${index}:`, err.message);
        return { success: false, reason: 'unknown_error', error: err.message };
    }
}

async function airdropBatch(chunkSize = config.defaultChunkSize, totalEthAmount = null, startAt = 0, endAt = null, delayBetweenChunks = 3000) {
    log(`Starting airdrop batch processing with enhanced controls:`);
    log(`• Chunk size: ${chunkSize} wallets per transaction`);
    log(`• Delay between chunks: ${delayBetweenChunks}ms`);
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    log(`• Gas max limit: ${gasMaxETH} ETH`);
    
    const allWallets = loadWallets();
    if (allWallets.length === 0) {
        throw new Error('No wallets found. Create wallets first.');
    }
    
    // Apply range filtering
    const actualEndAt = endAt !== null ? Math.min(endAt, allWallets.length) : allWallets.length;
    const actualStartAt = Math.max(0, Math.min(startAt, allWallets.length - 1));
    
    if (actualStartAt >= actualEndAt) {
        throw new Error(`Invalid range: startAt (${actualStartAt}) must be less than endAt (${actualEndAt})`);
    }
    
    const wallets = allWallets.slice(actualStartAt, actualEndAt);
    
    log(`• Total wallets available: ${allWallets.length}`);
    log(`• Processing range: ${actualStartAt} to ${actualEndAt - 1} (${wallets.length} wallets)`);
    
    let amountPerWallet;
    let totalDistribution;
    
    if (totalEthAmount) {
        // Calculate amount per wallet for the selected range
        totalDistribution = ethers.utils.parseUnits(totalEthAmount.toString(), 18);
        amountPerWallet = totalDistribution.div(wallets.length);
        
        log(`\n📊 Airdrop Distribution Summary:`);
        log(`• Total ETH to distribute: ${totalEthAmount} ETH`);
        log(`• Wallets in range: ${wallets.length}`);
        log(`• ETH per wallet: ${ethers.utils.formatEther(amountPerWallet)} ETH`);
        
        // Verify we have enough balance
        const signer = new ethers.Wallet(config.fundingPrivateKey, provider);
        const balance = await provider.getBalance(signer.address);
        if (balance.lt(totalDistribution)) {
            throw new Error(`Insufficient balance. Need ${totalEthAmount} ETH but have ${ethers.utils.formatEther(balance)} ETH`);
        }
        log(`• Main wallet balance: ${ethers.utils.formatEther(balance)} ETH ✅`);
    } else {
        log(`• Using default amount per wallet (0.0015 ETH each)`);
    }
    
    // Setup contract once for all chunks
    const signer = new ethers.Wallet(config.fundingPrivateKey, provider);
    const airdrop = new ethers.Contract("0x4F50E08aa6059aC120AD7Bb82c097Fd89f517Da3", airdropAbi, signer);
    
    let totalSuccessful = 0;
    let totalFailed = 0;
    let gasLimitExceeded = 0;
    const completedChunks = [];
    const skippedChunks = [];
    
    // Calculate total chunks for progress tracking
    const totalChunks = Math.ceil(wallets.length / chunkSize);
    log(`\n🔄 Processing ${totalChunks} chunks...\n`);
    
    for (let start = 0; start < wallets.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, wallets.length);
        const recipientsInChunk = end - start;
        const recipients = wallets.slice(start, end).map(wallet => wallet[0]);
        const chunkNumber = Math.floor(start / chunkSize) + 1;
        
        // Calculate actual wallet indices for logging
        const actualWalletStart = actualStartAt + start;
        const actualWalletEnd = actualStartAt + end - 1;
        
        try {
            let chunkValue;
            
            if (totalEthAmount) {
                // Calculate the portion of total ETH for this chunk
                chunkValue = amountPerWallet.mul(recipientsInChunk);
                const chunkAmountEth = ethers.utils.formatEther(chunkValue);
                log(`🔄 Processing chunk ${chunkNumber}/${totalChunks} (wallets ${actualWalletStart}-${actualWalletEnd}): ${chunkAmountEth} ETH for ${recipientsInChunk} wallets`);
            } else {
                // Use default amount per wallet
                const defaultAmount = ethers.utils.parseUnits("0.0015", 18);
                chunkValue = defaultAmount.mul(recipientsInChunk);
                log(`🔄 Processing chunk ${chunkNumber}/${totalChunks} (wallets ${actualWalletStart}-${actualWalletEnd}): ${ethers.utils.formatEther(chunkValue)} ETH for ${recipientsInChunk} wallets (0.0015 ETH each)`);
            }
            
            // Prepare transaction data
            const tx = {
                to: airdrop.address,
                data: airdrop.interface.encodeFunctionData("sendAirdropETH", [recipients]),
                value: chunkValue
            };
            
            // Get gas estimates with enhanced calculation
            const baseGasPrice = await provider.getGasPrice();
            const minGasPrice = ethers.utils.parseUnits("0.001", 9);
            const gasPrice = baseGasPrice.lt(minGasPrice) ? 
                minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
            
            let gasLimit;
            try {
                gasLimit = await provider.estimateGas({
                    ...tx,
                    from: signer.address
                });
                gasLimit = gasLimit.mul(120).div(100); // 20% buffer
            } catch (gasError) {
                log(`⚠️  Gas estimation failed for chunk ${chunkNumber}, using fallback`);
                gasLimit = ethers.BigNumber.from("500000").mul(recipientsInChunk); // 500k gas per recipient
            }
            
            // Calculate total gas cost
            const totalGasCost = gasPrice.mul(gasLimit);
            const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
            
            log(`   Gas details: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei, Limit: ${gasLimit.toString()}`);
            log(`   Gas cost: ${totalGasCostETH} ETH`);
            
            // Check gas cost against gasMax
            if (totalGasCost.gt(gasMaxWei)) {
                log(`❌ Chunk ${chunkNumber} gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
                log(`⚠️  Skipping chunk ${chunkNumber} due to high gas costs`);
                
                gasLimitExceeded++;
                totalFailed += recipientsInChunk;
                skippedChunks.push({
                    range: `${actualWalletStart}-${actualWalletEnd}`,
                    recipients: recipientsInChunk,
                    reason: 'gas_cost_exceeds_max',
                    gasCost: totalGasCostETH,
                    gasLimit: gasMaxETH
                });
                
                // Continue to next chunk
                if (end < wallets.length) {
                    log(`🔄 Waiting ${delayBetweenChunks}ms before next chunk...\n`);
                    await sleep(delayBetweenChunks);
                }
                continue;
            }
            
            log(`✅ Gas cost within limits, proceeding with airdrop...`);
            
            // Get nonce
            const nonce = await signer.getTransactionCount("pending");
            
            // Send transaction
            const transaction = await signer.sendTransaction({
                ...tx,
                gasLimit,
                gasPrice,
                nonce,
            });
            
            log(`📤 Chunk ${chunkNumber} transaction sent: ${transaction.hash}`);
            log(`⏳ Waiting for confirmation...`);
            
            // Wait for transaction confirmation
            const receipt = await transaction.wait();
            
            if (receipt.status === 1) {
                const actualGasCost = gasPrice.mul(receipt.gasUsed);
                const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
                const gasEfficiency = ((receipt.gasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1);
                
                log(`✅ Airdrop chunk ${chunkNumber} completed: ${receipt.transactionHash}`);
                log(`⛽ Gas used: ${receipt.gasUsed.toString()} (estimated: ${gasLimit.toString()})`);
                log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
                log(`📊 Gas efficiency: ${gasEfficiency}%`);
                log(`💸 ETH distributed: ${ethers.utils.formatEther(chunkValue)} ETH to ${recipientsInChunk} wallets`);
                
                totalSuccessful += recipientsInChunk;
                completedChunks.push({
                    range: `${actualWalletStart}-${actualWalletEnd}`,
                    txHash: receipt.transactionHash,
                    recipients: recipientsInChunk,
                    amount: ethers.utils.formatEther(chunkValue),
                    actualGasCost: actualGasCostETH,
                    gasEfficiency
                });
            } else {
                throw new Error(`Transaction failed: ${receipt.transactionHash}`);
            }
            
            // Wait between chunks (except for the last one)
            if (end < wallets.length) {
                log(`⏱️  Waiting ${delayBetweenChunks}ms before next chunk...\n`);
                await sleep(delayBetweenChunks);
            }
            
        } catch (err) {
            errorLog(`❌ Airdrop chunk ${chunkNumber} failed: ${err.message}`);
            totalFailed += recipientsInChunk;
            
            // Continue with next chunk even if this one fails
            if (end < wallets.length) {
                log(`🔄 Continuing with next chunk after ${delayBetweenChunks}ms delay...\n`);
                await sleep(delayBetweenChunks);
            }
        }
    }
    
    // Final summary
    const successRate = wallets.length > 0 ? ((totalSuccessful / wallets.length) * 100).toFixed(2) : '0.00';
    
    log(`\n🎯 Final Airdrop Summary:`);
    log(`📊 Results:`);
    log(`   • Wallet range processed: ${actualStartAt} to ${actualEndAt - 1}`);
    log(`   • Total wallets in range: ${wallets.length}`);
    log(`   • Successful airdrops: ${totalSuccessful} (${successRate}%)`);
    log(`   • Failed airdrops: ${totalFailed}`);
    log(`   • Gas limit exceeded: ${gasLimitExceeded} chunks`);
    log(`   • Completed chunks: ${completedChunks.length}/${totalChunks}`);
    log(`   • Skipped chunks: ${skippedChunks.length}/${totalChunks}`);
    
    if (totalEthAmount && totalSuccessful > 0) {
        const actualDistributed = (totalSuccessful / wallets.length) * totalEthAmount;
        log(`💰 ETH Distribution:`);
        log(`   • Planned: ${totalEthAmount} ETH`);
        log(`   • Actually distributed: ${actualDistributed.toFixed(6)} ETH`);
        log(`   • Distribution efficiency: ${((actualDistributed / totalEthAmount) * 100).toFixed(2)}%`);
    }
    
    // Log completed transaction hashes
    if (completedChunks.length > 0) {
        log(`\n🔗 Successful Transactions:`);
        completedChunks.forEach((chunk, index) => {
            log(`   ${index + 1}. Wallets ${chunk.range}: ${chunk.txHash}`);
            log(`      • Recipients: ${chunk.recipients} wallets`);
            log(`      • Amount: ${chunk.amount} ETH`);
            log(`      • Gas cost: ${chunk.actualGasCost} ETH (${chunk.gasEfficiency}% efficiency)`);
        });
    }
    
    // Log skipped chunks
    if (skippedChunks.length > 0) {
        log(`\n⚠️  Skipped Chunks (High Gas):`);
        skippedChunks.forEach((chunk, index) => {
            log(`   ${index + 1}. Wallets ${chunk.range}: ${chunk.recipients} wallets`);
            log(`      • Reason: Gas cost ${chunk.gasCost} ETH > limit ${chunk.gasLimit} ETH`);
        });
    }
    
    if (totalFailed > 0) {
        log(`\n⚠️  Warning: ${totalFailed} wallets did not receive airdrops due to failed/skipped transactions.`);
        if (gasLimitExceeded > 0) {
            log(`💡 Tip: Consider increasing gas max limit or waiting for lower gas prices to complete skipped chunks.`);
        }
    }
    
    const success = totalFailed === 0;
    log(`\n${success ? '✅' : '⚠️'} Airdrop batch ${success ? 'completed successfully' : 'completed with issues'} - Distributed to ${totalSuccessful}/${wallets.length} wallets in range ${actualStartAt}-${actualEndAt - 1}`);
    
    return {
        success,
        totalWallets: wallets.length,
        successfulWallets: totalSuccessful,
        failedWallets: totalFailed,
        gasLimitExceeded,
        successRate: parseFloat(successRate),
        completedChunks,
        skippedChunks,
        chunkSize,
        totalChunks,
        actualDistributed: totalEthAmount ? (totalSuccessful / wallets.length) * totalEthAmount : null,
        walletRange: {
            startAt: actualStartAt,
            endAt: actualEndAt - 1,
            processed: wallets.length
        }
    };
}

async function swapBatch(batchSize, tokenAddress, delayBetweenBatches, delayBetweenTx) {
    log(`Starting single token swap batch processing with statistics tracking:`);
    
    const wallets = loadWallets();
    if (wallets.length === 0) {
        throw new Error('No wallets found. Create wallets first.');
    }

    let successfulSwaps = 0;
    let failedSwaps = 0;
    let gasLimitExceeded = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    
    const totalBatches = Math.ceil(wallets.length / batchSize);
    log(`📊 Processing ${totalBatches} batches for ${wallets.length} wallets total\n`);

    for (let start = 0; start < wallets.length; start += batchSize) {
        const end = Math.min(start + batchSize, wallets.length);
        batchCount++;
        
        log(`🔄 Processing swap batch ${batchCount}/${totalBatches} (wallets ${start}-${end-1})`);
        
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            if (delayBetweenTx > 0 && i > start) {
                await sleep(delayBetweenTx);
            }
            
            batchPromises.push(
                executeSwap(i, wallets, tokenAddress) // This now includes stats tracking
                    .then(result => {
                        totalProcessed++;
                        if (result && result.success) {
                            successfulSwaps++;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                        } else if (result && result.reason === 'gas_cost_exceeds_max') {
                            gasLimitExceeded++;
                            log(`💰 Wallet ${i}: Skipped - Gas cost exceeds limit`);
                        } else {
                            failedSwaps++;
                            log(`❌ Wallet ${i}: Failed - ${result?.reason || 'unknown'}`);
                        }
                        return result;
                    })
                    .catch(error => {
                        totalProcessed++;
                        failedSwaps++;
                        log(`💥 Wallet ${i}: Exception - ${error.message}`);
                        return { success: false, reason: 'exception', error: error.message };
                    })
            );
        }

        await Promise.all(batchPromises);
        
        if (end < wallets.length) {
            log(`⏱️  Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await sleep(delayBetweenBatches);
        }
    }
    
    // Track the batch operation summary
    const batchResults = {
        totalProcessed,
        successfulSwaps,
        failedSwaps,
        gasLimitExceeded,
        successRate: parseFloat(((successfulSwaps / totalProcessed) * 100).toFixed(2)),
        batchesProcessed: batchCount,
        tokenAddress,
        totalWallets: wallets.length
    };
    
    // Track batch summary
    await trackBatchOperation("V2_swaps", batchResults);
    
    log(`\n🎯 Single Token Swap Batch Processing Complete!`);
    log(`📊 Final Results: ${successfulSwaps}/${totalProcessed} successful (${batchResults.successRate}%)`);
    
    return batchResults;
}

async function multiSwapBatch(batchSize = config.defaultBatchSize, tokens = defaultTokens["v2"], delayBetweenBatches = 2000, delayBetweenTx = 100) {
    log(`Starting multi-token swap batch processing with enhanced controls:`);
    log(`• Batch size: ${batchSize}`);
    log(`• Delay between batches: ${delayBetweenBatches}ms`);
    log(`• Delay between transactions: ${delayBetweenTx}ms`);
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    log(`• Gas max limit: ${gasMaxETH} ETH`);

    const wallets = loadWallets();
    if (wallets.length === 0) {
        throw new Error('No wallets found. Create wallets first.');
    }

    const tokensToUse = tokens || defaultTokens["V2"];
    log(`• Using ${tokensToUse.length} tokens: ${tokensToUse.slice(0, 3).join(', ')}${tokensToUse.length > 3 ? '...' : ''}`);

    let successfulSwaps = 0;
    let failedSwaps = 0;
    let gasLimitExceeded = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    
    // Calculate total batches for progress tracking
    const totalBatches = Math.ceil(wallets.length / batchSize);
    log(`📊 Processing ${totalBatches} batches for ${wallets.length} wallets total\n`);

    for (let start = 0; start < wallets.length; start += batchSize) {
        const end = Math.min(start + batchSize, wallets.length);
        batchCount++;
        
        log(`🔄 Processing multi-swap batch ${batchCount}/${totalBatches} (wallets ${start}-${end-1})`);
        
        // Track batch-specific results
        let batchSuccessful = 0;
        let batchFailed = 0;
        let batchGasExceeded = 0;
        
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            // Add delay between transactions within batch if specified
            if (delayBetweenTx > 0 && i > start) {
                await sleep(delayBetweenTx);
            }
            
            batchPromises.push(
                executeMultiSwapWithGasCheck(i, wallets, tokensToUse, gasMaxWei, gasMaxETH)
                    .then(result => {
                        totalProcessed++;
                        if (result && result.success) {
                            successfulSwaps++;
                            batchSuccessful++;
                            log(`✅ Wallet ${i}: Success - ${result.tokensSwapped || tokensToUse.length} tokens swapped`);
                            if (result.txHash) {
                                log(`   TX: ${result.txHash}`);
                            }
                            if (result.gasEfficiency) {
                                log(`   Gas efficiency: ${result.gasEfficiency}%`);
                            }
                        } else if (result && result.reason === 'gas_cost_exceeds_max') {
                            gasLimitExceeded++;
                            batchGasExceeded++;
                            log(`💰 Wallet ${i}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                        } else {
                            failedSwaps++;
                            batchFailed++;
                            const reason = result?.reason || 'unknown';
                            log(`❌ Wallet ${i}: Failed - ${reason}`);
                            if (result?.error) {
                                log(`   Error: ${result.error.substring(0, 100)}`);
                            }
                        }
                        return result;
                    })
                    .catch(error => {
                        totalProcessed++;
                        failedSwaps++;
                        batchFailed++;
                        log(`💥 Wallet ${i}: Exception - ${error.message}`);
                        return { success: false, reason: 'exception', error: error.message };
                    })
            );
        }

        // Wait for all transactions in current batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Calculate batch success rate
        const batchTotal = batchResults.length;
        const batchSuccessRate = batchTotal > 0 ? ((batchSuccessful / batchTotal) * 100).toFixed(1) : '0.0';
        
        log(`📈 Batch ${batchCount} completed:`);
        log(`   • Successful: ${batchSuccessful}/${batchTotal} (${batchSuccessRate}%)`);
        log(`   • Failed: ${batchFailed}`);
        log(`   • Gas exceeded: ${batchGasExceeded}`);
        
        // Overall progress
        const overallProcessed = totalProcessed;
        const overallSuccessRate = overallProcessed > 0 ? ((successfulSwaps / overallProcessed) * 100).toFixed(1) : '0.0';
        log(`📊 Overall progress: ${overallProcessed}/${wallets.length} (${overallSuccessRate}% success rate)`);

        // Delay between batches (except for the last batch)
        if (end < wallets.length) {
            log(`⏱️  Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await sleep(delayBetweenBatches);
        }
    }
    
    // Final summary
    const finalSuccessRate = totalProcessed > 0 ? ((successfulSwaps / totalProcessed) * 100).toFixed(2) : '0.00';
    
    log(`\n🎯 Multi-Swap Batch Processing Complete!`);
    log(`📊 Final Results:`);
    log(`   • Total wallets processed: ${totalProcessed}/${wallets.length}`);
    log(`   • Successful swaps: ${successfulSwaps}`);
    log(`   • Failed swaps: ${failedSwaps}`);
    log(`   • Gas limit exceeded: ${gasLimitExceeded}`);
    log(`   • Success rate: ${finalSuccessRate}%`);
    log(`   • Batches processed: ${batchCount}`);
    log(`   • Tokens per wallet: ${tokensToUse.length}`);
    
    // Return detailed results
    return {
        totalProcessed,
        successfulSwaps,
        failedSwaps,
        gasLimitExceeded,
        successRate: parseFloat(finalSuccessRate),
        batchesProcessed: batchCount,
        tokensPerWallet: tokensToUse.length,
        totalWallets: wallets.length
    };
}

async function v3SwapBatch(batchSize = config.defaultBatchSize, tokenAddress, startAt, endsAt, delayBetweenBatches = 2000, delayBetweenTx = 100) {
    log(`Starting V3 swap batch processing with enhanced controls:`);
    log(`• Batch size: ${batchSize}`);
    log(`• Token address: ${tokenAddress}`);
    log(`• Wallet range: ${startAt} to ${endsAt}`);
    log(`• Delay between batches: ${delayBetweenBatches}ms`);
    log(`• Delay between transactions: ${delayBetweenTx}ms`);
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    log(`• Gas max limit: ${gasMaxETH} ETH`);

    const wallets = loadWallets();
    if (wallets.length === 0) {
        throw new Error('No wallets found. Create wallets first.');
    }

    // Validate range
    const actualEnd = Math.min(endsAt, wallets.length);
    if (startAt >= actualEnd) {
        throw new Error(`Invalid range: startAt (${startAt}) must be less than endsAt (${actualEnd})`);
    }

    let successfulSwaps = 0;
    let failedSwaps = 0;
    let gasLimitExceeded = 0;
    let totalProcessed = 0;
    let batchCount = 0;
    
    // Calculate total batches for progress tracking
    const totalBatches = Math.ceil((actualEnd - startAt) / batchSize);
    log(`📊 Processing ${totalBatches} batches for ${actualEnd - startAt} wallets total\n`);
    
    for (let start = startAt; start < actualEnd; start += batchSize) {
        const end = Math.min(start + batchSize, actualEnd);
        batchCount++;
        
        log(`🔄 Processing V3 swap batch ${batchCount}/${totalBatches} (wallets ${start}-${end-1})`);
        
        // Track batch-specific results
        let batchSuccessful = 0;
        let batchFailed = 0;
        let batchGasExceeded = 0;
        
        const batchPromises = [];
        
        for (let i = start; i < end; i++) {
            // Add delay between transactions within batch if specified
            if (delayBetweenTx > 0 && i > start) {
                await sleep(delayBetweenTx);
            }
            
            batchPromises.push(
                executeV3Swap(i, wallets, tokenAddress, gasMaxWei, gasMaxETH)
                    .then((result) => {
                        totalProcessed++;
                        if (result.success) {
                            successfulSwaps++;
                            batchSuccessful++;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                            if (result.gasEfficiency) {
                                log(`   Gas efficiency: ${result.gasEfficiency}%`);
                            }
                        } else if (result.reason === 'gas_cost_exceeds_max') {
                            gasLimitExceeded++;
                            batchGasExceeded++;
                            log(`💰 Wallet ${i}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                        } else {
                            failedSwaps++;
                            batchFailed++;
                            log(`❌ Wallet ${i}: Failed - ${result.reason || 'unknown'}`);
                        }
                        return result;
                    })
                    .catch((error) => {
                        totalProcessed++;
                        failedSwaps++;
                        batchFailed++;
                        log(`💥 Wallet ${i}: Error - ${error.message}`);
                        return { success: false, reason: 'exception', error: error.message };
                    })
            );
        }
        
        // Wait for all transactions in current batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Calculate batch success rate
        const batchTotal = batchResults.length;
        const batchSuccessRate = batchTotal > 0 ? ((batchSuccessful / batchTotal) * 100).toFixed(1) : '0.0';
        
        log(`📈 Batch ${batchCount} completed:`);
        log(`   • Successful: ${batchSuccessful}/${batchTotal} (${batchSuccessRate}%)`);
        log(`   • Failed: ${batchFailed}`);
        log(`   • Gas exceeded: ${batchGasExceeded}`);
        
        // Overall progress
        const overallProcessed = totalProcessed;
        const overallSuccessRate = overallProcessed > 0 ? ((successfulSwaps / overallProcessed) * 100).toFixed(1) : '0.0';
        log(`📊 Overall progress: ${overallProcessed}/${actualEnd - startAt} (${overallSuccessRate}% success rate)`);
        
        // Delay between batches (except for the last batch)
        if (end < actualEnd) {
            log(`⏱️  Waiting ${delayBetweenBatches}ms before next batch...\n`);
            await sleep(delayBetweenBatches);
        }
    }
    
    // Final summary
    const totalWallets = actualEnd - startAt;
    const finalSuccessRate = totalProcessed > 0 ? ((successfulSwaps / totalProcessed) * 100).toFixed(2) : '0.00';
    
    log(`\n🎯 V3 Swap Batch Processing Complete!`);
    log(`📊 Final Results:`);
    log(`   • Total wallets processed: ${totalProcessed}/${totalWallets}`);
    log(`   • Successful swaps: ${successfulSwaps}`);
    log(`   • Failed swaps: ${failedSwaps}`);
    log(`   • Gas limit exceeded: ${gasLimitExceeded}`);
    log(`   • Success rate: ${finalSuccessRate}%`);
    log(`   • Batches processed: ${batchCount}`);
    
    // Return detailed results
    return {
        totalProcessed,
        successfulSwaps,
        failedSwaps,
        gasLimitExceeded,
        successRate: parseFloat(finalSuccessRate),
        batchesProcessed: batchCount,
        walletsInRange: totalWallets
    };
}

async function createWalletAndMultiSmall(multiTokens, cycleDelay = 2000, fundingAmount = "0.00001") {
    let connectedNewWallet = null;
    let mainSigner = null;
    const newWallet = ethers.Wallet.createRandom();
    var pk = config.fundingPrivateKey

    console.log(`Starting createWalletAndMultiSmall cycle...`);
    console.log(`Funding amount: ${fundingAmount} ETH`);
    console.log(`Cycle delay: ${cycleDelay}ms`);

    try {
        mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        connectedNewWallet = newWallet.connect(provider);
        
        console.log("Main wallet:", mainSigner.address);
        console.log(`Created new wallet: ${newWallet.address} ${newWallet.privateKey}`);

        savePrivateKey([
            newWallet.address,
            newWallet.privateKey
        ]);
        
        // Step 1: Check main signer balance first
        const fundingAmountWei = ethers.utils.parseUnits(fundingAmount, 18);
        const mainBalance = await provider.getBalance(mainSigner.address);
        if (mainBalance.lt(fundingAmountWei)) {
            throw new Error(`Insufficient balance in main wallet. Need ${fundingAmount} ETH, have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        // Step 2: ANALYZE SWAP TRANSACTION FIRST (most expensive operation)
        console.log(`\n🔍 === ANALYZING SWAP TRANSACTION FIRST ===`);
        
        // Prepare swap parameters without funding the wallet yet
        const tokensToSwap = multiTokens || defaultTokens["V2"];
        const numberOfTokens = tokensToSwap.length;
        console.log(`Number of tokens to analyze for swap: ${numberOfTokens}`);
        
        // Use minimal amounts for analysis
        const amountPerToken = ethers.BigNumber.from("10"); // 10 wei per token
        const totalSwapAmount = amountPerToken.mul(numberOfTokens);
        
        console.log(`Analyzing swap for ${totalSwapAmount.toString()} wei total (${ethers.utils.formatUnits(totalSwapAmount, 18)} ETH)`);
        
        // Create swap details for analysis
        const swapDetails = tokensToSwap.map(tokenAddress => ({
            tokenAddress: tokenAddress,
            ethAmount: amountPerToken,
            recipient: connectedNewWallet.address, // Use the new wallet address (even though it's not funded yet)
            router: contracts.uniswapRouter,
            minAmountOut: 0
        }));

        // Create contract interface for analysis (don't need to fund wallet yet)
        const multicallInterface = new ethers.utils.Interface(multicallAbi);
        
        // CREATE THE ACTUAL SWAP TRANSACTION OBJECT FOR ANALYSIS
        const swapTransaction = {
            to: "0x0D99F3072fDbEDFFFf920f166F3B5d7e2bE32Ba0",
            data: multicallInterface.encodeFunctionData("executeMultiSwap", [swapDetails]),
            value: totalSwapAmount
        };
        
        console.log(`Pre-analyzing multi-swap transaction for ${numberOfTokens} tokens...`);
        
        const swapGasAnalysis = await analyzeTransactionGas(
            swapTransaction,
            mainSigner, // This will check gas estimation (wallet doesn't need balance for gas estimation)
            'V2_MULTISWAP',
            1.2
        );
        
        // CHECK SWAP VIABILITY BEFORE FUNDING
        if (swapGasAnalysis.recommendation === 'ABORT_HIGH_GAS') {
            console.log(`❌ Swap transaction would be too expensive: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
            console.log(`⚠️  Aborting entire cycle - no funding needed`);
            console.log(`⏱️  Waiting ${swapGasAnalysis.timing.suggestedRetryTime}ms before retry...`);
            await sleep(swapGasAnalysis.timing.suggestedRetryTime);
            return createWalletAndMultiSmall(multiTokens, cycleDelay, fundingAmount);
        }
        
        console.log(`✅ Swap analysis passed - estimated cost: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`📊 Swap gas recommendation: ${swapGasAnalysis.recommendation}`);
        
        // Step 3: ANALYZE FUNDING TRANSACTION (only after swap passes)
        console.log(`\n🔍 === ANALYZING FUNDING TRANSACTION ===`);
        
        const fundingTransaction = {
            to: newWallet.address,
            value: fundingAmountWei
        };
        
        const fundingGasAnalysis = await analyzeTransactionGas(
            fundingTransaction,
            mainSigner,
            'V2_FUNDING',
            1.2
        );
        
        if (fundingGasAnalysis.recommendation === 'ABORT_HIGH_GAS' || 
            fundingGasAnalysis.recommendation === 'ABORT_INSUFFICIENT_BALANCE') {
            console.log(`❌ Funding transaction aborted: ${fundingGasAnalysis.recommendation}`);
            console.log(`⏱️  Waiting ${fundingGasAnalysis.timing.suggestedRetryTime}ms before retry...`);
            await sleep(fundingGasAnalysis.timing.suggestedRetryTime);
            return createWalletAndMultiSmall(multiTokens, cycleDelay, fundingAmount);
        }
        
        console.log(`✅ Funding analysis passed - estimated cost: ${fundingGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);

        // Step 4: Apply any recommended wait times from both analyses
        const maxWaitTime = Math.max(
            fundingGasAnalysis.timing.waitTime || 0,
            swapGasAnalysis.timing.waitTime || 0
        );
        
        if (maxWaitTime > 0) {
            console.log(`⏱️  Gas conditions require ${maxWaitTime}ms pause before proceeding...`);
            await sleep(maxWaitTime);
        }
        
        console.log(`\n📊 === PRE-FLIGHT SUMMARY ===`);
        console.log(`💰 Total estimated costs:`);
        console.log(`   • Funding: ${fundingGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`   • Swap: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`   • Total gas: ${(parseFloat(fundingGasAnalysis.gasDetails.estimatedGasCostETH) + parseFloat(swapGasAnalysis.gasDetails.estimatedGasCostETH)).toFixed(8)} ETH`);
        console.log(`✅ Both operations approved - proceeding with funding...`);
        
        // Step 5: Execute funding with analyzed gas parameters (only after both checks pass)
        let fundingNonce;
        try {
            if (typeof getNonce === 'function') {
                fundingNonce = await getNonce(mainSigner, { provider });
            } else {
                fundingNonce = await mainSigner.getTransactionCount("pending");
            }
        } catch (nonceError) {
            fundingNonce = await mainSigner.getTransactionCount("pending");
        }
        
        console.log(`\n💸 === EXECUTING FUNDING ===`);
        const fundingTransactionSent = await mainSigner.sendTransaction({
            ...fundingTransaction,
            gasLimit: fundingGasAnalysis.gasDetails.bufferedGasLimit,
            gasPrice: fundingGasAnalysis.gasDetails.adjustedGasPrice,
            nonce: fundingNonce
        });
        
        console.log(`Funding transaction sent: ${fundingTransactionSent.hash}`);
        const fundingReceipt = await fundingTransactionSent.wait();
        
        // Log actual funding results vs analysis
        const actualFundingGasCost = fundingGasAnalysis.gasDetails.adjustedGasPrice.mul(fundingReceipt.gasUsed);
        const actualFundingGasCostETH = ethers.utils.formatUnits(actualFundingGasCost, 18);
        const fundingGasEfficiency = ((fundingReceipt.gasUsed.toNumber() / fundingGasAnalysis.gasDetails.bufferedGasLimit.toNumber()) * 100).toFixed(1);
        
        console.log(`✅ Funding successful - Actual gas cost: ${actualFundingGasCostETH} ETH`);
        console.log(`📊 Funding efficiency: ${fundingGasEfficiency}% (used ${fundingReceipt.gasUsed.toString()} of ${fundingGasAnalysis.gasDetails.bufferedGasLimit.toString()})`);
        
        // Step 6: Wait for balance to update and verify
        let currentBalance = await provider.getBalance(connectedNewWallet.address);
        console.log(`New wallet balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);

        await new Promise(async (resolve, reject) => {
            let indexETH = 0;
            try {
                while(currentBalance.eq(0) && indexETH < 100){
                    console.log('Waiting for ETH balance to update...');
                    await sleep(1000);
                    currentBalance = await provider.getBalance(connectedNewWallet.address);
                    indexETH++;
                }
                
                if(currentBalance.gt(0)){
                    console.log('Balance loaded, proceeding with pre-analyzed swap...');
                    resolve();
                } else {
                    reject(new Error("Balance never updated"));
                }
            } catch(err) {
                console.warn('Error', err?.message);
                await sendETHBack(connectedNewWallet.privateKey, mainSigner.address);
                reject(err);
            }
        });

        // Step 7: Execute swap with pre-analyzed gas parameters
        console.log(`\n🔄 === EXECUTING PRE-ANALYZED SWAP ===`);
        
        // Create the actual contract instance now that wallet is funded
        const multicallContract = new ethers.Contract("0x0D99F3072fDbEDFFFf920f166F3B5d7e2bE32Ba0", multicallAbi, connectedNewWallet);
        
        console.log(`Executing multi-swap with pre-analyzed parameters:`);
        console.log(`   • Gas limit: ${swapGasAnalysis.gasDetails.bufferedGasLimit.toString()}`);
        console.log(`   • Gas price: ${ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice, 9)} Gwei`);
        console.log(`   • Estimated cost: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        
        const swapNonce = await connectedNewWallet.getTransactionCount("pending");
        
        const swapTransactionSent = await multicallContract.executeMultiSwap(swapDetails, {
            value: totalSwapAmount,
            gasLimit: swapGasAnalysis.gasDetails.bufferedGasLimit,
            gasPrice: swapGasAnalysis.gasDetails.adjustedGasPrice,
            nonce: swapNonce
        });
        
        console.log(`Swap transaction sent: ${swapTransactionSent.hash}`);
        
        // Wait for the swap transaction to be mined
        const swapReceipt = await swapTransactionSent.wait();
        let swapGasEfficiency
        let swapSuccess = false;
        if (swapReceipt && swapReceipt.status === 1) {
            const actualSwapGasCost = swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed);
            const actualSwapGasCostETH = ethers.utils.formatUnits(actualSwapGasCost, 18);
            swapGasEfficiency = ((swapReceipt.gasUsed.toNumber() / swapGasAnalysis.gasDetails.bufferedGasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ Multi-swap successful: ${swapReceipt.transactionHash}`);
            console.log(`⛽ Gas used: ${swapReceipt.gasUsed.toString()} (estimated: ${swapGasAnalysis.gasDetails.bufferedGasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualSwapGasCostETH} ETH (estimated: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${swapGasEfficiency}%`);
            console.log(`🎯 Swapped ${numberOfTokens} tokens successfully`);
            swapSuccess = true;
        } else {
            console.log(`❌ Multi-swap failed: ${swapReceipt?.transactionHash || swapTransactionSent.hash}`);
        }
        
        // Step 8: Send remaining ETH back to main wallet
        console.log(`\n💸 === ETH RECOVERY ===`);
        console.log(`Transferring remaining ETH back to main wallet...`);
        
        // Wait for balance to update
        await sleep(1000);
        
        // Send ETH back to main wallet
        await sendETHBack(newWallet.privateKey, mainSigner.address, fundingAmountWei);
        
        // Final balances and summary
        const finalMainBalance = await provider.getBalance(mainSigner.address);
        const finalNewWalletBalance = await provider.getBalance(connectedNewWallet.address);
        
        console.log(`\n📊 === CYCLE SUMMARY ===`);
        console.log(`Final main wallet balance: ${ethers.utils.formatUnits(finalMainBalance, 18)} ETH`);
        console.log(`Final new wallet balance: ${ethers.utils.formatUnits(finalNewWalletBalance, 18)} ETH`);
        
        const totalActualGasCost = parseFloat(actualFundingGasCostETH) + (swapSuccess ? parseFloat(ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18)) : 0);
        console.log(`💰 Total actual gas cost: ${totalActualGasCost.toFixed(8)} ETH`);
        
        const result = {
            success: swapSuccess,
            swapType: 'V2',
            newWalletAddress: newWallet.address,
            newWalletPrivateKey: newWallet.privateKey,
            swapTxHash: swapReceipt?.transactionHash || swapTransactionSent.hash,
            fundingTxHash: fundingTransactionSent.hash,
            actualFundingGasCost: actualFundingGasCostETH,
            actualSwapGasCost: swapSuccess ? ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18) : '0',
            tokensSwapped: numberOfTokens,
            totalGasCost: totalActualGasCost.toFixed(8),
            gasAnalysis: {
                fundingAnalysis: {
                    estimated: fundingGasAnalysis.gasDetails.estimatedGasCostETH,
                    actual: actualFundingGasCostETH,
                    efficiency: fundingGasEfficiency
                },
                swapAnalysis: {
                    estimated: swapGasAnalysis.gasDetails.estimatedGasCostETH,
                    actual: swapSuccess ? ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18) : '0',
                    efficiency: swapSuccess ? swapGasEfficiency : '0'
                }
            }
        };
        
        console.log('V2 Result:', result);
        
        // Use gas-aware delay for next cycle
        console.log(`\n⏱️  Calculating gas-aware delay for next cycle...`);
        console.log(`🔄 V2 Cycle completed. Starting next cycle in ${cycleDelay}ms...`);
        
        // Gas-aware delay before next cycle
        await sleep(cycleDelay);
        
        // Recursively call the function to continue the loop
        return createWalletAndMultiSmall(multiTokens, cycleDelay, fundingAmount);
        
    } catch (err) {
        console.error(`Error in createWalletAndMultiSmall:`, err.message);
        console.log(`🔄 V2 Error occurred. Attempting to recover ETH...`);
        
        // Try to send ETH back to main wallet even if there was an error
        if (provider && mainSigner && newWallet) {
            try {
                await sendETHBack(newWallet.privateKey, mainSigner.address);
                console.log(`✅ ETH successfully recovered after V2 error`);
            } catch (recoveryError) {
                console.error(`❌ Failed to recover ETH after V2 error:`, recoveryError.message);
            }
        }
        
        // Use gas-aware delay for retry after error
        console.log(`🔄 Retrying V2 in ${cycleDelay}ms...`);
        
        // Wait before retrying with gas-adjusted delay
        await sleep(cycleDelay);
        
        // Continue the loop even if there was an error
        return createWalletAndMultiSmall(multiTokens, cycleDelay, fundingAmount);
    }
}

async function createWalletAndMultiSmallV3(multiTokens, cycleDelay = 2000, fundingAmount = "0.00001") {
    let connectedNewWallet = null;
    let mainSigner = null;
    const newWallet = ethers.Wallet.createRandom();
    var pk = config.fundingPrivateKey

    console.log(`Starting createWalletAndMultiSmallV3 cycle...`);
    console.log(`Funding amount: ${fundingAmount} ETH`);
    console.log(`Cycle delay: ${cycleDelay}ms`);
    console.log(`Using V3 swaps only`);

    try {
        mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        connectedNewWallet = newWallet.connect(provider);
        
        console.log("Main wallet:", mainSigner.address);
        console.log(`Created new V3 wallet: ${newWallet.address} ${newWallet.privateKey}`);

        savePrivateKey([
            newWallet.address,
            newWallet.privateKey
        ]);
        
        // Step 1: Check main signer balance first
        const fundingAmountWei = ethers.utils.parseUnits(fundingAmount, 18);
        const mainBalance = await provider.getBalance(mainSigner.address);
        if (mainBalance.lt(fundingAmountWei)) {
            throw new Error(`Insufficient balance in main wallet. Need ${fundingAmount} ETH, have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        // Step 2: ANALYZE V3 SWAP TRANSACTION FIRST (most expensive operation)
        console.log(`\n🔍 === ANALYZING V3 SWAP TRANSACTION FIRST ===`);
        
        // Prepare V3 swap parameters without funding the wallet yet
        const tokensToSwap = multiTokens || defaultTokens["V3"] || [
            "0x2Dc1C8BE620b95cBA25D78774F716F05B159C8B9", //BONK
        ];
        const numberOfTokens = tokensToSwap.length;
        console.log(`Number of V3 tokens to analyze for swap: ${numberOfTokens}`);
        
        // Use minimal amounts for analysis
        const amountPerToken = ethers.BigNumber.from("10"); // 10 wei per token
        const totalSwapAmount = amountPerToken.mul(numberOfTokens);
        
        // V3 fee tiers (in basis points: 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
        const defaultV3Fee = config.defaultV3Fee || 10000; // 1% fee tier as default
        const v3Fee = Array.isArray(defaultV3Fee) ? defaultV3Fee[0] : defaultV3Fee;
        
        console.log(`Analyzing V3 swap for ${totalSwapAmount.toString()} wei total (${ethers.utils.formatUnits(totalSwapAmount, 18)} ETH)`);
        console.log(`V3 Fee tier: ${v3Fee} (${(v3Fee / 10000)}%)`);
        
        // Create V3 swap details for analysis
        const swapDetails = tokensToSwap.map(tokenAddress => ({
            tokenAddress: tokenAddress,    // address tokenAddress
            ethAmount: amountPerToken,     // uint256 ethAmount  
            recipient: connectedNewWallet.address, // address recipient (even though not funded yet)
            fee: v3Fee,                    // uint24 fee (V3 fee tier)
            minAmountOut: 0                // uint256 minAmountOut (no slippage protection)
        }));

        // Create contract interface for analysis (don't need to fund wallet yet)
        const multicallV3Interface = new ethers.utils.Interface(multicallAbi);
        
        // CREATE THE ACTUAL V3 SWAP TRANSACTION OBJECT FOR ANALYSIS
        const swapTransaction = {
            to: contracts.multicallSwapV3,
            data: multicallV3Interface.encodeFunctionData("executeMultiSwapV3", [swapDetails]),
            value: totalSwapAmount
        };
        
        console.log(`Pre-analyzing V3 multi-swap transaction for ${numberOfTokens} tokens...`);
        console.log(`V3 Contract: ${contracts.multicallSwapV3}`);
        
        const swapGasAnalysis = await analyzeTransactionGas(
            swapTransaction,
            mainSigner, // This will check gas estimation (wallet doesn't need balance for gas estimation)
            'V3_MULTISWAP',
            1.2
        );
        
        // CHECK V3 SWAP VIABILITY BEFORE FUNDING
        if (swapGasAnalysis.recommendation === 'ABORT_HIGH_GAS') {
            console.log(`❌ V3 Swap transaction would be too expensive: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
            console.log(`⚠️  Aborting entire V3 cycle - no funding needed`);
            console.log(`⏱️  Waiting ${swapGasAnalysis.timing.suggestedRetryTime}ms before retry...`);
            await sleep(swapGasAnalysis.timing.suggestedRetryTime);
            return createWalletAndMultiSmallV3(multiTokens, cycleDelay, fundingAmount);
        }
        
        console.log(`✅ V3 Swap analysis passed - estimated cost: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`📊 V3 Swap gas recommendation: ${swapGasAnalysis.recommendation}`);
        
        // Step 3: ANALYZE FUNDING TRANSACTION (only after V3 swap passes)
        console.log(`\n🔍 === ANALYZING FUNDING TRANSACTION ===`);
        
        const fundingTransaction = {
            to: newWallet.address,
            value: fundingAmountWei
        };
        
        const fundingGasAnalysis = await analyzeTransactionGas(
            fundingTransaction,
            mainSigner,
            'V3_FUNDING',
            1.2
        );
        
        if (fundingGasAnalysis.recommendation === 'ABORT_HIGH_GAS' || 
            fundingGasAnalysis.recommendation === 'ABORT_INSUFFICIENT_BALANCE') {
            console.log(`❌ V3 Funding transaction aborted: ${fundingGasAnalysis.recommendation}`);
            console.log(`⏱️  Waiting ${fundingGasAnalysis.timing.suggestedRetryTime}ms before retry...`);
            await sleep(fundingGasAnalysis.timing.suggestedRetryTime);
            return createWalletAndMultiSmallV3(multiTokens, cycleDelay, fundingAmount);
        }
        
        console.log(`✅ V3 Funding analysis passed - estimated cost: ${fundingGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);

        // Step 4: Apply any recommended wait times from both analyses
        const maxWaitTime = Math.max(
            fundingGasAnalysis.timing.waitTime || 0,
            swapGasAnalysis.timing.waitTime || 0
        );
        
        if (maxWaitTime > 0) {
            console.log(`⏱️  Gas conditions require ${maxWaitTime}ms pause before proceeding...`);
            await sleep(maxWaitTime);
        }
        
        console.log(`\n📊 === V3 PRE-FLIGHT SUMMARY ===`);
        console.log(`💰 Total estimated costs:`);
        console.log(`   • Funding: ${fundingGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`   • V3 Swap: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`   • Total gas: ${(parseFloat(fundingGasAnalysis.gasDetails.estimatedGasCostETH) + parseFloat(swapGasAnalysis.gasDetails.estimatedGasCostETH)).toFixed(8)} ETH`);
        console.log(`✅ Both V3 operations approved - proceeding with funding...`);
        
        // Step 5: Execute funding with analyzed gas parameters (only after both checks pass)
        let fundingNonce;
        try {
            if (typeof getNonce === 'function') {
                fundingNonce = await getNonce(mainSigner, { provider });
            } else {
                fundingNonce = await mainSigner.getTransactionCount("pending");
            }
        } catch (nonceError) {
            fundingNonce = await mainSigner.getTransactionCount("pending");
        }
        
        console.log(`\n💸 === EXECUTING V3 FUNDING ===`);
        const fundingTransactionSent = await mainSigner.sendTransaction({
            ...fundingTransaction,
            gasLimit: fundingGasAnalysis.gasDetails.bufferedGasLimit,
            gasPrice: fundingGasAnalysis.gasDetails.adjustedGasPrice,
            nonce: fundingNonce
        });
        
        console.log(`V3 Funding transaction sent: ${fundingTransactionSent.hash}`);
        const fundingReceipt = await fundingTransactionSent.wait();
        
        // Log actual funding results vs analysis
        const actualFundingGasCost = fundingGasAnalysis.gasDetails.adjustedGasPrice.mul(fundingReceipt.gasUsed);
        const actualFundingGasCostETH = ethers.utils.formatUnits(actualFundingGasCost, 18);
        const fundingGasEfficiency = ((fundingReceipt.gasUsed.toNumber() / fundingGasAnalysis.gasDetails.bufferedGasLimit.toNumber()) * 100).toFixed(1);
        
        console.log(`✅ V3 Funding successful - Actual gas cost: ${actualFundingGasCostETH} ETH`);
        console.log(`📊 V3 Funding efficiency: ${fundingGasEfficiency}% (used ${fundingReceipt.gasUsed.toString()} of ${fundingGasAnalysis.gasDetails.bufferedGasLimit.toString()})`);
        
        // Step 6: Wait for balance to update and verify
        let currentBalance = await provider.getBalance(connectedNewWallet.address);
        console.log(`New V3 wallet balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);

        await new Promise(async (resolve, reject) => {
            let indexETH = 0;
            try {
                while(currentBalance.eq(0) && indexETH < 100){
                    console.log('Waiting for V3 ETH balance to update...');
                    await sleep(1000);
                    currentBalance = await provider.getBalance(connectedNewWallet.address);
                    indexETH++;
                }
                
                if(currentBalance.gt(0)){
                    console.log('V3 Balance loaded, proceeding with pre-analyzed swap...');
                    resolve();
                } else {
                    reject(new Error("V3 Balance never updated"));
                }
            } catch(err) {
                console.warn('V3 Error', err?.message);
                await sendETHBack(connectedNewWallet.privateKey, mainSigner.address);
                reject(err);
            }
        });

        // Step 7: Execute V3 swap with pre-analyzed gas parameters
        console.log(`\n🔄 === EXECUTING PRE-ANALYZED V3 SWAP ===`);
        
        // Create the actual V3 contract instance now that wallet is funded
        const multicallV3Contract = new ethers.Contract(contracts.multicallSwapV3, multicallAbi, connectedNewWallet);
        
        console.log(`Executing V3 multi-swap with pre-analyzed parameters:`);
        console.log(`   • Gas limit: ${swapGasAnalysis.gasDetails.bufferedGasLimit.toString()}`);
        console.log(`   • Gas price: ${ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice, 9)} Gwei`);
        console.log(`   • Estimated cost: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH`);
        console.log(`   • V3 Fee tier: ${v3Fee} basis points`);
        
        console.log(`Available for V3 swap: ${ethers.utils.formatUnits(currentBalance.sub(swapGasAnalysis.gasDetails.estimatedGasCost), 18)} ETH`);
        console.log(`Amount per V3 token: ${amountPerToken.toString()} wei (${ethers.utils.formatUnits(amountPerToken, 18)} ETH)`);
        console.log(`Total V3 swap amount: ${totalSwapAmount.toString()} wei (${ethers.utils.formatUnits(totalSwapAmount, 18)} ETH)`);
        
        const swapNonce = await connectedNewWallet.getTransactionCount("pending");
        
        // Execute the V3 multi-swap transaction with pre-analyzed parameters
        const swapTransactionSent = await multicallV3Contract.executeMultiSwapV3(swapDetails, {
            value: totalSwapAmount,
            gasLimit: swapGasAnalysis.gasDetails.bufferedGasLimit,
            gasPrice: swapGasAnalysis.gasDetails.adjustedGasPrice,
            nonce: swapNonce
        });
        
        console.log(`V3 Swap transaction sent: ${swapTransactionSent.hash}`);
        
        // Wait for the V3 swap transaction to be mined
        const swapReceipt = await swapTransactionSent.wait();
        let swapGasEfficiency;
        let swapSuccess = false;
        
        if (swapReceipt && swapReceipt.status === 1) {
            const actualSwapGasCost = swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed);
            const actualSwapGasCostETH = ethers.utils.formatUnits(actualSwapGasCost, 18);
            swapGasEfficiency = ((swapReceipt.gasUsed.toNumber() / swapGasAnalysis.gasDetails.bufferedGasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ V3 Multi-swap successful: ${swapReceipt.transactionHash}`);
            console.log(`⛽ Gas used: ${swapReceipt.gasUsed.toString()} (estimated: ${swapGasAnalysis.gasDetails.bufferedGasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualSwapGasCostETH} ETH (estimated: ${swapGasAnalysis.gasDetails.estimatedGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${swapGasEfficiency}%`);
            console.log(`🎯 Swapped ${numberOfTokens} V3 tokens successfully`);
            console.log(`💎 V3 Fee tier used: ${v3Fee} basis points`);
            swapSuccess = true;
        } else {
            console.log(`❌ V3 Multi-swap failed: ${swapReceipt?.transactionHash || swapTransactionSent.hash}`);
        }
        
        // Step 8: Send remaining ETH back to main wallet
        console.log(`\n💸 === V3 ETH RECOVERY ===`);
        console.log(`Transferring remaining ETH back to main wallet from V3 wallet...`);
        
        // Wait for balance to update
        await sleep(1000);
        
        // Send ETH back to main wallet
        await sendETHBack(newWallet.privateKey, mainSigner.address, fundingAmountWei);
        
        // Final balances and summary
        const finalMainBalance = await provider.getBalance(mainSigner.address);
        const finalNewWalletBalance = await provider.getBalance(connectedNewWallet.address);
        
        console.log(`\n📊 === V3 CYCLE SUMMARY ===`);
        console.log(`Final main wallet balance: ${ethers.utils.formatUnits(finalMainBalance, 18)} ETH`);
        console.log(`Final V3 wallet balance: ${ethers.utils.formatUnits(finalNewWalletBalance, 18)} ETH`);
        
        const totalActualGasCost = parseFloat(actualFundingGasCostETH) + (swapSuccess ? parseFloat(ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18)) : 0);
        console.log(`💰 Total actual V3 gas cost: ${totalActualGasCost.toFixed(8)} ETH`);
        
        const result = {
            success: swapSuccess,
            swapType: 'V3',
            feeTier: v3Fee,
            newWalletAddress: newWallet.address,
            newWalletPrivateKey: newWallet.privateKey,
            swapTxHash: swapReceipt?.transactionHash || swapTransactionSent.hash,
            fundingTxHash: fundingTransactionSent.hash,
            actualFundingGasCost: actualFundingGasCostETH,
            actualSwapGasCost: swapSuccess ? ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18) : '0',
            tokensSwapped: numberOfTokens,
            totalGasCost: totalActualGasCost.toFixed(8),
            gasAnalysis: {
                fundingAnalysis: {
                    estimated: fundingGasAnalysis.gasDetails.estimatedGasCostETH,
                    actual: actualFundingGasCostETH,
                    efficiency: fundingGasEfficiency
                },
                swapAnalysis: {
                    estimated: swapGasAnalysis.gasDetails.estimatedGasCostETH,
                    actual: swapSuccess ? ethers.utils.formatUnits(swapGasAnalysis.gasDetails.adjustedGasPrice.mul(swapReceipt.gasUsed), 18) : '0',
                    efficiency: swapSuccess ? swapGasEfficiency : '0'
                }
            }
        };
        
        console.log('V3 Result:', result);
        
        // Use your cycleDelay (keeping your updates)
        console.log(`\n⏱️  V3 Cycle completed. Starting next V3 cycle in ${cycleDelay}ms...`);
        
        // Wait before next cycle
        await sleep(cycleDelay);
        
        // Recursively call the function to continue the V3 loop
        return createWalletAndMultiSmallV3(multiTokens, cycleDelay, fundingAmount);
        
    } catch (err) {
        console.error(`Error in createWalletAndMultiSmallV3:`, err.message);
        console.log(`🔄 V3 Error occurred. Attempting to recover ETH...`);
        
        // Try to send ETH back to main wallet even if there was an error
        if (provider && mainSigner && newWallet) {
            try {
                await sendETHBack(newWallet.privateKey, mainSigner.address);
                console.log(`✅ ETH successfully recovered after V3 error`);
            } catch (recoveryError) {
                console.error(`❌ Failed to recover ETH after V3 error:`, recoveryError.message);
            }
        }
        
        // Use your cycle delay for retry (keeping your updates)
        console.log(`🔄 Retrying V3 in ${cycleDelay}ms...`);
        
        // Wait before retrying
        await sleep(cycleDelay);
        
        // Continue the V3 loop even if there was an error
        return createWalletAndMultiSmallV3(multiTokens, cycleDelay, fundingAmount);
    }
}

// Helper function to check ETH transfer gas cost before executing
async function checkTransferGasCost(senderPrivateKey, recipientAddress, gasMaxWei, gasMaxETH) {
    try {
        const senderWallet = new ethers.Wallet(senderPrivateKey, provider);
        const senderBalance = await provider.getBalance(senderWallet.address);
        
        // If wallet has no balance, no point in checking transfer
        if (senderBalance.eq(0)) {
            return { 
                withinLimit: false, 
                gasCostETH: "0", 
                reason: "no_balance" 
            };
        }
        
        // Get current gas price with same logic as other functions
        const baseGasPrice = await provider.getGasPrice();
        const minGasPrice = ethers.utils.parseUnits("0.001", 9);
        const gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100);
        
        // Standard ETH transfer gas limit
        const transferGasLimit = 21000;
        
        // Calculate total gas cost
        const totalGasCost = gasPrice.mul(transferGasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
        console.log(`Transfer gas check: ${totalGasCostETH} ETH (limit: ${gasMaxETH} ETH)`);
        
        const withinLimit = totalGasCost.lte(gasMaxWei);
        
        return {
            withinLimit,
            gasCostETH: totalGasCostETH,
            gasPrice: ethers.utils.formatUnits(gasPrice, 9),
            senderBalance: ethers.utils.formatUnits(senderBalance, 18)
        };
        
    } catch (error) {
        console.warn(`Error checking transfer gas cost: ${error.message}`);
        return { 
            withinLimit: false, 
            gasCostETH: "unknown", 
            reason: "check_failed" 
        };
    }
}

async function createWalletAndMultiv3(tokenAddress, cycleDelay = 3000, fundingAmount = "0.000005") {
    
    var pk = config.fundingPrivateKey
    const mainSigner = new ethers.Wallet(pk, provider);

    console.log("Main wallet:", mainSigner.address);
    console.log(`Funding: ${fundingAmount} ETH`);
    console.log(`Cycle delay: ${cycleDelay}ms`);
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    console.log(`Gas max limit: ${gasMaxETH} ETH`);
    
    // Step 1: Create a random new wallet
    const newWallet = ethers.Wallet.createRandom();
    const connectedNewWallet = newWallet.connect(provider);

    try {
        console.log(`Created new wallet: ${newWallet.address} ${newWallet.privateKey}`);

        savePrivateKey([
            newWallet.address,
            newWallet.privateKey
        ])
        
        // Step 2: Fund the new wallet from main signer
        const fundingAmountWei = ethers.utils.parseUnits(fundingAmount, 18);
        
        // Check main signer balance
        const mainBalance = await provider.getBalance(mainSigner.address);
        if (mainBalance.lt(fundingAmountWei)) {
            throw new Error(`Insufficient balance in main wallet. Need ${fundingAmount} ETH, have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        console.log(`Funding new wallet with ${fundingAmount} ETH...`);
        
        // Prepare funding transaction
        const fundingTx = {
            to: newWallet.address,
            value: fundingAmountWei
        };
        
        // Get gas estimates with fallback
        let fundingGasLimit, fundingGasPrice;
        try {
            // Try to use getGasEstimates if it exists
            if (typeof getGasEstimates === 'function') {
                const gasEstimates = await getGasEstimates(fundingTx, { provider: mainSigner });
                fundingGasLimit = gasEstimates.gasLimit;
                fundingGasPrice = gasEstimates.gasPrice;
            } else {
                throw new Error("getGasEstimates not available");
            }
        } catch (gasError) {
            console.log("Using fallback gas estimation for funding");
            const baseGasPrice = await provider.getGasPrice();
            fundingGasPrice = baseGasPrice.mul(120).div(100); // 20% boost
            fundingGasLimit = 21000;
        }
        
        // Check funding transaction gas cost against gasMax
        const fundingGasCost = fundingGasPrice.mul(fundingGasLimit);
        const fundingGasCostETH = ethers.utils.formatUnits(fundingGasCost, 18);
        
        console.log(`Funding gas cost: ${fundingGasCostETH} ETH`);
        
        if (fundingGasCost.gt(gasMaxWei)) {
            console.log(`❌ Funding gas cost ${fundingGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Skipping this cycle due to high gas costs`);
            
            // Wait and retry
            console.log(`🔄 Waiting ${cycleDelay}ms before retrying...`);
            await sleep(cycleDelay);
            return createWalletAndMultiv3(tokenAddress, cycleDelay, fundingAmount);
        }
        
        // Get nonce with fallback
        let fundingNonce;
        try {
            if (typeof getNonce === 'function') {
                fundingNonce = await getNonce(mainSigner, { provider });
            } else {
                fundingNonce = await mainSigner.getTransactionCount("pending");
            }
        } catch (nonceError) {
            fundingNonce = await mainSigner.getTransactionCount("pending");
        }
        
        console.log(`✅ Funding gas cost within limits, proceeding...`);
        console.log(`Funding gas price: ${ethers.utils.formatUnits(fundingGasPrice, 9)} Gwei`);
        
        // Send funding transaction
        const fundingTransaction = await mainSigner.sendTransaction({
            ...fundingTx,
            gasLimit: fundingGasLimit,
            gasPrice: fundingGasPrice,
            nonce: fundingNonce
        });
        
        console.log(`Funding transaction sent: ${fundingTransaction.hash}`);
        const fundingReceipt = await fundingTransaction.wait();
        
        // Log actual funding gas usage
        const actualFundingGasCost = fundingGasPrice.mul(fundingReceipt.gasUsed);
        const actualFundingGasCostETH = ethers.utils.formatUnits(actualFundingGasCost, 18);
        console.log(`✅ Funding successful - Actual gas cost: ${actualFundingGasCostETH} ETH`);
        
        // Verify funding
        let newWalletBalance = await provider.getBalance(connectedNewWallet.address);
        console.log(`New wallet balance: ${ethers.utils.formatUnits(newWalletBalance, 18)} ETH`);

        await new Promise(async (resolve, reject) => {
            let indexETH = 0;
            try {
                while(newWalletBalance.eq(0) && indexETH < 100){
                    console.log('Waiting for ETH balance to update...');
                    await sleep(1000);
                    newWalletBalance = await provider.getBalance(connectedNewWallet.address);
                    indexETH++;
                }
                
                if(newWalletBalance.gt(0)){
                    console.log('Balance loaded, proceeding with swap...');
                    resolve()
                }
            } catch(err) {
                console.warn('Error', err?.message);
                await sendETHBack(connectedNewWallet.privateKey, mainSigner.address)
                reject(err);
            }
        })
        
        // Step 3: Execute SwapV3 using the new wallet
        console.log(`Executing SwapV3 from new wallet...`);
        
        // SwapV3 parameters
        const contractAddress = '0xe9d7E6669C39350DD6664fd6fB66fCE4D871D374';
        const amount = ethers.utils.parseUnits("10", "wei");
        const weth = "0x4200000000000000000000000000000000000006";
        const token = tokenAddress;
        const fee = 10000;
        
        // Build exact transaction data for SwapV3
        const functionSelector = "0xd014efef";
        const encodedParams = ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint24", "address"],
            [weth, token, fee, connectedNewWallet.address]
        );
        
        const txData = functionSelector + encodedParams.slice(2);
        
        // Get current gas price
        const currentGasPrice = await provider.getGasPrice();
        console.log(`Current gas price: ${ethers.utils.formatUnits(currentGasPrice, 9)} Gwei`);
        
        // Enhanced gas price calculation (same as other functions)
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let swapGasPrice = currentGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : currentGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using swap gas price: ${ethers.utils.formatUnits(swapGasPrice, 9)} Gwei`);
        
        // Get nonce for swap transaction
        const swapNonce = await connectedNewWallet.getTransactionCount("pending");
        
        // Estimate gas for swap transaction
        let swapGasLimit = ethers.BigNumber.from("200000"); // fallback
        try {
            const estimatedGas = await provider.estimateGas({
                to: contractAddress,
                data: txData,
                value: amount,
                from: connectedNewWallet.address
            });
            swapGasLimit = estimatedGas.mul(120).div(100); // 20% buffer
        } catch (gasEstError) {
            console.log(`Gas estimation failed, using fallback: ${swapGasLimit.toString()}`);
        }
        
        // Check swap gas cost against gasMax
        const swapGasCost = swapGasPrice.mul(swapGasLimit);
        const swapGasCostETH = ethers.utils.formatUnits(swapGasCost, 18);
        
        console.log(`Swap gas limit: ${swapGasLimit.toString()}`);
        console.log(`Swap gas cost: ${swapGasCostETH} ETH`);
        
        if (swapGasCost.gt(gasMaxWei)) {
            console.log(`❌ Swap gas cost ${swapGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Skipping swap but recovering ETH`);
            
            // Skip swap but continue to ETH recovery with gas check
            const skipTransferGasCost = await checkTransferGasCost(newWallet.privateKey, mainSigner.address, gasMaxWei, gasMaxETH);
            
            if (skipTransferGasCost.withinLimit) {
                console.log(`✅ Transfer gas cost within limits, recovering ETH...`);
                await sendETHBack(newWallet.privateKey, mainSigner.address, ethers.utils.parseUnits(fundingAmount, 18));
            } else {
                console.log(`❌ Transfer gas cost ${skipTransferGasCost.gasCostETH} ETH also exceeds limit`);
                console.log(`⚠️  ETH will remain in wallet: ${newWallet.address}`);
            }
            
            console.log(`🔄 Waiting ${cycleDelay}ms before retrying...`);
            await sleep(cycleDelay);
            return createWalletAndMultiv3(tokenAddress, cycleDelay, fundingAmount);
        }
        
        // Prepare swap transaction
        const swapTx = {
            to: contractAddress,
            data: txData,
            value: amount,
            gasLimit: swapGasLimit,
            gasPrice: swapGasPrice,
            nonce: swapNonce
        };
        
        console.log(`✅ Swap gas cost within limits, proceeding...`);
        console.log(`Swap amount: ${amount.toString()} wei (${ethers.utils.formatUnits(amount, 18)} ETH)`);
        console.log(`Contract address: ${contractAddress}`);
        console.log(`WETH: ${weth}`);
        console.log(`Token: ${token}`);
        console.log(`Fee: ${fee}`);
        console.log(`Recipient: ${connectedNewWallet.address}`);
        
        // Execute the swap transaction
        let swapTransaction;
        let swapSuccess = false;
        
        try {
            swapTransaction = await connectedNewWallet.sendTransaction(swapTx);
            console.log(`Swap transaction sent: ${swapTransaction.hash}`);
            
            // Wait for the swap transaction to be mined
            const swapReceipt = await swapTransaction.wait();
            
            if (swapReceipt && swapReceipt.status === 1) {
                const actualSwapGasCost = swapGasPrice.mul(swapReceipt.gasUsed);
                const actualSwapGasCostETH = ethers.utils.formatUnits(actualSwapGasCost, 18);
                const swapGasEfficiency = ((swapReceipt.gasUsed.toNumber() / swapGasLimit.toNumber()) * 100).toFixed(1);
                
                console.log(`✅ SwapV3 successful: ${swapReceipt.transactionHash}`);
                console.log(`⛽ Gas used: ${swapReceipt.gasUsed.toString()} (estimated: ${swapGasLimit.toString()})`);
                console.log(`💰 Actual gas cost: ${actualSwapGasCostETH} ETH (estimated: ${swapGasCostETH} ETH)`);
                console.log(`📊 Gas efficiency: ${swapGasEfficiency}%`);
                swapSuccess = true;
            } else {
                console.log(`❌ SwapV3 failed: ${swapReceipt?.transactionHash || swapTransaction.hash}`);
            }
        } catch (swapError) {
            console.log(`❌ SwapV3 error: ${swapError.message.substring(0, 100)}`);
        }
        
        // Step 4: Send remaining ETH back to main wallet
        console.log(`Checking gas cost for ETH transfer back to main wallet...`);
        
        await sleep(1000);
        
        // Check gas cost for ETH transfer before executing
        const transferGasCost = await checkTransferGasCost(newWallet.privateKey, mainSigner.address, gasMaxWei, gasMaxETH);
        
        if (transferGasCost.withinLimit) {
            console.log(`✅ Transfer gas cost ${transferGasCost.gasCostETH} ETH within limits, proceeding...`);
            await sendETHBack(newWallet.privateKey, mainSigner.address, ethers.utils.parseUnits(fundingAmount, 18));
        } else {
            console.log(`❌ Transfer gas cost ${transferGasCost.gasCostETH} ETH exceeds limit ${gasMaxETH} ETH`);
            console.log(`⚠️  Skipping ETH transfer to avoid high gas costs`);
            console.log(`💡 ETH will remain in wallet: ${newWallet.address}`);
        }
        
        // Final balances
        const finalMainBalance = await provider.getBalance(mainSigner.address);
        const finalNewWalletBalance = await provider.getBalance(connectedNewWallet.address);
        
        console.log(`Final main wallet balance: ${ethers.utils.formatUnits(finalMainBalance, 18)} ETH`);
        console.log(`Final new wallet balance: ${ethers.utils.formatUnits(finalNewWalletBalance, 18)} ETH`);
        
        const result = {
            success: swapSuccess,
            newWalletAddress: newWallet.address,
            newWalletPrivateKey: newWallet.privateKey,
            swapTxHash: swapTransaction?.hash || '',
            fundingTxHash: fundingTransaction.hash,
            actualFundingGasCost: actualFundingGasCostETH,
            actualSwapGasCost: swapSuccess ? ethers.utils.formatUnits(swapGasPrice.mul(swapTransaction.gasUsed || 0), 18) : '0'
        };
        
        console.log('Result:', result);
        console.log(`🔄 Cycle completed. Starting next cycle in ${cycleDelay}ms...`);
        
        // Configurable delay before next cycle
        await sleep(cycleDelay);
        
        // Recursively call the function to continue the loop
        return createWalletAndMultiv3(tokenAddress, cycleDelay, fundingAmount);
        
    } catch (err) {
        console.error(`Error in createWalletAndMultiv3:`, err.message);
        console.log(`🔄 Error occurred. Attempting to recover ETH...`);
        
        // Try to send ETH back to main wallet even if there was an error
        if (provider && mainSigner && newWallet) {
            try {
                // Check gas cost before recovery transfer
                const recoveryTransferGasCost = await checkTransferGasCost(newWallet.privateKey, mainSigner.address, gasMaxWei, gasMaxETH);
                
                if (recoveryTransferGasCost.withinLimit) {
                    console.log(`✅ Recovery transfer gas cost within limits, proceeding...`);
                    await sendETHBack(newWallet.privateKey, mainSigner.address);
                    console.log(`✅ ETH successfully recovered after error`);
                } else {
                    console.log(`❌ Recovery transfer gas cost ${recoveryTransferGasCost.gasCostETH} ETH exceeds limit ${gasMaxETH} ETH`);
                    console.log(`⚠️  Cannot recover ETH due to high gas costs - ETH remains in ${newWallet.address}`);
                }
            } catch (recoveryError) {
                console.error(`❌ Failed to recover ETH after error:`, recoveryError.message);
            }
        }
        
        console.log(`🔄 Retrying in ${Math.max(cycleDelay, 5000)}ms...`);
        
        // Wait before retrying (use longer delay on error)
        await sleep(Math.max(cycleDelay, 5000));
        
        // Continue the loop even if there was an error
        return createWalletAndMultiv3(tokenAddress, cycleDelay, fundingAmount);
    }
}

async function sendETHBack(privateKey, receiver, minValue = ethers.utils.parseUnits("1", 18)) {
    // const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        const connectedNewWallet = new ethers.Wallet(privateKey, provider);
        
        let balance = await provider.getBalance(connectedNewWallet.address);
        console.log(`Balance ETH: ${ethers.utils.formatUnits(balance, 18)}`);

        await new Promise(async (resolve, reject) => {
            let indexETH = 0;
            
            while (indexETH < 10) {
                balance = await provider.getBalance(connectedNewWallet.address);
                
                // Check if balance meets our criteria
                if (balance.gt(0)) {
                    console.log(`✅ Balance updated: ${ethers.utils.formatUnits(balance, 18)} ETH`);
                    resolve();
                    return;
                }
                
                console.log(`Waiting for ETH balance to update... (${ethers.utils.formatUnits(balance, 18)} ETH) - attempt ${indexETH + 1}/10`);
                await sleep(1000);
                indexETH++;
            }
            
            // If we exit the loop, check one final time
            balance = await provider.getBalance(connectedNewWallet.address);
            if (balance.gt(0)) {
                console.log(`✅ Balance finally updated: ${ethers.utils.formatUnits(balance, 18)} ETH`);
                resolve();
            } else {
                console.log(`❌ Timeout waiting for balance. Current: ${ethers.utils.formatUnits(balance, 18)} ETH, Required: ${ethers.utils.formatUnits(minValue, 18)} ETH`);
                reject(new Error(`Balance did not reach minimum value after 10 attempts`));
            }
        });
        
        // Calculate gas for return transaction
        const returnGasPrice = await provider.getGasPrice();
        const baseGasLimit = 30000; // Standard ETH transfer
        
        // Add 20% buffer to gas limit
        const returnGasLimit = ethers.BigNumber.from(baseGasLimit).mul(200).div(100);
        const gasCost = returnGasPrice.mul(returnGasLimit);
        
        // Add extra buffer for safety (additional 10% of gas cost)
        const extraBuffer = gasCost.mul(10).div(100);
        const totalGasCost = gasCost.add(extraBuffer);
        
        // Calculate amount to send (balance - total gas cost)
        const valueToSend = balance.sub(totalGasCost);
        
        // Check if we have enough balance after gas
        if (valueToSend.lte(0)) {
            console.log(`Insufficient balance after gas. Balance: ${ethers.utils.formatUnits(balance, 18)} ETH, Gas needed: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
            return;
        }
        
        // Double check that we have enough for the actual transaction
        const actualTxCost = gasCost.add(valueToSend);
        if (balance.lt(actualTxCost)) {
            console.log(`Final check failed. Balance: ${ethers.utils.formatUnits(balance, 18)} ETH, TX cost: ${ethers.utils.formatUnits(actualTxCost, 18)} ETH`);
            return;
        }
        
        console.log(`Total balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        console.log(`Gas cost: ${ethers.utils.formatUnits(gasCost, 18)} ETH`);
        console.log(`Extra buffer: ${ethers.utils.formatUnits(extraBuffer, 18)} ETH`);
        console.log(`Total gas cost: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
        console.log(`Sending back: ${ethers.utils.formatUnits(valueToSend, 18)} ETH`);
        
        // Get nonce for return transaction
        const returnNonce = await connectedNewWallet.getTransactionCount("pending");

        
        // Send ETH back
        const returnTransaction = await connectedNewWallet.sendTransaction({
            to: receiver,
            value: valueToSend,
            gasLimit: returnGasLimit,
            gasPrice: returnGasPrice,
            nonce: returnNonce
        });
        
        await returnTransaction.wait();
        console.log(`✅ ETH sent back: ${returnTransaction.hash}`);
        
    } catch (error) {
        console.error("Error sending ETH back:", error.message);
        throw error;
    }
}

function sendETHBackNonAsync(privateKey, receiver, minValue = ethers.utils.parseUnits("1", 18)) {
    return new Promise((resolve, reject) => {
        
        try {
            const connectedNewWallet = new ethers.Wallet(privateKey, provider);
            
            // Initial balance check
            provider.getBalance(connectedNewWallet.address)
                .then(balance => {
                    console.log(`Initial Balance ETH: ${ethers.utils.formatUnits(balance, 18)}`);
                    
                    // Balance polling function
                    const pollBalance = (indexETH = 0) => {
                        if (indexETH >= 10) {
                            // Final attempt after timeout
                            provider.getBalance(connectedNewWallet.address)
                                .then(finalBalance => {
                                    if (finalBalance.gt(0) && finalBalance.lt(minValue)) {
                                        console.log(`✅ Balance finally updated: ${ethers.utils.formatUnits(finalBalance, 18)} ETH`);
                                        processTransaction(finalBalance, connectedNewWallet, receiver, resolve, reject);
                                    } else {
                                        const error = new Error(`Balance did not reach minimum value after 10 attempts. Current: ${ethers.utils.formatUnits(finalBalance, 18)} ETH, Required: ${ethers.utils.formatUnits(minValue, 18)} ETH`);
                                        console.log(`❌ Timeout waiting for balance: ${error.message}`);
                                        reject(error);
                                    }
                                })
                                .catch(reject);
                            return;
                        }
                        
                        provider.getBalance(connectedNewWallet.address)
                            .then(currentBalance => {
                                // Check if balance meets our criteria
                                if (currentBalance.gt(0)) {
                                    console.log(`✅ Balance updated: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
                                    processTransaction(currentBalance, connectedNewWallet, receiver, resolve, reject);
                                    return;
                                }
                                
                                console.log(`Waiting for ETH balance to update... (${ethers.utils.formatUnits(currentBalance, 18)} ETH) - attempt ${indexETH + 1}/10`);
                                
                                // Schedule next check
                                setTimeout(() => {
                                    pollBalance(indexETH + 1);
                                }, 1000);
                            })
                            .catch(reject);
                    };
                    
                    // Check if initial balance already meets criteria
                    if (balance.gt(0)) {
                        console.log(`✅ Initial balance meets criteria: ${ethers.utils.formatUnits(balance, 18)} ETH`);
                        processTransaction(balance, connectedNewWallet, receiver, resolve, reject);
                    } else {
                        // Start polling
                        pollBalance();
                    }
                })
                .catch(reject);
                
        } catch (error) {
            console.error("Error initializing sendETHBack:", error.message);
            reject(error);
        }
    });
}

// Helper function to process the transaction
function processTransaction(balance, connectedNewWallet, receiver, resolve, reject) {
    // Get gas price and calculate costs
    Promise.all([
        provider.getGasPrice(),
        connectedNewWallet.getTransactionCount("pending")
    ])
    .then(([returnGasPrice, returnNonce]) => {
        const baseGasLimit = 30000; // Standard ETH transfer
        
        // Add 20% buffer to gas limit
        const returnGasLimit = ethers.BigNumber.from(baseGasLimit).mul(200).div(100);
        const gasCost = returnGasPrice.mul(returnGasLimit);
        
        // Add extra buffer for safety (additional 10% of gas cost)
        const extraBuffer = gasCost.mul(10).div(100);
        const totalGasCost = gasCost.add(extraBuffer);
        
        // Calculate amount to send (balance - total gas cost)
        const valueToSend = balance.sub(totalGasCost);
        
        // Check if we have enough balance after gas
        if (valueToSend.lte(0)) {
            const error = new Error(`Insufficient balance after gas. Balance: ${ethers.utils.formatUnits(balance, 18)} ETH, Gas needed: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
            console.log(error.message);
            reject(error);
            return;
        }
        
        // Double check that we have enough for the actual transaction
        const actualTxCost = gasCost.add(valueToSend);
        if (balance.lt(actualTxCost)) {
            const error = new Error(`Final check failed. Balance: ${ethers.utils.formatUnits(balance, 18)} ETH, TX cost: ${ethers.utils.formatUnits(actualTxCost, 18)} ETH`);
            console.log(error.message);
            reject(error);
            return;
        }
        
        // Log transaction details
        console.log(`Total balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        console.log(`Gas cost: ${ethers.utils.formatUnits(gasCost, 18)} ETH`);
        console.log(`Extra buffer: ${ethers.utils.formatUnits(extraBuffer, 18)} ETH`);
        console.log(`Total gas cost: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
        console.log(`Sending back: ${ethers.utils.formatUnits(valueToSend, 18)} ETH`);
        
        // Send ETH back transaction
        connectedNewWallet.sendTransaction({
            to: receiver,
            value: valueToSend,
            gasLimit: returnGasLimit,
            gasPrice: returnGasPrice,
            nonce: returnNonce
        })
        .then(returnTransaction => {
            console.log(`🚀 Transaction sent: ${returnTransaction.hash}`);
            
            // Wait for transaction confirmation
            returnTransaction.wait()
                .then(receipt => {
                    console.log(`✅ ETH sent back successfully: ${returnTransaction.hash}`);
                    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
                    console.log(`📋 Block: ${receipt.blockNumber}`);
                    
                    resolve({
                        success: true,
                        hash: returnTransaction.hash,
                        amountSent: ethers.utils.formatUnits(valueToSend, 18),
                        gasUsed: receipt.gasUsed.toString(),
                        blockNumber: receipt.blockNumber
                    });
                })
                .catch(waitError => {
                    console.error(`❌ Transaction wait failed: ${waitError.message}`);
                    // Transaction was sent but confirmation failed
                    resolve({
                        success: true,
                        hash: returnTransaction.hash,
                        amountSent: ethers.utils.formatUnits(valueToSend, 18),
                        warning: 'Transaction sent but confirmation failed'
                    });
                });
        })
        .catch(sendError => {
            console.error(`❌ Failed to send transaction: ${sendError.message}`);
            reject(new Error(`Transaction failed: ${sendError.message}`));
        });
        
    })
    .catch(gasError => {
        console.error(`❌ Failed to get gas price or nonce: ${gasError.message}`);
        reject(new Error(`Gas calculation failed: ${gasError.message}`));
    });
}

async function withdrawFromContract(contractAddress, tokenAddress = null) {
    try {
        if (!config.fundingPrivateKey) {
            throw new Error('PK_MAIN not configured in .env file');
        }

        // Use main wallet (PK_MAIN) for withdrawal (only owner can withdraw)
        const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        
        console.log(`🏦 Withdrawing from contract: ${contractAddress}`);
        console.log(`👤 Main wallet: ${mainSigner.address}`);
        
        // Check main wallet balance for gas
        const mainBalance = await provider.getBalance(mainSigner.address);
        const minBalance = ethers.utils.parseUnits("0.0001", 18); // 0.001 ETH minimum for gas
        
        if (mainBalance.lt(minBalance)) {
            throw new Error(`Insufficient balance for gas in main wallet: ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        console.log(`💰 Main wallet balance: ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        
        // Create contract instance
        const volumeSwapContract = new ethers.Contract(contractAddress, volumeSwapAbi, mainSigner);
        
        // Check contract balances before withdrawal
        console.log(`\n🔍 Checking contract balances before withdrawal...`);
        
        const contractETHBalance = await provider.getBalance(contractAddress);
        console.log(`💰 Contract ETH balance: ${ethers.utils.formatUnits(contractETHBalance, 18)} ETH`);
        
        // Get token address from contract if not provided
        let targetTokenAddress = tokenAddress;
        if (!targetTokenAddress) {
            try {
                targetTokenAddress = await volumeSwapContract.tokenAddress();
                console.log(`🎯 Contract token address: ${targetTokenAddress}`);
            } catch (tokenError) {
                console.log(`⚠️  Could not get token address from contract: ${tokenError.message}`);
            }
        }
        
        // Check token balance if we have token address
        var contractTokenBalance = ethers.BigNumber.from("0");
        var tokenSymbol = "TOKEN";
        var tokenDecimals = 18;
        
        if (targetTokenAddress && targetTokenAddress !== ethers.constants.AddressZero) {
            try {
                const tokenContract = new ethers.Contract(targetTokenAddress, [
                    "function balanceOf(address) external view returns (uint256)",
                    "function symbol() external view returns (string)",
                    "function decimals() external view returns (uint8)"
                ], provider);
                
                contractTokenBalance = await tokenContract.balanceOf(contractAddress);
                tokenSymbol = await tokenContract.symbol();
                tokenDecimals = await tokenContract.decimals();
                
                console.log(`🪙 Contract ${tokenSymbol} balance: ${ethers.utils.formatUnits(contractTokenBalance, tokenDecimals)} ${tokenSymbol}`);
            } catch (tokenError) {
                console.log(`⚠️  Could not check token balance: ${tokenError.message}`);
            }
        }
        
        // Check if there's anything to withdraw
        if (contractETHBalance.eq(0) && contractTokenBalance.eq(0)) {
            console.log(`ℹ️  Contract has no funds to withdraw`);
            return {
                success: true,
                reason: 'no_funds',
                ethWithdrawn: "0",
                tokensWithdrawn: "0"
            };
        }
        
        console.log(`\n💸 Initiating withdrawal...`);
        console.log(`📤 Will withdraw: ${ethers.utils.formatUnits(contractETHBalance, 18)} ETH`);
        if (contractTokenBalance.gt(0)) {
            console.log(`📤 Will withdraw: ${ethers.utils.formatUnits(contractTokenBalance, tokenDecimals)} ${tokenSymbol}`);
        }
        
        // Build raw transaction data for withdraw
        const tx = {
            to: volumeSwapContract.address,
            data: volumeSwapContract.interface.encodeFunctionData("withdraw", []),
            value: 0
        };
        
        // Get nonce
        const nonce = await mainSigner.getTransactionCount("latest");
        
        // Get gas price
        const baseGasPrice = await provider.getGasPrice();
        console.log(`⛽ Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Use moderate gas price boost for withdrawal
        const gasPrice = baseGasPrice.mul(120).div(100); // 20% boost
        console.log(`⛽ Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas limit
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                ...tx,
                from: mainSigner.address
            });
            
            // Add 30% buffer to gas limit
            gasLimit = gasLimit.mul(130).div(100);
        } catch (gasError) {
            console.error(`Gas estimation failed:`, gasError.message);
            // Use fallback gas limit for withdrawal
            gasLimit = ethers.BigNumber.from("150000");
        }
        
        // Check if we have enough balance for gas
        const totalGasCost = gasPrice.mul(gasLimit);
        if (mainBalance.lt(totalGasCost)) {
            throw new Error(`Insufficient balance for gas. Need ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
        }
        
        console.log(`⛽ Gas limit: ${gasLimit.toString()}`);
        console.log(`⛽ Total gas cost: ${ethers.utils.formatUnits(totalGasCost, 18)} ETH`);
        
        // Record balances before withdrawal for comparison
        const mainBalanceBefore = await provider.getBalance(mainSigner.address);
        
        // Send withdrawal transaction
        const transaction = await mainSigner.sendTransaction({
            ...tx,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        });
        
        console.log(`📤 Withdrawal transaction sent: ${transaction.hash}`);
        console.log(`⏳ Waiting for confirmation...`);
        
        // Wait for confirmation
        let receipt;
        try {
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                throw new Error(`Receipt error: ${receiptError.message}`);
            }
        }
        
        if (receipt && receipt.status === 1) {
            console.log(`✅ Withdrawal SUCCESS: ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            
            // Check balances after withdrawal
            console.log(`\n📊 Post-withdrawal status:`);
            
            const mainBalanceAfter = await provider.getBalance(mainSigner.address);
            const contractETHBalanceAfter = await provider.getBalance(contractAddress);
            
            const ethReceived = contractETHBalance; // All ETH should be withdrawn
            const gasUsed = receipt.gasUsed.mul(gasPrice);
            const netETHGain = ethReceived.sub(gasUsed);
            
            console.log(`💰 Main wallet balance: ${ethers.utils.formatUnits(mainBalanceAfter, 18)} ETH`);
            console.log(`💰 Contract ETH balance: ${ethers.utils.formatUnits(contractETHBalanceAfter, 18)} ETH`);
            console.log(`📈 ETH withdrawn: ${ethers.utils.formatUnits(ethReceived, 18)} ETH`);
            console.log(`⛽ Gas cost: ${ethers.utils.formatUnits(gasUsed, 18)} ETH`);
            console.log(`📊 Net ETH gain: ${ethers.utils.formatUnits(netETHGain, 18)} ETH`);
            
            // Check token balance after withdrawal
            let tokensWithdrawn = "0";
            if (targetTokenAddress && targetTokenAddress !== ethers.constants.AddressZero) {
                try {
                    var tokenContract = new ethers.Contract(targetTokenAddress, [
                        "function balanceOf(address) external view returns (uint256)"
                    ], provider);
                    
                    var contractTokenBalanceAfter = await tokenContract.balanceOf(contractAddress);
                    tokensWithdrawn = ethers.utils.formatUnits(contractTokenBalance.sub(contractTokenBalanceAfter), tokenDecimals);
                    
                    console.log(`🪙 Contract ${tokenSymbol} balance: ${ethers.utils.formatUnits(contractTokenBalanceAfter, tokenDecimals)} ${tokenSymbol}`);
                    console.log(`📈 ${tokenSymbol} withdrawn: ${tokensWithdrawn} ${tokenSymbol}`);
                } catch (tokenCheckError) {
                    console.log(`⚠️  Could not verify token withdrawal: ${tokenCheckError.message}`);
                }
            }
            
            console.log(`\n✅ Withdrawal completed successfully!`);
            
            return {
                success: true,
                txHash: receipt.transactionHash,
                ethWithdrawn: ethers.utils.formatUnits(ethReceived, 18),
                tokensWithdrawn: tokensWithdrawn,
                tokenSymbol: tokenSymbol,
                gasUsed: receipt.gasUsed.toString(),
                gasCost: ethers.utils.formatUnits(gasUsed, 18),
                netETHGain: ethers.utils.formatUnits(netETHGain, 18)
            };
        } else {
            throw new Error(`Withdrawal transaction failed: ${receipt?.transactionHash || transaction.hash}`);
        }
        
    } catch (err) {
        console.error(`❌ Withdrawal error: ${err.message}`);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            throw new Error(`Insufficient funds in main wallet for withdrawal`);
        } else if (err.message.includes('Ownable: caller is not the owner')) {
            throw new Error(`Only the contract owner can withdraw funds. Make sure PK_MAIN matches the contract owner.`);
        } else if (err.code === 'CALL_EXCEPTION') {
            throw new Error(`Contract call failed - contract may not exist or function may have reverted`);
        }
        
        throw err;
    }
}

// Helper function to withdraw from contract using token address lookup
async function withdrawByToken(tokenAddress) {
    try {
        if (!config.fundingPrivateKey) {
            throw new Error('PK_MAIN not configured in .env file');
        }
        
        const mainWallet = new ethers.Wallet(config.fundingPrivateKey);
        
        // Get contract address for the token
        const contractResult = await getContractAddress(tokenAddress, mainWallet.address, contracts.deployerContract);
        
        if (!contractResult.success) {
            throw new Error(`No contract found for token ${tokenAddress}. Deploy a contract first.`);
        }
        
        console.log(`🔍 Found contract for token ${tokenAddress}: ${contractResult.contractAddress}`);
        
        return await withdrawFromContract(contractResult.contractAddress, tokenAddress);
        
    } catch (err) {
        console.error(`❌ Withdrawal by token error: ${err.message}`);
        throw err;
    }
}


async function volumeBotV2(index = 0, wallets, contractAddress, BUYSELL = true) {
    try {
        if (index >= wallets.length) {
            console.log(`Index ${index} exceeds wallet array length`);
            return { success: false, reason: 'index_out_of_bounds' };
        }
        
        const signer = new ethers.Wallet(wallets[index][1], provider);
        console.log(`Wallet ${index}: ${signer.address}`);
        console.log(`Function: ${BUYSELL ? "executeSingleSwapV3" : "executeV3Swap"}`)

        // Check wallet balance first
        const balance = await provider.getBalance(signer.address);
        const minBalance = ethers.utils.parseUnits("0.000001", 18); // 0.000001 ETH minimum
        
        if (balance.lt(minBalance)) {
            console.log(`Insufficient balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_funds' };
        }
        
        console.log(`Wallet balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        
        // Create contract instance with the fixed ABI
        const contract = new ethers.Contract(contractAddress, volumeSwapAbi, signer);
        
        // Build raw transaction data
        const tx = {
            to: contract.address,
            data: contract.interface.encodeFunctionData(BUYSELL ? "executeSingleSwapV2" : "executeSwap", []),
            value: 0 // No ETH value sent directly, contract handles its own balance
        };

        // Get nonce using "latest" instead of "pending"
        const nonce = await signer.getTransactionCount("latest");
        
        // Get base gas price and apply multiplier
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Force minimum gas price for Base network
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas limit
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                ...tx,
                from: signer.address
            });
            
            // Add 20% buffer to gas limit (reduced from 50% to be more conservative)
            gasLimit = gasLimit.mul(120).div(100);
        } catch (gasError) {
            console.error(`Gas estimation failed:`, gasError.message);
            // Use fallback gas limit for VolumeSwap executeSwap
            gasLimit = ethers.BigNumber.from("300000");
        }
        
        // Calculate total gas cost
        const totalGasCost = gasPrice.mul(gasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
        console.log(`Gas limit: ${gasLimit.toString()}`);
        console.log(`Total gas cost: ${totalGasCostETH} ETH`);
        
        // Check against gasMax limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        console.log(`Gas max limit: ${gasMaxETH} ETH`);
        
        if (totalGasCost.gt(gasMaxWei)) {
            console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Transaction cancelled to stay within gas limits`);
            return { 
                success: false, 
                reason: 'gas_cost_exceeds_max',
                gasRequested: totalGasCostETH,
                gasMaxAllowed: gasMaxETH
            };
        }
        
        // Check if we have enough balance for gas
        if (balance.lt(totalGasCost)) {
            console.log(`Insufficient balance for gas. Need ${totalGasCostETH} ETH, have ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_gas' };
        }
        
        console.log(`✅ Gas cost within limits, proceeding with transaction`);
        console.log(`Contract address: ${contractAddress}`);
        
        // Send transaction with legacy type
        const transaction = await signer.sendTransaction({
            ...tx,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        });
        
        console.log(`Transaction sent: ${transaction.hash}`);
        
        // Wait for confirmation with timeout
        let receipt;
        try {
            // Wait up to 2 minutes for confirmation
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            // Try to get receipt manually after waiting
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                return { success: false, reason: 'receipt_error', txHash: transaction.hash };
            }
        }
        
        if (receipt && receipt.status === 1) {
            const actualGasUsed = receipt.gasUsed;
            const actualGasCost = gasPrice.mul(actualGasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            
            console.log(`✅ SUCCESS: ${index} - ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${actualGasUsed.toString()} (estimated: ${gasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${((actualGasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1)}%`);
            
            // Try to parse events for additional info
            try {
                const swapExecutedEvent = receipt.logs.find(log => {
                    try {
                        const parsed = contract.interface.parseLog(log);
                        return parsed.name === 'SwapExecuted';
                    } catch (e) {
                        return false;
                    }
                });
                
                if (swapExecutedEvent) {
                    const parsed = contract.interface.parseLog(swapExecutedEvent);
                    console.log(`📊 Swap executed for recipient: ${parsed.args.recipient}`);
                }
            } catch (eventError) {
                console.log(`Could not parse swap events: ${eventError.message}`);
            }
            
            return { 
                success: true, 
                txHash: receipt.transactionHash,
                gasUsed: actualGasUsed.toString(),
                gasEstimated: gasLimit.toString(),
                actualGasCost: actualGasCostETH,
                estimatedGasCost: totalGasCostETH,
                gasEfficiency: ((actualGasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1),
                walletIndex: index,
                walletAddress: signer.address
            };
        } else {
            console.log(`❌ FAILED: ${index} - ${receipt?.transactionHash || transaction.hash}`);
            return { 
                success: false, 
                reason: 'transaction_failed', 
                txHash: receipt?.transactionHash || transaction.hash 
            };
        }
        
    } catch (err) {
        console.error(`Error for wallet ${index}:`, err.message);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            console.log(`No funds in wallet ${index}`);
            return { success: false, reason: 'insufficient_funds' };
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW') {
            console.log(`Nonce issue for wallet ${index}`);
            return { success: false, reason: 'nonce_error' };
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            console.log(`Gas price too low for wallet ${index}`);
            return { success: false, reason: 'gas_price_low' };
        } else if (err.message.includes('gas')) {
            console.log(`Gas related error for wallet ${index}:`, err.message);
            return { success: false, reason: 'gas_error' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            console.log(`ABI parsing error for wallet ${index}:`, err.message);
            return { success: false, reason: 'abi_error' };
        }
        
        return { success: false, reason: 'unknown_error', error: err.message };
    }
}

async function volumeBotV3(index = 0, wallets = [], contractAddress, BUYSELL = true) {
    try {
        if (index >= wallets.length) {
            console.log(`Index ${index} exceeds wallet array length`);
            return { success: false, reason: 'index_out_of_bounds' };
        }
        
        const signer = new ethers.Wallet(wallets[index][1], provider);
        console.log(`Wallet ${index}: ${signer.address}`);
        console.log(`Function: ${BUYSELL ? "executeSingleSwapV3" : "executeV3Swap"}`)

        // Check wallet balance first
        const balance = await provider.getBalance(signer.address);
        const minBalance = ethers.utils.parseUnits("0.000001", 18); // 0.000001 ETH minimum
        
        if (balance.lt(minBalance)) {
            console.log(`Insufficient balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_funds' };
        }
        
        console.log(`Wallet balance: ${ethers.utils.formatUnits(balance, 18)} ETH`);
        
        // Create contract instance with the fixed ABI
        const contract = new ethers.Contract(contractAddress, volumeSwapAbi, signer);
        
        // Build raw transaction data
        const tx = {
            to: contract.address,
            data: contract.interface.encodeFunctionData(BUYSELL ? "executeSingleSwapV3" : "executeV3Swap", []),
            value: 0 // No ETH value sent directly, contract handles its own balance
        };

        // Get nonce using "latest" instead of "pending"
        const nonce = await signer.getTransactionCount("latest");
        
        // Get base gas price and apply multiplier
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        // Force minimum gas price for Base network
        const minGasPrice = ethers.utils.parseUnits("0.001", 9); // 0.001 Gwei minimum
        let gasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100); // 5x minimum or 20% boost
        
        console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, 9)} Gwei`);
        
        // Estimate gas limit
        let gasLimit;
        try {
            gasLimit = await provider.estimateGas({
                ...tx,
                from: signer.address
            });
            
            // Add 20% buffer to gas limit (reduced from 50% to be more conservative)
            gasLimit = gasLimit.mul(120).div(100);
        } catch (gasError) {
            console.error(`Gas estimation failed:`, gasError.message);
            // Use fallback gas limit for VolumeSwap executeSwap
            gasLimit = ethers.BigNumber.from("300000");
        }
        
        // Calculate total gas cost
        const totalGasCost = gasPrice.mul(gasLimit);
        const totalGasCostETH = ethers.utils.formatUnits(totalGasCost, 18);
        
        console.log(`Gas limit: ${gasLimit.toString()}`);
        console.log(`Total gas cost: ${totalGasCostETH} ETH`);
        
        // Check against gasMax limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        console.log(`Gas max limit: ${gasMaxETH} ETH`);
        
        if (totalGasCost.gt(gasMaxWei)) {
            console.log(`❌ Gas cost ${totalGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Transaction cancelled to stay within gas limits`);
            return { 
                success: false, 
                reason: 'gas_cost_exceeds_max',
                gasRequested: totalGasCostETH,
                gasMaxAllowed: gasMaxETH
            };
        }
        
        // Check if we have enough balance for gas
        if (balance.lt(totalGasCost)) {
            console.log(`Insufficient balance for gas. Need ${totalGasCostETH} ETH, have ${ethers.utils.formatUnits(balance, 18)} ETH`);
            return { success: false, reason: 'insufficient_gas' };
        }
        
        console.log(`✅ Gas cost within limits, proceeding with transaction`);
        console.log(`Contract address: ${contractAddress}`);
        
        // Send transaction with legacy type
        const transaction = await signer.sendTransaction({
            ...tx,
            gasLimit,
            gasPrice,
            nonce,
            type: 0 // Force legacy transaction type
        });
        
        console.log(`Transaction sent: ${transaction.hash}`);
        
        // Wait for confirmation with timeout
        let receipt;
        try {
            // Wait up to 2 minutes for confirmation
            receipt = await Promise.race([
                transaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            // Try to get receipt manually after waiting
            await sleep(3000);
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (!receipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                return { success: false, reason: 'receipt_error', txHash: transaction.hash };
            }
        }
        
        if (receipt && receipt.status === 1) {
            const actualGasUsed = receipt.gasUsed;
            const actualGasCost = gasPrice.mul(actualGasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            
            console.log(`✅ SUCCESS: ${index} - ${receipt.transactionHash}`);
            console.log(`⛽ Gas used: ${actualGasUsed.toString()} (estimated: ${gasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${((actualGasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1)}%`);
            
            // Try to parse events for additional info
            try {
                const swapExecutedEvent = receipt.logs.find(log => {
                    try {
                        const parsed = contract.interface.parseLog(log);
                        return parsed.name === 'SwapExecuted';
                    } catch (e) {
                        return false;
                    }
                });
                
                if (swapExecutedEvent) {
                    const parsed = contract.interface.parseLog(swapExecutedEvent);
                    console.log(`📊 Swap executed for recipient: ${parsed.args.recipient}`);
                }
            } catch (eventError) {
                console.log(`Could not parse swap events: ${eventError.message}`);
            }
            
            return { 
                success: true, 
                txHash: receipt.transactionHash,
                gasUsed: actualGasUsed.toString(),
                gasEstimated: gasLimit.toString(),
                actualGasCost: actualGasCostETH,
                estimatedGasCost: totalGasCostETH,
                gasEfficiency: ((actualGasUsed.toNumber() / gasLimit.toNumber()) * 100).toFixed(1),
                walletIndex: index,
                walletAddress: signer.address
            };
        } else {
            console.log(`❌ FAILED: ${index} - ${receipt?.transactionHash || transaction.hash}`);
            return { 
                success: false, 
                reason: 'transaction_failed', 
                txHash: receipt?.transactionHash || transaction.hash 
            };
        }
        
    } catch (err) {
        console.error(`Error for wallet ${index}:`, err.message);
        
        // Handle specific error types
        if (err.code === 'INSUFFICIENT_FUNDS' || err.message.includes('insufficient funds')) {
            console.log(`No funds in wallet ${index}`);
            return { success: false, reason: 'insufficient_funds' };
        } else if (err.code === 'NONCE_EXPIRED' || err.code === 'NONCE_TOO_LOW') {
            console.log(`Nonce issue for wallet ${index}`);
            return { success: false, reason: 'nonce_error' };
        } else if (err.code === 'REPLACEMENT_UNDERPRICED') {
            console.log(`Gas price too low for wallet ${index}`);
            return { success: false, reason: 'gas_price_low' };
        } else if (err.message.includes('gas')) {
            console.log(`Gas related error for wallet ${index}:`, err.message);
            return { success: false, reason: 'gas_error' };
        } else if (err.message.includes('INVALID_ARGUMENT')) {
            console.log(`ABI parsing error for wallet ${index}:`, err.message);
            return { success: false, reason: 'abi_error' };
        }
        
        return { success: false, reason: 'unknown_error', error: err.message };
    }
}


async function volumeBotV3Fresh(contractAddress, multiTokens, fundingAmount = "0.00001", BUYSELL = true, cycleDelay = 2000) {
    let connectedNewWallet = null;
    let mainSigner = null;
    const newWallet = ethers.Wallet.createRandom();
    
    console.log(`Starting volumeBotV3Fresh cycle...`);
    console.log(`Funding amount: ${fundingAmount} ETH`);
    console.log(`Contract address: ${contractAddress}`);
    console.log(`Cycle delay: ${cycleDelay}ms`);
    
    // Get gas max limit from config
    const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
        config.gasSettings.gasMax : 
        config.gasSettings.gasMax.toString();
    const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
    console.log(`Gas max limit: ${gasMaxETH} ETH`);

    try {
        // Step 1: Initialize main signer
        mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        console.log("Main wallet:", mainSigner.address);

        // Step 2: Create and connect new wallet
        connectedNewWallet = newWallet.connect(provider);
        console.log(`Created new fresh wallet: ${newWallet.address}`);
        console.log(`Private key: ${newWallet.privateKey}`);

        // Save the private key
        savePrivateKey([newWallet.address, newWallet.privateKey]);
        
        // Step 3: Fund the new wallet
        const fundingAmountWei = ethers.utils.parseUnits(fundingAmount, 18);
        
        // Check main signer balance
        const mainBalance = await provider.getBalance(mainSigner.address);
        if (mainBalance.lt(fundingAmountWei)) {
            throw new Error(`Insufficient balance in main wallet. Need ${fundingAmount} ETH, have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        console.log(`Funding fresh wallet with ${fundingAmount} ETH...`);
        
        // Prepare funding transaction
        const fundingTx = {
            to: newWallet.address,
            value: fundingAmountWei
        };
        
        // Get gas estimates for funding
        let fundingGasLimit, fundingGasPrice;
        try {
            if (typeof getGasEstimates === 'function') {
                const gasEstimates = await getGasEstimates(fundingTx, { provider: mainSigner });
                fundingGasLimit = gasEstimates.gasLimit;
                fundingGasPrice = gasEstimates.gasPrice;
            } else {
                throw new Error("getGasEstimates not available");
            }
        } catch (gasError) {
            console.log("Using fallback gas estimation for funding");
            const baseGasPrice = await provider.getGasPrice();
            fundingGasPrice = baseGasPrice.mul(120).div(100); // 20% boost
            fundingGasLimit = 21000;
        }
        
        // Check funding gas cost against limit
        const fundingGasCost = fundingGasPrice.mul(fundingGasLimit);
        const fundingGasCostETH = ethers.utils.formatUnits(fundingGasCost, 18);
        
        console.log(`Funding gas cost: ${fundingGasCostETH} ETH`);
        
        if (fundingGasCost.gt(gasMaxWei)) {
            console.log(`❌ Funding gas cost ${fundingGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Skipping this cycle due to high gas costs`);
            
            await sleep(cycleDelay);
            return volumeBotV3Fresh(contractAddress, multiTokens, fundingAmount, BUYSELL, cycleDelay);
        }
        
        // Get nonce for funding
        let fundingNonce;
        try {
            if (typeof getNonce === 'function') {
                fundingNonce = await getNonce(mainSigner, { provider });
            } else {
                fundingNonce = await mainSigner.getTransactionCount("pending");
            }
        } catch (nonceError) {
            fundingNonce = await mainSigner.getTransactionCount("pending");
        }
        
        console.log(`✅ Funding gas cost within limits, proceeding...`);
        
        // Send funding transaction
        const fundingTransaction = await mainSigner.sendTransaction({
            ...fundingTx,
            gasLimit: fundingGasLimit,
            gasPrice: fundingGasPrice,
            nonce: fundingNonce
        });
        
        console.log(`Funding transaction sent: ${fundingTransaction.hash}`);
        const fundingReceipt = await fundingTransaction.wait();
        
        // Log actual funding gas usage
        const actualFundingGasCost = fundingGasPrice.mul(fundingReceipt.gasUsed);
        const actualFundingGasCostETH = ethers.utils.formatUnits(actualFundingGasCost, 18);
        console.log(`✅ Funding successful - Actual gas cost: ${actualFundingGasCostETH} ETH`);
        
        // Step 4: Wait for balance to update and verify
        let currentBalance = await provider.getBalance(connectedNewWallet.address);
        console.log(`Fresh wallet balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
        
        await new Promise(async (resolve, reject) => {
            let indexETH = 0;
            try {
                while(currentBalance.eq(0) && indexETH < 100){
                    console.log('Waiting for fresh wallet ETH balance to update...');
                    await sleep(1000);
                    currentBalance = await provider.getBalance(connectedNewWallet.address);
                    indexETH++;
                }
                
                if(currentBalance.gt(0)){
                    console.log('Fresh wallet balance loaded, proceeding with volume swap...');
                    resolve();
                } else {
                    reject(new Error("Balance never updated"));
                }
            } catch(err) {
                console.warn('Balance update error', err?.message);
                await sendETHBack(connectedNewWallet.privateKey, mainSigner.address);
                reject(err);
            }
        });

        // Step 5: Execute volume swap
        console.log(`Executing volume swap from fresh wallet...`);
        
        // Check minimum balance requirement
        const minBalance = ethers.utils.parseUnits("0.000001", 18);
        if (currentBalance.lt(minBalance)) {
            throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
        }
        
        // Create contract instance
        const contract = new ethers.Contract(contractAddress, volumeSwapAbi, connectedNewWallet);
        
        // Build transaction for volume swap
        const swapTx = {
            to: contract.address,
            data: contract.interface.encodeFunctionData(BUYSELL ? "executeSingleSwapV3" : "executeV3Swap", []),
            value: 0 // No ETH value sent directly
        };

        // Get nonce for swap
        const swapNonce = await connectedNewWallet.getTransactionCount("latest");
        
        // Get gas price with boost
        const baseGasPrice = await provider.getGasPrice();
        console.log(`Base gas price: ${ethers.utils.formatUnits(baseGasPrice, 9)} Gwei`);
        
        const minGasPrice = ethers.utils.parseUnits("0.001", 9);
        let swapGasPrice = baseGasPrice.lt(minGasPrice) ? 
            minGasPrice.mul(5) : baseGasPrice.mul(120).div(100);
        
        console.log(`Using swap gas price: ${ethers.utils.formatUnits(swapGasPrice, 9)} Gwei`);
        
        // Estimate gas for swap
        let swapGasLimit;
        try {
            swapGasLimit = await provider.estimateGas({
                ...swapTx,
                from: connectedNewWallet.address
            });
            
            // Add 20% buffer
            swapGasLimit = swapGasLimit.mul(120).div(100);
        } catch (gasError) {
            console.error(`Gas estimation failed:`, gasError.message);
            swapGasLimit = ethers.BigNumber.from("300000");
        }
        
        // Calculate total gas cost for swap
        const totalSwapGasCost = swapGasPrice.mul(swapGasLimit);
        const totalSwapGasCostETH = ethers.utils.formatUnits(totalSwapGasCost, 18);
        
        console.log(`Swap gas limit: ${swapGasLimit.toString()}`);
        console.log(`Total swap gas cost: ${totalSwapGasCostETH} ETH`);
        
        // Check swap gas cost against limit
        if (totalSwapGasCost.gt(gasMaxWei)) {
            console.log(`❌ Swap gas cost ${totalSwapGasCostETH} ETH exceeds maximum allowed ${gasMaxETH} ETH`);
            console.log(`⚠️  Skipping swap but recovering ETH`);
            
            await sendETHBack(newWallet.privateKey, mainSigner.address, ethers.utils.parseUnits(fundingAmount, 18));
            
            await sleep(cycleDelay);
            return volumeBotV3Fresh(contractAddress, multiTokens, fundingAmount, BUYSELL, cycleDelay);
        }
        
        // Check if we have enough balance for gas
        if (currentBalance.lt(totalSwapGasCost)) {
            throw new Error(`Insufficient balance for swap gas. Need ${totalSwapGasCostETH} ETH, have ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
        }
        
        console.log(`✅ Swap gas cost within limits, proceeding with volume transaction`);
        
        // Send volume swap transaction
        const swapTransaction = await connectedNewWallet.sendTransaction({
            ...swapTx,
            gasLimit: swapGasLimit,
            gasPrice: swapGasPrice,
            nonce: swapNonce,
            type: 0 // Force legacy transaction type
        });
        
        console.log(`Volume swap transaction sent: ${swapTransaction.hash}`);
        
        // Wait for confirmation
        let swapReceipt;
        let swapSuccess = false;
        
        try {
            swapReceipt = await Promise.race([
                swapTransaction.wait(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Transaction timeout")), 120000)
                )
            ]);
        } catch (waitError) {
            console.error(`Transaction wait failed: ${waitError.message}`);
            
            await sleep(3000);
            try {
                swapReceipt = await provider.getTransactionReceipt(swapTransaction.hash);
                if (!swapReceipt) {
                    throw new Error("Transaction not found");
                }
            } catch (receiptError) {
                console.error(`Failed to get receipt: ${receiptError.message}`);
                swapReceipt = null;
            }
        }
        
        if (swapReceipt && swapReceipt.status === 1) {
            const actualGasUsed = swapReceipt.gasUsed;
            const actualGasCost = swapGasPrice.mul(actualGasUsed);
            const actualGasCostETH = ethers.utils.formatUnits(actualGasCost, 18);
            const gasEfficiency = ((actualGasUsed.toNumber() / swapGasLimit.toNumber()) * 100).toFixed(1);
            
            console.log(`✅ Volume swap SUCCESS: ${swapReceipt.transactionHash}`);
            console.log(`⛽ Gas used: ${actualGasUsed.toString()} (estimated: ${swapGasLimit.toString()})`);
            console.log(`💰 Actual gas cost: ${actualGasCostETH} ETH (estimated: ${totalSwapGasCostETH} ETH)`);
            console.log(`📊 Gas efficiency: ${gasEfficiency}%`);
            
            // Try to parse swap events
            try {
                const swapExecutedEvent = swapReceipt.logs.find(log => {
                    try {
                        const parsed = contract.interface.parseLog(log);
                        return parsed.name === 'SwapExecuted';
                    } catch (e) {
                        return false;
                    }
                });
                
                if (swapExecutedEvent) {
                    const parsed = contract.interface.parseLog(swapExecutedEvent);
                    console.log(`📊 Volume swap executed for recipient: ${parsed.args.recipient}`);
                }
            } catch (eventError) {
                console.log(`Could not parse swap events: ${eventError.message}`);
            }
            
            swapSuccess = true;
        } else {
            console.log(`❌ Volume swap FAILED: ${swapReceipt?.transactionHash || swapTransaction.hash}`);
        }
        
        // Step 6: Send remaining ETH back to main wallet
        console.log(`Transferring remaining ETH back to main wallet...`);
        
        await sleep(1000); // Wait for balance to update
        
        await sendETHBack(newWallet.privateKey, mainSigner.address, ethers.utils.parseUnits(fundingAmount, 18));
        
        // Final balances
        const finalMainBalance = await provider.getBalance(mainSigner.address);
        const finalNewWalletBalance = await provider.getBalance(connectedNewWallet.address);
        
        console.log(`Final main wallet balance: ${ethers.utils.formatUnits(finalMainBalance, 18)} ETH`);
        console.log(`Final fresh wallet balance: ${ethers.utils.formatUnits(finalNewWalletBalance, 18)} ETH`);
        
        // Prepare result object
        const result = {
            success: swapSuccess,
            swapType: 'V3_Fresh_Volume',
            newWalletAddress: newWallet.address,
            newWalletPrivateKey: newWallet.privateKey,
            fundingTxHash: fundingTransaction.hash,
            swapTxHash: swapReceipt?.transactionHash || swapTransaction.hash,
            actualFundingGasCost: actualFundingGasCostETH,
            actualSwapGasCost: swapSuccess ? ethers.utils.formatUnits(swapGasPrice.mul(swapReceipt.gasUsed), 18) : '0',
            gasEfficiency: swapSuccess ? ((swapReceipt.gasUsed.toNumber() / swapGasLimit.toNumber()) * 100).toFixed(1) : '0',
            contractAddress: contractAddress
        };
        
        console.log('Fresh Volume V3 Result:', result);
        console.log(`🔄 Fresh volume cycle completed. Starting next cycle in ${cycleDelay}ms...`);
        
        // Wait before next cycle
        await sleep(cycleDelay);
        
        // Recursively call for continuous operation
        return volumeBotV3Fresh(contractAddress, multiTokens, fundingAmount, BUYSELL, cycleDelay);
        
    } catch (err) {
        console.error(`Error in volumeBotV3Fresh:`, err.message);
        console.log(`🔄 Error occurred. Attempting to recover ETH...`);
        
        // Try to recover ETH even on error
        if (provider && mainSigner && newWallet) {
            try {
                await sendETHBack(newWallet.privateKey, mainSigner.address);
                console.log(`✅ ETH successfully recovered after error`);
            } catch (recoveryError) {
                console.error(`❌ Failed to recover ETH after error:`, recoveryError.message);
            }
        }
        
        console.log(`🔄 Retrying fresh volume in ${Math.max(cycleDelay, 5000)}ms...`);
        
        // Wait before retrying (longer delay on error)
        await sleep(Math.max(cycleDelay, 5000));
        
        // Continue the loop even after error
        return volumeBotV3Fresh(contractAddress, multiTokens, fundingAmount, BUYSELL, cycleDelay);
    }
}

async function airdropAndSwapV2(tokenAddress, walletCount = 10, amountPerWallet = "0.00001", delayBetweenSteps = 2000) {
    try {
        if (!config.fundingPrivateKey) {
            throw new Error('PK_MAIN not configured in .env file');
        }

        // Get gas max limit from config
        const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
            config.gasSettings.gasMax : 
            config.gasSettings.gasMax.toString();
        const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
        
        log(`🚀 Starting airdrop-and-swapv2 process:`);
        log(`• Wallet count: ${walletCount}`);
        log(`• Amount per wallet: ${amountPerWallet} ETH`);
        log(`• Token address: ${tokenAddress || 'random V2 token'}`);
        log(`• Delay between steps: ${delayBetweenSteps}ms`);
        log(`• Gas max limit: ${gasMaxETH} ETH`);
        
        const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
        console.log(`Main wallet: ${mainSigner.address}`);
        
        // GENERATE NEW WALLETS
        log(`\n🔑 === GENERATING ${walletCount} NEW WALLETS ===`);
        const newWallets = [];
        
        for (let i = 0; i < walletCount; i++) {
            const wallet = ethers.Wallet.createRandom();
            const walletData = [wallet.address, wallet.privateKey];
            newWallets.push(walletData);
            
            // Save each wallet immediately to file
            savePrivateKey(walletData);
            
            log(`Created wallet ${i + 1}: ${wallet.address}`);
            
            if ((i + 1) % 5 === 0) {
                log(`Generated ${i + 1}/${walletCount} wallets...`);
            }
        }
        
        log(`✅ Successfully generated and saved ${walletCount} new wallets to wallets.json`);
        
        // Step 1: AIRDROP ETH TO WALLETS
        log(`\n💸 === STEP 1: AIRDROPPING ETH ===`);
        
        const totalEthAmount = parseFloat(amountPerWallet) * walletCount;
        log(`Airdropping total ${totalEthAmount} ETH to ${walletCount} wallets`);
        
        // Check main wallet balance
        const mainBalance = await provider.getBalance(mainSigner.address);
        const totalRequired = ethers.utils.parseUnits(totalEthAmount.toString(), 18);
        
        if (mainBalance.lt(totalRequired.mul(2))) { // 2x buffer for gas costs
            throw new Error(`Insufficient balance. Need ~${totalEthAmount * 2} ETH but have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
        }
        
        // Execute airdrop using new wallets
        const airdropResult = await sendAirdropWallets(0, walletCount, newWallets, totalEthAmount);
        
        if (!airdropResult.success) {
            throw new Error(`Airdrop failed: ${airdropResult.reason || 'Unknown error'}`);
        }
        
        log(`✅ Airdrop completed successfully: ${airdropResult.transactionHash}`);
        log(`💰 Distributed: ${airdropResult.totalAmount} ETH to ${airdropResult.recipients} wallets`);
        
        // Wait for balances to settle
        log(`⏱️  Waiting ${delayBetweenSteps}ms for balances to update...`);
        await sleep(delayBetweenSteps);
        
        // Step 2: EXECUTE MULTI-SWAPS VIA CONTRACT
        log(`\n🔄 === STEP 2: EXECUTING MULTI-SWAPS VIA CONTRACT ===`);
        
        const swapToken = tokenAddress || random(defaultTokens["V2"]);
        log(`Using V2 token: ${swapToken}`);
        
        let successfulSwaps = 0;
        let failedSwaps = 0;
        let gasLimitExceeded = 0;
        const swapResults = [];
        
        // Execute multi-swaps for each new wallet using the contract
        for (let i = 0; i < walletCount; i++) {
            try {
                log(`🔄 Executing multi-swap for wallet ${i}...`);
                
                // Call executeMultiSwap with the token as an array and V2 version
                const result = await executeMultiSwap(i, newWallets, [swapToken], "V2");
                swapResults.push(result);
                
                if (result && result.success) {
                    successfulSwaps++;
                    log(`✅ Wallet ${i}: Multi-swap successful - ${result.txHash}`);
                    if (result.gasEfficiency) {
                        log(`   Gas efficiency: ${result.gasEfficiency}%`);
                    }
                    if (result.valueSent) {
                        log(`   Value sent to contract: ${result.valueSent} ETH`);
                    }
                } else if (result && result.reason === 'gas_cost_exceeds_max') {
                    gasLimitExceeded++;
                    log(`💰 Wallet ${i}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                } else {
                    failedSwaps++;
                    const reason = result?.reason || 'unknown';
                    log(`❌ Wallet ${i}: Failed - ${reason}`);
                }
                
                // Small delay between swaps
                await sleep(100);
                
            } catch (err) {
                failedSwaps++;
                log(`💥 Wallet ${i}: Error - ${err.message}`);
                swapResults.push({ success: false, reason: err.message, walletIndex: i });
            }
        }
        
        log(`\n📊 Multi-Swap Results:`);
        log(`• Successful swaps: ${successfulSwaps}/${walletCount}`);
        log(`• Failed swaps: ${failedSwaps}`);
        log(`• Gas limit exceeded: ${gasLimitExceeded}`);
        log(`• Success rate: ${((successfulSwaps / walletCount) * 100).toFixed(2)}%`);
        
        // Wait before checking remaining balances
        log(`⏱️  Waiting ${delayBetweenSteps}ms before balance check...`);
        await sleep(delayBetweenSteps);
        
        // Step 3: CHECK REMAINING BALANCES AND RECOVER IF > 0.000005 ETH
        log(`\n💸 === STEP 3: CHECKING REMAINING ETH ===`);
        
        let totalRecovered = ethers.BigNumber.from("0");
        let successfulRecoveries = 0;
        let failedRecoveries = 0;
        let skippedRecoveries = 0;
        
        // Minimum balance threshold for recovery
        const minRecoveryBalance = ethers.utils.parseUnits("0.000005", 18); // 0.000005 ETH threshold
        
        for (let i = 0; i < walletCount; i++) {
            try {
                const walletSigner = new ethers.Wallet(newWallets[i][1], provider);
                const currentBalance = await provider.getBalance(walletSigner.address);
                
                log(`🔍 Wallet ${i} balance: ${ethers.utils.formatUnits(currentBalance, 18)} ETH`);
                
                if (currentBalance.gt(minRecoveryBalance)) {
                    log(`💰 Recovering ETH from wallet ${i} (balance > 0.000005 ETH)...`);
                    
                    // Check gas cost for recovery before executing
                    const transferGasCost = await checkTransferGasCost(newWallets[i][1], mainSigner.address, gasMaxWei, gasMaxETH);
                    
                    if (transferGasCost.withinLimit) {
                        await sendETHBackNonAsync(newWallets[i][1], mainSigner.address, currentBalance);
                        
                        // Check how much was recovered
                        const balanceAfter = await provider.getBalance(walletSigner.address);
                        const recovered = currentBalance.sub(balanceAfter);
                        totalRecovered = totalRecovered.add(recovered);
                        
                        successfulRecoveries++;
                        log(`✅ Wallet ${i}: Recovered ~${ethers.utils.formatUnits(recovered, 18)} ETH`);
                    } else {
                        failedRecoveries++;
                        log(`❌ Wallet ${i}: Recovery skipped - Gas cost ${transferGasCost.gasCostETH} ETH exceeds limit`);
                    }
                } else {
                    skippedRecoveries++;
                    log(`⚠️  Wallet ${i}: Balance too low for recovery (< 0.000005 ETH)`);
                }
                
                // Small delay between recoveries
                await sleep(200);
                
            } catch (err) {
                failedRecoveries++;
                // errorLog(`Failed to recover from wallet ${i}: ${err.message}`);
            }
        }
        
        log(`\n📊 ETH Recovery Results:`);
        log(`• Successful recoveries: ${successfulRecoveries}/${walletCount}`);
        log(`• Failed recoveries: ${failedRecoveries}`);
        log(`• Skipped recoveries (balance < 0.000005 ETH): ${skippedRecoveries}`);
        log(`• Total ETH recovered: ${ethers.utils.formatUnits(totalRecovered, 18)} ETH`);
        
        // Final summary
        const finalMainBalance = await provider.getBalance(mainSigner.address);
        log(`\n🎯 === FINAL SUMMARY ===`);
        log(`📊 Operation Results:`);
        log(`• New wallets created: ${walletCount}`);
        log(`• ETH distributed: ${totalEthAmount} ETH`);
        log(`• Successful multi-swaps: ${successfulSwaps}/${walletCount} (${((successfulSwaps / walletCount) * 100).toFixed(2)}%)`);
        log(`• ETH recovered (> 0.000005 ETH): ${ethers.utils.formatUnits(totalRecovered, 18)} ETH`);
        log(`• Final main wallet balance: ${ethers.utils.formatUnits(finalMainBalance, 18)} ETH`);
        
        // Calculate net cost
        const netCost = totalEthAmount - parseFloat(ethers.utils.formatUnits(totalRecovered, 18));
        log(`💰 Net cost: ~${netCost.toFixed(6)} ETH`);
        
        return {
            success: true,
            swapType: 'V2',
            walletsCreated: walletCount,
            newWallets: newWallets,
            airdropResult,
            swapResults: {
                successful: successfulSwaps,
                failed: failedSwaps,
                gasLimitExceeded,
                successRate: ((successfulSwaps / walletCount) * 100).toFixed(2),
                details: swapResults
            },
            recoveryResults: {
                successful: successfulRecoveries,
                failed: failedRecoveries,
                skipped: skippedRecoveries,
                totalRecovered: ethers.utils.formatUnits(totalRecovered, 18)
            },
            netCost: netCost.toFixed(6)
        };
        
    } catch (err) {
        errorLog(`❌ airdrop-and-swapv2 failed: ${err.message}`);
        throw err;
    }
}

async function airdropAndSwapV3(tokenAddress, preGeneratedWallets, amountPerWallet = "0.00001", delayBetweenSteps = 100) {
    // Use setTimeout instead of await for non-blocking execution
    setTimeout(async () => {
        try {
            if (!config.fundingPrivateKey) {
                throw new Error('PK_MAIN not configured in .env file');
            }

            const walletCount = preGeneratedWallets.length;

            // Get gas max limit from config
            const gasMaxETH = typeof config.gasSettings.gasMax === 'string' ? 
                config.gasSettings.gasMax : 
                config.gasSettings.gasMax.toString();
            const gasMaxWei = ethers.utils.parseUnits(gasMaxETH, 18);
            
            log(`🚀 Starting optimized airdrop-and-swapv3 process:`);
            log(`• Pre-generated wallets: ${walletCount}`);
            log(`• Amount per wallet: ${amountPerWallet} ETH`);
            log(`• Token address: ${tokenAddress || 'random V3 token'}`);
            log(`• Delay between steps: ${delayBetweenSteps}ms`);
            log(`• Gas max limit: ${gasMaxETH} ETH`);
            
            
            
            // Execute airdrop using pre-generated wallets
            
            
            // Wait for balances to settle (non-blocking)
            log(`⏱️  Waiting ${delayBetweenSteps}ms for balances to update...`);
            setTimeout(async () => {
                
                // Step 2: EXECUTE MULTI-SWAPS VIA CONTRACT
                log(`\n🔄 === STEP 2: EXECUTING MULTI-SWAPS VIA CONTRACT ===`);
                
                const swapToken = tokenAddress || random(defaultTokens["V3"]);
                log(`Using token: ${swapToken}`);
                
                let successfulSwaps = 0;
                let failedSwaps = 0;
                let gasLimitExceeded = 0;
                const swapResults = [];
                
                // Execute multi-swaps for each wallet using the contract (parallel processing for speed)
                const swapPromises = [];
                
                for (let i = 0; i < walletCount; i++) {
                    // Create promise but don't await immediately for parallel processing
                    const swapPromise = (async (walletIndex) => {
                        try {
                            log(`🔄 Executing multi-swap for wallet ${walletIndex}...`);
                            
                            // Call executeMultiSwap with the token as an array and V3 version
                            const result = await executeMultiSwap(walletIndex, preGeneratedWallets, [swapToken], "V3");
                            
                            if (result && result.success) {
                                successfulSwaps++;
                                log(`✅ Wallet ${walletIndex}: Multi-swap successful - ${result.txHash}`);
                                if (result.gasEfficiency) {
                                    log(`   Gas efficiency: ${result.gasEfficiency}%`);
                                }
                                if (result.valueSent) {
                                    log(`   Value sent to contract: ${result.valueSent} ETH`);
                                }
                            } else if (result && result.reason === 'gas_cost_exceeds_max') {
                                gasLimitExceeded++;
                                log(`💰 Wallet ${walletIndex}: Skipped - Gas cost ${result.gasRequested} ETH exceeds limit ${result.gasMaxAllowed} ETH`);
                            } else {
                                failedSwaps++;
                                const reason = result?.reason || 'unknown';
                                log(`❌ Wallet ${walletIndex}: Failed - ${reason}`);
                            }
                            
                            return result;
                            
                        } catch (err) {
                            failedSwaps++;
                            log(`💥 Wallet ${walletIndex}: Error - ${err.message}`);
                            return { success: false, reason: err.message, walletIndex };
                        }
                    })(i);
                    
                    swapPromises.push(swapPromise);
                    
                    // Small staggered delay to prevent overwhelming the network
                    if (i < walletCount - 1) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }
                
                // Wait for all swaps to complete
                const allSwapResults = await Promise.allSettled(swapPromises);
                swapResults.push(...allSwapResults.map(result => 
                    result.status === 'fulfilled' ? result.value : { success: false, reason: 'Promise rejected' }
                ));
                
                log(`\n📊 Multi-Swap Results:`);
                log(`• Successful swaps: ${successfulSwaps}/${walletCount}`);
                log(`• Failed swaps: ${failedSwaps}`);
                log(`• Gas limit exceeded: ${gasLimitExceeded}`);
                log(`• Success rate: ${((successfulSwaps / walletCount) * 100).toFixed(2)}%`);
                
                // Wait before checking remaining balances (non-blocking)
                log(`⏱️  Waiting ${delayBetweenSteps}ms before balance check...`);
                
            }, delayBetweenSteps);
            
        } catch (err) {
            errorLog(`❌ airdrop-and-swapv3-optimized failed: ${err.message}`);
            throw err;
        }
    }, 0);
}

const FEE_ADMIN_ABI = [
    // View functions
    "function getMicroTxFee() external view returns(uint)",
    "function getVolumeFee() external view returns(uint)",
    "function getAirdropFee() external view returns(uint)",
    "function getAllFees() external view returns(uint microTx, uint volume, uint airdrop)",
    "function getAdminWallets() external view returns(address[] memory)",
    "function getAdminCount() external view returns(uint)",
    "function isAdmin(address account) external view returns(bool)",
    "function getMyClaimableAmount() external view returns(uint)",
    "function getTotalClaimableAmount() public view returns(uint)",
    "function getLastClaimedBalance(address admin) external view returns(uint)",
    "function getContractStats() external view returns(uint contractBalance, uint totalClaimable, uint totalClaimed, uint adminCount)",
    "function getContractBalance() external view returns(uint)",
    
    // Admin functions
    "function claimFees() external",
    "function claimFeesFor(address admin) external",
    "function claimAllPendingFees() external",
    
    // Events
    "event FeesClaimed(address indexed admin, uint amount)",
    "event FeesReceived(address indexed from, uint amount)"
];

// Fee contract configuration
const FEE_CONTRACT_CONFIG = {
    // Replace with your actual deployed contract address
    address: contracts.basedBonkFees, // TODO: Update with real address
    abi: FEE_ADMIN_ABI
};

// Main execution function
async function main() {
    const command = process.argv[2];
    const args = process.argv.slice(3);

    const walletsSaved = await loadWallets()

    const feeContract = new ethers.Contract(FEE_CONTRACT_CONFIG.address, FEE_CONTRACT_CONFIG.abi, provider);



    if (command === 'help' || command === '--help' || command === '-h') {
        // showHelp();
        return;
    }

    let mainWallet, mainSigner, startAt, endAt, tokenAddress, tokens, wallets, successCount, failCount, delayBetweenTx, delayBetweenCycles, delayOnError, getDynamicDelay
    try {
        
        switch (command) {

            case 'getFeeStats':
            try {
                console.log('📊 Fetching fee contract statistics...');
                
                // Get all contract data
                const [
                    contractBalance,
                    contractStats, 
                    allFees,
                    adminWallets,
                    isMainAdmin,
                    mainClaimableAmount,
                    mainLastClaimedBalance
                ] = await Promise.all([
                    provider.getBalance(FEE_CONTRACT_ADDRESS),
                    feeContract.getContractStats(),
                    feeContract.getAllFees(),
                    feeContract.getAdminWallets(),
                    feeContract.isAdmin(mainWallet.address),
                    feeContract.getMyClaimableAmount(),
                    feeContract.getLastClaimedBalance(mainWallet.address)
                ]);

                // Format response data
                const response = {
                    success: true,
                    contractAddress: FEE_CONTRACT_CONFIG.address,
                    mainWalletAddress: mainWallet.address,
                    
                    // Contract balances
                    contractBalance: ethers.utils.formatEther(contractStats.contractBalance),
                    totalClaimable: ethers.utils.formatEther(contractStats.totalClaimable), 
                    totalClaimed: ethers.utils.formatEther(contractStats.totalClaimed),
                    
                    // Admin information
                    adminCount: contractStats.adminCount.toNumber(),
                    adminWallets: adminWallets,
                    isAdmin: isMainAdmin,
                    
                    // Main wallet specific data
                    myClaimableAmount: ethers.utils.formatEther(mainClaimableAmount),
                    lastClaimedBalance: ethers.utils.formatEther(mainLastClaimedBalance),
                    
                    // Fee structure
                    fees: {
                        microTx: ethers.utils.formatEther(allFees.microTx),
                        volume: ethers.utils.formatEther(allFees.volume),
                        airdrop: ethers.utils.formatEther(allFees.airdrop)
                    }
                };

                console.log(`✅ Fee Stats Retrieved:`);
                console.log(`   Contract Balance: ${response.contractBalance} ETH`);
                console.log(`   Total Claimable: ${response.totalClaimable} ETH`);
                console.log(`   Admin Count: ${response.adminCount}`);
                console.log(`   Is Admin: ${response.isAdmin}`);
                console.log(`   My Claimable: ${response.myClaimableAmount} ETH`);

                return response;

            } catch (error) {
                console.error('❌ Error fetching fee stats:', error.message);
            }
            break;
            // Wallet management
            case 'create':
                await createWallets(parseInt(args[0]) || config.defaultWalletCount);
                break;
                
            case 'target':
                await createWalletsToTarget(parseInt(args[0]) || config.defaultWalletCount);
                break;
                
            case 'check':
                await checkWallets();
                break;

             case 'stats':
                // Display detailed statistics
                const { getLiveStats, getDailyStats, getStatsSummary } = require('./stats-tracker');
                const summary = getStatsSummary();
                
                console.log('\n📊 === DETAILED STATISTICS ===');
                console.log('\n🔴 LIVE STATS:');
                console.log(`   Total Transactions: ${summary.live.totalTransactions}`);
                console.log(`   Successful: ${summary.live.successfulTransactions}`);
                console.log(`   Failed: ${summary.live.failedTransactions}`);
                console.log(`   Success Rate: ${summary.live.successRate}%`);
                console.log(`   Total Gas Cost: ${summary.live.totalGasCost} ETH`);
                console.log(`   Funded Wallets: ${summary.live.fundedWallets}`);
                
                console.log('\n📅 TODAY\'S STATS:');
                console.log(`   Transactions: ${summary.today.totalTransactions}`);
                console.log(`   Successful: ${summary.today.successfulTransactions}`);
                console.log(`   Failed: ${summary.today.failedTransactions}`);
                console.log(`   Gas Cost: ${summary.today.totalGasCost} ETH`);
                
                console.log('\n🗓️  THIS MONTH:');
                console.log(`   Transactions: ${summary.thisMonth.totalTransactions}`);
                console.log(`   Successful: ${summary.thisMonth.successfulTransactions}`);
                console.log(`   Failed: ${summary.thisMonth.failedTransactions}`);
                console.log(`   Gas Cost: ${summary.thisMonth.totalGasCost} ETH`);
                
                console.log('\n💼 OPERATION BREAKDOWN (Today):');
                Object.entries(summary.today.operationTypes).forEach(([type, count]) => {
                    if (count > 0) {
                        console.log(`   ${type}: ${count}`);
                    }
                });
                break;
             case 'balances':
                getWalletBalances()
                break;
               
            case 'airdrop-and-swapv2':
            const tokenAddressV2 = args[0] || null;
            const walletCountV2 = parseInt(args[1]) || 10;
            const amountPerWalletV2 = args[2] || "0.00001";
            const delayBetweenStepsV2 = parseInt(args[3]) || 2000;

            if(!tokenAddressV2){
                throw Error(`You must pass the token address! node script.js airdrop-and-swapv2 [tokenAddress] [numberOfWallets] [valuePerWalletInETH]`)
            }
            
            log(`🚀 Starting airdrop-and-swapv2 with ${walletCountV2} wallets`);
            const resultV2 = await airdropAndSwapV2(tokenAddressV2, walletCountV2, amountPerWalletV2, delayBetweenStepsV2);
            
            if (resultV2.success) {
                log(`✅ airdrop-and-swapv2 completed successfully!`);
                log(`💰 Net cost: ${resultV2.netCost} ETH`);
            } else {
                log(`❌ airdrop-and-swapv2 failed`);
            }
            break;

            case 'airdrop-and-swapv3':
    const tokenAddressV3 = args[0] || null;
    const walletCount = parseInt(args[1]) || 10;
    const amountPerWallet = args[2] || "0.00001";
    const delayBetweenSteps = parseInt(args[3]) || 200;
    const delayBetweenRuns = parseInt(args[4]) || 600;
    const maxRuns = parseInt(args[5]) || 0; // 0 = infinite

    if(!tokenAddressV3){
        throw Error(`You must pass the token address! node script.js airdrop-and-swapv3 [tokenAddress] [numberOfWallets] [valuePerWalletInETH] [delayBetweenSteps] [delayBetweenRuns] [maxRuns]`)
    }
    
    log(`🚀 Starting continuous airdrop-and-swapv3 with ${walletCount} wallets`);
    log(`⏰ Will run every ${delayBetweenRuns}ms`);
    log(`🔄 Max runs: ${maxRuns === 0 ? 'Infinite' : maxRuns}`);
    
    let runCount = 0;
    let totalCost = 0;
    
    while (maxRuns === 0 || runCount < maxRuns) {
        try {
            runCount++;
            log(`\n📊 Run #${runCount}/${maxRuns === 0 ? '∞' : maxRuns} - ${new Date().toISOString()}`);
            
            // PRE-GENERATE WALLETS IN HANDLER FOR PERFORMANCE
            log(`🔑 Pre-generating ${walletCount} wallets for run #${runCount}...`);
            const preGeneratedWallets = [];
            
            for (let i = 0; i < walletCount; i++) {
                const wallet = ethers.Wallet.createRandom();
                const walletData = [wallet.address, wallet.privateKey];
                preGeneratedWallets.push(walletData);
                
                // Save each wallet immediately to file
                savePrivateKey(walletData);
                
                if ((i + 1) % 10 === 0 || i === walletCount - 1) {
                    log(`Generated ${i + 1}/${walletCount} wallets...`);
                }
            }


            const mainSigner = new ethers.Wallet(config.fundingPrivateKey, provider);
            console.log(`Main wallet: ${mainSigner.address}`);

            const amountPerWalletBN = ethers.utils.parseUnits(amountPerWallet, 18);
            const totalRequired = amountPerWalletBN.mul(walletCount);
            const totalEthAmount = ethers.utils.formatUnits(totalRequired, 18);
            
            log(`Airdropping total ${totalEthAmount} ETH to ${walletCount} wallets`);
            
            // Check main wallet balance

            const mainBalance = await provider.getBalance(mainSigner.address);
            
            if (mainBalance.lt(totalRequired.mul(2))) { // 2x buffer for gas costs
                throw new Error(`Insufficient balance. Need ~${totalEthAmount * 2} ETH but have ${ethers.utils.formatUnits(mainBalance, 18)} ETH`);
            }
            
            log(`✅ Pre-generated ${walletCount} wallets for run #${runCount}`);

            log(`✅ Using ${walletCount} pre-generated wallets`);
            
            // Step 1: AIRDROP ETH TO WALLETS
            log(`\n💸 === STEP 1: AIRDROPPING ETH ===`);
            
           

            const airdropResult = await sendAirdropWallets(0, walletCount, preGeneratedWallets, totalEthAmount);
            
            if (!airdropResult.success) {
                throw new Error(`Airdrop failed: ${airdropResult.reason || 'Unknown error'}`);
            }
            
            log(`✅ Airdrop completed successfully: ${airdropResult.transactionHash}`);
            log(`💰 Distributed: ${airdropResult.totalAmount} ETH to ${airdropResult.recipients} wallets`);
            // let confirmed = 0
            // Call the optimized function with pre-generated wallets (no await for speed)
            airdropAndSwapV3(tokenAddressV3, preGeneratedWallets, amountPerWallet, delayBetweenSteps);
            
            log(`🚀 Run #${runCount} initiated (non-blocking)`);
            
            // Break if we've reached max runs
            if (maxRuns > 0 && runCount >= maxRuns) {
                log(`🏁 Initiated all ${maxRuns} runs.`);
                break;
            }
            
            log(`⏳ Waiting ${delayBetweenRuns}ms before next run...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenRuns));
            
        } catch (error) {
            log(`💥 Error in run #${runCount}: ${error.message}`);
            log(`⏳ Waiting ${delayBetweenRuns}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenRuns));
        }
    }
    break;
                

            case 'airdrop-batch':
                var chunkSize = parseInt(args[0]) || config.defaultChunkSize;
                var totalEthForBatch = args[1] ? parseFloat(args[1]) : null;
                var startAtAirdropBatch = args[2] ? parseInt(args[2]) : 0;
                var endAtAirdropBatch = args[3] ? parseInt(args[3]) : null;
                var delayBetweenChunks = parseInt(args[4]) || 3000;

             
                await airdropBatch(chunkSize, totalEthForBatch, startAtAirdropBatch, endAtAirdropBatch, delayBetweenChunks);
                break;
                
            case 'swap-batch':
                tokenAddress = args[1] || random(defaultTokens['V2']);
                var delayBetweenBatches = parseInt(args[2]) || 100;
                delayBetweenTx = parseInt(args[3]) || 50;
                await swapBatch(parseInt(args[0]) || config.defaultBatchSize, tokenAddress, delayBetweenBatches, delayBetweenTx);
                break;
                
            case 'multiswap-batch':
                tokens = args[1] ? args[1].split(',') : defaultTokens['V2'];
                delayBetweenBatches = parseInt(args[2]) || 2000;
                delayBetweenTx = parseInt(args[3]) || 100;
                await multiSwapBatch(parseInt(args[0]) || config.defaultBatchSize, tokens, delayBetweenBatches, delayBetweenTx);
                break;
                
            case 'swapv3-batch':
                wallets = loadWallets();
                tokenAddress = args[1] ? args[1].split(',') : defaultTokens["V3"];
                startAt = Number(args[2]) || 0
                endAt = Number(args[3]) || wallets.length
                delayBetweenBatches = parseInt(args[4]) || 2000;
                delayBetweenTx = parseInt(args[5]) || 100;
                await v3SwapBatch(parseInt(args[0]) || config.defaultBatchSize, tokenAddress, startAt, endAt, delayBetweenBatches, delayBetweenTx);
                break;
                
            case 'airdrop':
                wallets = loadWallets();
                if (wallets.length === 0) throw new Error('No wallets found');
                startAt = parseInt(args[0]) || 0;
                endAt = parseInt(args[1]) || wallets.length;
                const totalEthForRange = args[2] ? parseFloat(args[2]) : null;
                const result = await sendAirdropWallets(startAt, endAt, wallets, totalEthForRange);
                if (result.success) {
                    log(`✅ Airdrop completed: ${result.transactionHash}`);
                } else {
                    log(`❌ Airdrop failed: ${result.reason || result.error}`);
                }
                break;
                
            case 'swap':
                wallets = loadWallets();
                if (wallets.length === 0) throw new Error('No wallets found');
                startAt = parseInt(args[0]) || 0;
                endAt = parseInt(args[1]) || wallets.length;
                tokenAddress = args[2] || random(defaultTokens["V2"]);
                
                successCount = 0;
                failCount = 0;
                
                for (let i = startAt; i < Math.min(endAt, wallets.length); i++) {
                    try {
                        const result = await executeSwap(i, wallets, tokenAddress);
                        if (result && result.success) {
                            successCount++;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                        } else {
                            failCount++;
                            log(`❌ Wallet ${i}: Failed - ${result.reason || 'unknown'}`);
                        }
                    } catch (err) {
                        failCount++;
                        log(`💥 Wallet ${i}: Error - ${err.message}`);
                    }
                    await sleep(50);
                }
                
                log(`Swap range completed: ${successCount} successful, ${failCount} failed`);
                break;
                
            case 'multiswap':
            
            // Parse parameters correctly for batch function
            const batchSizeV2 = parseInt(args[0]) || config.defaultBatchSize || 50;
            const tokenAddressesV2 = args[1] ? args[1].trim() : null; // comma-separated string
            const delayBetweenBatchesV2 = parseInt(args[4]) || 2000;
            const delayBetweenTxV2 = parseInt(args[5]) || 100;

            const fundedWalletsV2 = args[6];
            let walletsV2Funded = fundedWalletsV2 == 'yes' ? await loadWalletsBalanceSortedArray() : loadWallets();
            if (walletsV2Funded.length === 0) throw new Error('No wallets found');

            const startAtV2 = fundedWalletsV2 == 'yes' ? 0 : parseInt(args[2]) || 0;
            const endAtV2 =  fundedWalletsV2 == 'yes' ? walletsV2Funded.length : parseInt(args[3]) || walletsV2Funded.length;
           
            log(`Starting V2 Multi-Swap batch operation:`);
            log(`• Batch size: ${batchSizeV2}`);
            log(`• Token addresses: ${tokenAddressesV2 || 'using defaults'}`);
            log(`• Wallet range: ${startAtV2} to ${endAtV2}`);
            log(`• Delay between batches: ${delayBetweenBatchesV2}ms`);
            log(`• Delay between transactions: ${delayBetweenTxV2}ms`);

            try {
                // Call the batch function once with all parameters
                const batchResult = await multiSwapV2Batch(
                    walletsV2Funded,
                    batchSizeV2,
                    tokenAddressesV2,
                    startAtV2,
                    endAtV2,
                    delayBetweenBatchesV2,
                    delayBetweenTxV2
                );

                // Log final results
                log(`\n🎯 V2 Multi-Swap Batch Operation Complete!`);
                log(`📊 Results Summary:`);
                log(`   • Total wallets processed: ${batchResult.totalProcessed}`);
                log(`   • Successful multi-swaps: ${batchResult.successfulSwaps}`);
                log(`   • Failed multi-swaps: ${batchResult.failedSwaps}`);
                log(`   • Gas limit exceeded: ${batchResult.gasLimitExceeded}`);
                log(`   • Success rate: ${batchResult.successRate}%`);
                log(`   • Total tokens swapped: ${batchResult.totalTokensSwapped}`);
                log(`   • Average tokens per successful wallet: ${batchResult.averageTokensPerWallet}`);
                log(`   • Batches processed: ${batchResult.batchesProcessed}`);
                log(`   • Router type: ${batchResult.routerType}`);

                if (batchResult.customTokensUsed > 0) {
                    log(`   • Custom tokens used: ${batchResult.customTokensUsed}`);
                }

            } catch (err) {
                log(`❌ V2 Multi-Swap batch operation failed: ${err.message}`);
                throw err;
            }
            break;
            
            case 'multiswapV3':
            
            
            // Parse parameters correctly for batch function
            const batchSizeV3 = parseInt(args[0]) || config.defaultBatchSize || 50;
            const tokenAddressesV3 = args[1] ? args[1].trim() : null; // comma-separated string
            
            const delayBetweenBatchesV3 = parseInt(args[4]) || 2000;
            const delayBetweenTxV3 = parseInt(args[5]) || 100;
            const fundedWallets = args[6];
            let walletsV3Funded = fundedWallets == 'yes' ? await loadWalletsBalanceSortedArray() : loadWallets();
            if (walletsV3Funded.length === 0) throw new Error('No wallets found');

            const startAtV3 = fundedWallets == 'yes' ? 0 : parseInt(args[2]) || 0;
            const endAtV3 =  fundedWallets == 'yes' ? walletsV3Funded.length : parseInt(args[3]) || walletsV3Funded.length;

          

            log(`Starting V3 Multi-Swap batch operation:`);
            log(`• Batch size: ${batchSizeV3}`);
            log(`• Token addresses: ${tokenAddressesV3 || 'using defaults'}`);
            log(`• Wallet range: ${startAtV3} to ${endAtV3}`);
            log(`• Delay between batches: ${delayBetweenBatchesV3}ms`);
            log(`• Delay between transactions: ${delayBetweenTxV3}ms`);

     

            try {
                // Call the batch function once with all parameters
                const batchResult = await multiSwapV3Batch(
                    walletsV3Funded,
                    batchSizeV3,
                    tokenAddressesV3,
                    startAtV3,
                    endAtV3,
                    delayBetweenBatchesV3,
                    delayBetweenTxV3
                );

                // Log final results
                log(`\n🎯 V3 Multi-Swap Batch Operation Complete!`);
                log(`📊 Results Summary:`);
                log(`   • Total wallets processed: ${batchResult.totalProcessed}`);
                log(`   • Successful multi-swaps: ${batchResult.successfulSwaps}`);
                log(`   • Failed multi-swaps: ${batchResult.failedSwaps}`);
                log(`   • Gas limit exceeded: ${batchResult.gasLimitExceeded}`);
                log(`   • Success rate: ${batchResult.successRate}%`);
                log(`   • Total tokens swapped: ${batchResult.totalTokensSwapped}`);
                log(`   • Average tokens per successful wallet: ${batchResult.averageTokensPerWallet}`);
                log(`   • Batches processed: ${batchResult.batchesProcessed}`);

                if (batchResult.customTokensUsed > 0) {
                    log(`   • Custom tokens used: ${batchResult.customTokensUsed}`);
                }

            } catch (err) {
                log(`❌ V3 Multi-Swap batch operation failed: ${err.message}`);
                throw err;
            }
            break;

            case 'create-and-swap':
                tokenAddress = args[0] ? args[0].split(',') : null;
                var cycleDelay = parseInt(args[1]) || 2000;
                var fundingAmount = args[2] || "0.00001";

                try {
                    await createWalletAndMultiSmall(tokenAddress, cycleDelay, fundingAmount);
                } catch (err) {
                    console.log(err)
                }
                break;
                
            case 'create-and-swapv3':
                tokens = args[0] ? args[0].split(',') : random(defaultTokens["V3"]);
                cycleDelay = parseInt(args[1]) || 3000;
                fundingAmount = args[2] || "0.000005";
                
                try {
                    await createWalletAndMultiSmallV3(tokens, cycleDelay, fundingAmount);
                } catch (err) {
                    console.log(err)
                }
                break;

            case 'create-and-multiswapv3':
                tokens = args[0] ? args[0].split(',') : defaultTokens["V3"];
                cycleDelay = parseInt(args[1]) || 3000;
                fundingAmount = args[2] || "0.000005";
                
                try {
                    await createWalletAndMultiSmallV3(tokens, cycleDelay, fundingAmount);
                } catch (err) {
                    console.log(err)
                }
                break;
            
            case 'recoverETH':
                mainWalletRecover = new ethers.Wallet(config.fundingPrivateKey)
                let pk = args[0];
                let receiver = args[1] || mainWalletRecover.address
                try {
                    await sendETHBack(pk, receiver);
                } catch (err) {
                    console.log(err)
                }
                break;
            
            case 'recoverBulkETH':
    try {
        const walletPublicKeys = args[0].split(',');
        const receiverAddress = new ethers.Wallet(config.fundingPrivateKey);
        const batchSize = args[2] || 5; // Optional batch size
        const batchDelay = 2000; // 2 seconds between batches

        if (!Array.isArray(walletPublicKeys) || walletPublicKeys.length === 0) {
            console.log('❌ No wallet addresses provided');
            break;
        }
        
        // Get private keys from walletsSaved using public keys
        const walletPrivateKeys = walletPublicKeys.map(publicKey => {
            const savedWallet = walletsSaved.find(wallet => 
                wallet[0].toLowerCase() === publicKey.toLowerCase()
            );
            
            if (!savedWallet) {
                console.log(`⚠️ Private key not found for address: ${publicKey}`);
                return null;
            }
            
            return {
                privateKey: savedWallet[1],
                address: savedWallet[0]
            };
        }).filter(wallet => wallet !== null); // Remove null entries
        
        if (walletPrivateKeys.length === 0) {
            console.log('❌ No matching private keys found in walletsSaved');
            break;
        }
        
        console.log(`🚀 Starting bulk ETH recovery for ${walletPrivateKeys.length}/${walletPublicKeys.length} wallets`);
        
        // Recovery state tracking
        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const skippedWallets = walletPublicKeys.length - walletPrivateKeys.length;
        let processedBatches = 0;
        const totalBatches = Math.ceil(walletPrivateKeys.length / batchSize);
        
        if (skippedWallets > 0) {
            log(`⚠️ Skipped ${skippedWallets} wallets (private keys not found)`);
        }
        
        // Function to process a single wallet recovery
        const processWalletRecovery = (walletData, walletIndex, batchIndex) => {
            return new Promise((resolve) => {
                try {
                    const { privateKey, address } = walletData;
                    const globalIndex = batchIndex * batchSize + walletIndex;
                    
                    console.log(`💰 Recovering wallet ${globalIndex + 1}/${walletPrivateKeys.length} (${address})`);
                    
                    // Execute recovery asynchronously
                    sendETHBackNonAsync(privateKey, receiverAddress.address)
                        .then(() => {
                            resolve({ 
                                success: true, 
                                index: globalIndex, 
                                address: address 
                            });
                        })
                        .catch((error) => {
                            resolve({ 
                                success: false, 
                                index: globalIndex, 
                                address: address,
                                error: error.message 
                            });
                        });
                        
                } catch (error) {
                    resolve({ 
                        success: false, 
                        index: batchIndex * batchSize + walletIndex, 
                        address: walletData.address,
                        error: error.message 
                    });
                }
            });
        };
        
        // Function to process a batch
        const processBatch = (batchWallets, batchIndex) => {
            return new Promise((resolve) => {
                log(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batchWallets.length} wallets)`);
                
                // Create promises for all wallets in this batch
                const batchPromises = batchWallets.map((walletData, walletIndex) => 
                    processWalletRecovery(walletData, walletIndex, batchIndex)
                );
                
                // Process all wallets in batch concurrently
                Promise.allSettled(batchPromises)
                    .then((batchResults) => {
                        // Process batch results
                        batchResults.forEach((result) => {
                            if (result.status === 'fulfilled') {
                                if (result.value.success) {
                                    successCount++;
                                    log(`✅ Successfully recovered wallet ${result.value.index + 1} (${result.value.address})`);
                                } else {
                                    errorCount++;
                                    errors.push(result.value);
                                    log(`❌ Failed to recover wallet ${result.value.index + 1} (${result.value.address}): ${result.value.error}`);
                                }
                            } else {
                                errorCount++;
                                const errorData = {
                                    success: false,
                                    error: result.reason?.message || 'Unknown error',
                                    index: batchIndex * batchSize + batchResults.indexOf(result),
                                    address: 'Unknown'
                                };
                                errors.push(errorData);
                                console.log(`❌ Promise rejected for wallet ${errorData.index + 1}: ${errorData.error}`);
                            }
                        });
                        
                        processedBatches++;
                        log(`📊 Batch ${batchIndex + 1} complete. Progress: ${processedBatches}/${totalBatches} batches`);
                        
                        resolve({
                            batchIndex,
                            successCount: batchResults.filter(r => r.status === 'fulfilled' && r.value.success).length,
                            errorCount: batchResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length
                        });
                    })
                    .catch((error) => {
                        console.error(`❌ Batch ${batchIndex + 1} processing error:`, error);
                        resolve({
                            batchIndex,
                            successCount: 0,
                            errorCount: batchWallets.length,
                            error: error.message
                        });
                    });
            });
        };
        
        // Function to schedule next batch
        const scheduleNextBatch = (batchIndex) => {
            if (batchIndex >= totalBatches) {
                // All batches completed - show final summary
                showFinalSummary();
                return;
            }
            
            const startIndex = batchIndex * batchSize;
            const endIndex = Math.min(startIndex + batchSize, walletPrivateKeys.length);
            const batchWallets = walletPrivateKeys.slice(startIndex, endIndex);
            
            processBatch(batchWallets, batchIndex)
                .then((batchResult) => {
                    // Schedule next batch after delay (except for the last batch)
                    if (batchIndex + 1 < totalBatches) {
                        console.log(`⏳ Waiting ${batchDelay / 1000} seconds before next batch...`);
                        setTimeout(() => {
                            scheduleNextBatch(batchIndex + 1);
                        }, batchDelay);
                    } else {
                        // This was the last batch
                        showFinalSummary();
                    }
                })
                .catch((error) => {
                    console.error(`❌ Error scheduling batch ${batchIndex + 1}:`, error);
                    // Continue with next batch even if current one failed
                    if (batchIndex + 1 < totalBatches) {
                        setTimeout(() => {
                            scheduleNextBatch(batchIndex + 1);
                        }, batchDelay);
                    } else {
                        showFinalSummary();
                    }
                });
        };
        
        // Function to show final summary
        const showFinalSummary = () => {
            console.log(`\n🎉 Bulk ETH Recovery Summary:`);
            console.log(`✅ Successful: ${successCount}/${walletPrivateKeys.length}`);
            console.log(`❌ Failed: ${errorCount}/${walletPrivateKeys.length}`);
            if (skippedWallets > 0) {
                console.log(`⚠️ Skipped: ${skippedWallets} (no private keys found)`);
            }
            
            if (errors.length > 0) {
                console.log(`\n📝 Error Details:`);
                errors.forEach(({ index, error, address }) => {
                    console.log(`  Wallet ${index + 1} (${address}): ${error}`);
                });
            }
            
            // Calculate success rate
            const successRate = ((successCount / walletPrivateKeys.length) * 100).toFixed(1);
            console.log(`\n📈 Success Rate: ${successRate}%`);
            
            if (successCount > 0) {
                console.log(`💰 Recovery process completed. Check receiver address for funds.`);
            }
        };
        
        // Start the asynchronous batch processing
        console.log(`🚀 Starting asynchronous processing of ${totalBatches} batches...`);
        scheduleNextBatch(0);
        
        // Immediately return to caller - processing continues in background
        console.log(`⚡ Bulk recovery initiated. Processing ${walletPrivateKeys.length} wallets in background...`);
        
    } catch (error) {
        console.error('❌ Bulk recovery initialization error:', error.message);
    }
    break;
                
            case 'swapv3':
                wallets = loadWallets();
                if (wallets.length === 0) throw new Error('No wallets found');
                startAt = parseInt(args[0]) || 0;
                endAt = parseInt(args[1]) || wallets.length;
                tokenAddress = args[2].split(',')

                 if (!tokenAddress) {
                    throw new Error('Missing contract address');
                }

                successCount = 0;
                failCount = 0;
                
                for (let i = startAt; i < Math.min(endAt, wallets.length); i++) {
                    try {
                        const result = await executeMultiSwap(i, wallets, tokenAddress);
                        if (result && result.success) {
                            successCount++;
                            log(`✅ Wallet ${i}: Success - ${result.txHash}`);
                        } else {
                            failCount++;
                            log(`❌ Wallet ${i}: Failed - ${result.reason || 'unknown'}`);
                        }
                    } catch (err) {
                        failCount++;
                        log(`💥 Wallet ${i}: Error - ${err.message}`);
                    }
                    await sleep(75);
                }
                
                log(`V3 swap range completed: ${successCount} successful, ${failCount} failed`);
                break;
                
            case 'volumeV2':
                wallets = loadWallets();
                if (wallets.length === 0) throw new Error('No wallets found');
                
                startAt = parseInt(args[0]) || 0;
                endAt = parseInt(args[1]) || wallets.length;
                tokenAddress = args[2] || random(defaultTokens["V2"]);
                let v2BuyAndSell = args[3] === "true";
                
                // New timing parameters
                delayBetweenTx = parseInt(args[4]) || 150; // milliseconds between individual transactions
                delayBetweenCycles = parseInt(args[5]) || 3000; // milliseconds between cycles
                delayOnError = parseInt(args[6]) || 1000; // milliseconds when error occurs
            
                if (!config.fundingPrivateKey) {
                    throw new Error('PK_MAIN not configured in .env file');
                }
                
                const mainWalletVolumev2 = new ethers.Wallet(config.fundingPrivateKey);
                
                log(`🎯 Starting VolumeV2 for token: ${tokenAddress}`);
                log(`👛 Wallet range: ${startAt} to ${endAt}`);
                log(`📋 Total wallets available: ${wallets.length}`);
                log(`⏱️  Timing Configuration:`);
                log(`   • Delay between transactions: ${delayBetweenTx}ms`);
                log(`   • Delay between cycles: ${delayBetweenCycles}ms`);
                log(`   • Delay on errors: ${delayOnError}ms`);
                
                // Get contract address for the token
                let contractResult = await getContractAddress(tokenAddress, mainWalletVolumev2.address, contracts.deployerContract);
                
                if (!contractResult.success) {
                    log(`❌ No contract found for token. Deploying new contract...`);
                    const deployResult = await deployContract(tokenAddress);
                    
                    if (!deployResult.success) {
                        throw new Error(`Failed to deploy contract: ${deployResult.reason || 'Unknown error'}`);
                    }
                    
                    log(`✅ Contract deployed successfully: ${deployResult.deployedContract}`);
                    log(`📤 Remember to fund the contract with ETH and/or tokens before running again!`);
                    return;
                }
                
                const contractAddressVolumeV2 = contractResult.contractAddress;
                log(`✅ Using existing contract: ${contractAddressVolumeV2}`);
                
                // Check contract balances before starting
                log(`🔍 Checking contract balances...`);
                
                const contractETHBalanceVolumeV2 = await provider.getBalance(contractAddressVolumeV2);
                log(`💰 Contract ETH balance: ${ethers.utils.formatUnits(contractETHBalanceVolumeV2, 18)} ETH`);
                
                // Check token balance in contract
                const tokenContractVolumeV2 = new ethers.Contract(tokenAddress, [
                    "function balanceOf(address) external view returns (uint256)",
                    "function symbol() external view returns (string)",
                    "function decimals() external view returns (uint8)"
                ], provider);
                
                let contractTokenBalanceVolumeV2;
                let tokenSymbolVolumeV2 = "TOKEN";
                let tokenDecimalsVolumeV2 = 18;
                
                try {
                    contractTokenBalanceVolumeV2 = await tokenContractVolumeV2.balanceOf(contractAddressVolumeV2);
                    tokenSymbolVolumeV2 = await tokenContractVolumeV2.symbol();
                    tokenDecimalsVolumeV2 = await tokenContractVolumeV2.decimals();
                    log(`🪙 Contract ${tokenSymbolVolumeV2} balance: ${ethers.utils.formatUnits(contractTokenBalanceVolumeV2, tokenDecimalsVolumeV2)} ${tokenSymbolVolumeV2}`);
                } catch (tokenError) {
                    log(`⚠️  Could not check token balance: ${tokenError.message}`);
                    contractTokenBalanceVolumeV2 = ethers.BigNumber.from("0");
                }
                
                // Check if contract has any balance to work with
                if (contractETHBalanceVolumeV2.eq(0) && contractTokenBalanceVolumeV2.eq(0)) {
                    throw new Error(`
            ❌ Contract has no ETH or token balance!
            
            📋 Instructions:
            1. Send ETH to contract: ${contractAddressVolumeV2}
            2. OR send ${tokenSymbolVolumeV2} tokens to contract: ${contractAddressVolumeV2}
            3. The contract needs balance to execute buy/sell operations
            
            💡 Tip: You can send both ETH and tokens for full functionality
                    `);
                }
                
                // Show balance warnings
                if (contractETHBalanceVolumeV2.eq(0)) {
                    log(`⚠️  Contract has no ETH balance - will only be able to sell ${tokenSymbolVolumeV2} tokens`);
                }
                
                if (contractTokenBalanceVolumeV2.eq(0)) {
                    log(`⚠️  Contract has no ${tokenSymbolVolumeV2} balance - will only be able to buy ${tokenSymbolVolumeV2} tokens`);
                }
                
                if (contractETHBalanceVolumeV2.gt(0) && contractTokenBalanceVolumeV2.gt(0)) {
                    log(`✅ Contract has both ETH and token balance - full buy/sell functionality available`);
                } else {
                    log(`✅ Contract has sufficient balance to proceed with limited functionality`);
                }
                
                var v2SuccessCount = 0;
                var v2FailCount = 0;
                let totalCyclesVolumeV2 = 0;
                let currentIndexVolumeV2 = startAt;
                
                log(`\n🔄 Starting infinite volume bot loop for wallets ${startAt}-${endAt}`);
                log(`📄 Contract: ${contractAddressVolumeV2}`);
                log(`🎯 Token: ${tokenAddress} (${tokenSymbolVolumeV2})`);
                log(`👛 Total wallets in range: ${Math.min(endAt, wallets.length) - startAt}`);
                log(`⏹️  Press Ctrl+C to stop the infinite loop\n`);
                
                // Function to create dynamic delays (optional enhancement)
                getDynamicDelay = (baseDelay, successRate) => {
                    // Optionally adjust delay based on success rate
                    // Higher success rate = slightly faster execution
                    // Lower success rate = slightly slower to reduce stress
                    if (successRate > 80) return Math.max(baseDelay * 0.8, 50);
                    if (successRate < 20) return baseDelay * 1.5;
                    return baseDelay;
                };
                
                // Infinite loop
                while (true) {
                    try {
                        const walletProgress = `${currentIndexVolumeV2 - startAt + 1}/${Math.min(endAt, wallets.length) - startAt}`;
                        log(`📊 Cycle ${totalCyclesVolumeV2 + 1} - Wallet ${walletProgress} (Index: ${currentIndexVolumeV2})`);
                        
                        const result = await volumeBotV2(currentIndexVolumeV2, wallets, contractAddressVolumeV2, v2BuyAndSell);
                        
                        if (result && result.success) {
                            v2SuccessCount++;
                            log(`✅ Wallet ${currentIndexVolumeV2} successful (Total success: ${v2SuccessCount})`);
                        } else {
                            v2FailCount++;
                            const reason = result?.reason || 'unknown';
                            log(`❌ Wallet ${currentIndexVolumeV2} failed: ${reason} (Total failed: ${v2FailCount})`);
                            
                            // Handle specific failure cases
                            if (reason === 'insufficient_funds') {
                                log(`💸 Wallet ${currentIndexVolumeV2} has insufficient funds - skipping`);
                            } else if (reason === 'insufficient_gas') {
                                log(`⛽ Wallet ${currentIndexVolumeV2} cannot afford gas - skipping`);
                            } else if (reason === 'gas_cost_exceeds_max') {
                                log(`💰 Wallet ${currentIndexVolumeV2} gas cost exceeds maximum limit - skipping`);
                            }
                        }
                        
                        // Move to next wallet
                        currentIndexVolumeV2++;
                        
                        // Check if we've reached the end of the range
                        if (currentIndexVolumeV2 >= Math.min(endAt, wallets.length)) {
                            totalCyclesVolumeV2++;
                            currentIndexVolumeV2 = startAt; // Reset to beginning
                            
                            const totalProcessed = v2SuccessCount + v2FailCount;
                            const successRate = totalProcessed > 0 ? ((v2SuccessCount / totalProcessed) * 100).toFixed(2) : '0.00';
                            
                            log(`\n🔄 Cycle ${totalCyclesVolumeV2} completed! Starting new cycle...`);
                            log(`📈 Cumulative Stats:`);
                            log(`   • Total Processed: ${totalProcessed}`);
                            log(`   • Successful: ${v2SuccessCount}`);
                            log(`   • Failed: ${v2FailCount}`);
                            log(`   • Success Rate: ${successRate}%`);
                            log(`   • Cycles Completed: ${totalCyclesVolumeV2}`);
                            log(`🔄 Looping back to wallet ${startAt}`);
                            log(`⏱️  Waiting ${delayBetweenCycles}ms before next cycle...\n`);
                            
                            // Configurable delay between cycles
                            await sleep(delayBetweenCycles);
                        } else {
                            // Calculate delay for next transaction
                            const totalProcessed = v2SuccessCount + v2FailCount;
                            const currentSuccessRate = totalProcessed > 0 ? (v2SuccessCount / totalProcessed) * 100 : 100;
                            const actualDelay = getDynamicDelay(delayBetweenTx, currentSuccessRate);
                            
                            log(`⏱️  Waiting ${actualDelay}ms before next transaction...`);
                            await sleep(actualDelay);
                        }
                        
                        // Log progress every 25 transactions
                        if ((v2SuccessCount + v2FailCount) % 25 === 0 && (v2SuccessCount + v2FailCount) > 0) {
                            const totalProcessed = v2SuccessCount + v2FailCount;
                            const successRate = ((v2SuccessCount / totalProcessed) * 100).toFixed(2);
                            log(`📊 Progress Update - Processed: ${totalProcessed}, Success: ${v2SuccessCount}, Failed: ${v2FailCount}, Rate: ${successRate}%`);
                        }
                        
                    } catch (err) {
                        v2FailCount++;
                        errorLog(`💥 Unexpected error for wallet ${currentIndexVolumeV2}: ${err.message}`);
                        
                        // Move to next wallet even on error
                        currentIndexVolumeV2++;
                        
                        // Reset if at end
                        if (currentIndexVolumeV2 >= Math.min(endAt, wallets.length)) {
                            totalCyclesVolumeV2++;
                            currentIndexVolumeV2 = startAt;
                            log(`🔄 Error occurred, but continuing to next cycle (${totalCyclesVolumeV2})`);
                            log(`⏱️  Waiting ${delayBetweenCycles}ms after error before next cycle...`);
                            await sleep(delayBetweenCycles);
                        } else {
                            log(`⏱️  Waiting ${delayOnError}ms after error before next transaction...`);
                            await sleep(delayOnError); // Configurable delay on error
                        }
                    }
                }
                
                break;

            case 'volumeV3':
                var walletsForVolume = loadWallets();
                if (walletsForVolume.length === 0) throw new Error('No wallets found');
                
                startAt = parseInt(args[0]) || 0;
                endAt = parseInt(args[1]) || wallets.length;
                let v3Token = args[2] || random(defaultTokens["V3"]);
                let v3BuyAndSell = args[3] === "true";
                
                // New timing parameters
                delayBetweenTx = parseInt(args[4]) || 150; // milliseconds between individual transactions
                delayBetweenCycles = parseInt(args[5]) || 3000; // milliseconds between cycles
                delayOnError = parseInt(args[6]) || 1000; // milliseconds when error occurs
                
                if (!config.fundingPrivateKey) {
                    throw new Error('PK_MAIN not configured in .env file');
                }
                
                let mainWallet = new ethers.Wallet(config.fundingPrivateKey);
                
                log(`🎯 Starting VolumeV3 for token: ${v3Token} - ${v3BuyAndSell}`);
                log(`👛 Wallet range: ${startAt} to ${endAt}`);
                log(`📋 Total wallets available: ${walletsForVolume.length}`);
                log(`⏱️  Timing Configuration:`);
                log(`   • Delay between transactions: ${delayBetweenTx}ms`);
                log(`   • Delay between cycles: ${delayBetweenCycles}ms`);
                log(`   • Delay on errors: ${delayOnError}ms`);
                
                // Get contract address for the token
                const contractResultV3 = await getContractAddress(v3Token, mainWallet.address, contracts.deployerContract);
                
                if (!contractResultV3.success) {
                    log(`❌ No contract found for token. Deploying new contract...`);
                    const deployResult = await deployContract(v3Token);
                    
                    if (!deployResult.success) {
                        throw new Error(`Failed to deploy contract: ${deployResult.reason || 'Unknown error'}`);
                    }
                    
                    log(`✅ Contract deployed successfully: ${deployResult.deployedContract}`);
                    log(`📤 Remember to fund the contract with ETH and/or tokens before running again!`);
                    return;
                }
                
                let contractAddress = contractResultV3.contractAddress;
                log(`✅ Using existing contract: ${contractAddress}`);
                
                // Check contract balances before starting
                log(`🔍 Checking contract balances...`);
                
                let contractETHBalance = await provider.getBalance(contractAddress);
                log(`💰 Contract ETH balance: ${ethers.utils.formatUnits(contractETHBalance, 18)} ETH`);
                
                // Check token balance in contract
                let tokenContract = new ethers.Contract(v3Token, [
                    "function balanceOf(address) external view returns (uint256)",
                    "function symbol() external view returns (string)",
                    "function decimals() external view returns (uint8)"
                ], provider);
                
                let contractTokenBalance;
                let tokenSymbol = "TOKEN";
                let tokenDecimals = 18;
                
                try {
                    contractTokenBalance = await tokenContract.balanceOf(contractAddress);
                    tokenSymbol = await tokenContract.symbol();
                    tokenDecimals = await tokenContract.decimals();
                    log(`🪙 Contract ${tokenSymbol} balance: ${ethers.utils.formatUnits(contractTokenBalance, tokenDecimals)} ${tokenSymbol}`);
                } catch (tokenError) {
                    log(`⚠️  Could not check token balance: ${tokenError.message}`);
                    contractTokenBalance = ethers.BigNumber.from("0");
                }
                
                // Check if contract has any balance to work with
                if (contractETHBalance.eq(0) && contractTokenBalance.eq(0)) {
                    throw new Error(`
            ❌ Contract has no ETH or token balance!

            📋 Instructions:
            1. Send ETH to contract: ${contractAddress}
            2. OR send ${tokenSymbol} tokens to contract: ${contractAddress}
            3. The contract needs balance to execute buy/sell operations

            💡 Tip: You can send both ETH and tokens for full functionality
                    `);
                }
                
                // Show balance warnings
                if (contractETHBalance.eq(0)) {
                    log(`⚠️  Contract has no ETH balance - will only be able to sell ${tokenSymbol} tokens`);
                }
                
                if (contractTokenBalance.eq(0)) {
                    log(`⚠️  Contract has no ${tokenSymbol} balance - will only be able to buy ${tokenSymbol} tokens`);
                }
                
                if (contractETHBalance.gt(0) && contractTokenBalance.gt(0)) {
                    log(`✅ Contract has both ETH and token balance - full buy/sell functionality available`);
                } else {
                    log(`✅ Contract has sufficient balance to proceed with limited functionality`);
                }
                
                let v3SuccessCount = 0;
                let v3FailCount = 0;
                let totalCycles = 0;
                let currentIndex = startAt;
                
                log(`\n🔄 Starting infinite volume bot loop for wallets ${startAt}-${endAt}`);
                log(`📄 Contract: ${contractAddress}`);
                log(`🎯 Token: ${v3Token} (${tokenSymbol})`);
                log(`👛 Total wallets in range: ${Math.min(endAt, walletsForVolume.length) - startAt}`);
                log(`⏹️  Press Ctrl+C to stop the infinite loop\n`);
                
                // Function to create dynamic delays (optional enhancement)
                getDynamicDelay = (baseDelay, successRate) => {
                    // Optionally adjust delay based on success rate
                    // Higher success rate = slightly faster execution
                    // Lower success rate = slightly slower to reduce stress
                    if (successRate > 80) return Math.max(baseDelay * 0.8, 50);
                    if (successRate < 20) return baseDelay * 1.5;
                    return baseDelay;
                };
                
                // Infinite loop
                while (true) {
                    try {
                        const walletProgress = `${currentIndex - startAt + 1}/${Math.min(endAt, walletsForVolume.length) - startAt}`;
                        log(`📊 Cycle ${totalCycles + 1} - Wallet ${walletProgress} (Index: ${currentIndex})`);
                        
                        const result = await volumeBotV3(currentIndex, walletsForVolume, contractAddress, v3BuyAndSell);
                        
                        if (result && result.success) {
                            v3SuccessCount++;
                            log(`✅ Wallet ${currentIndex} successful (Total success: ${v3SuccessCount})`);
                        } else {
                            v3FailCount++;
                            const reason = result?.reason || 'unknown';
                            log(`❌ Wallet ${currentIndex} failed: ${reason} (Total failed: ${v3FailCount})`);
                            
                            // Handle specific failure cases
                            if (reason === 'insufficient_funds') {
                                log(`💸 Wallet ${currentIndex} has insufficient funds - skipping`);
                            } else if (reason === 'insufficient_gas') {
                                log(`⛽ Wallet ${currentIndex} cannot afford gas - skipping`);
                            } else if (reason === 'gas_cost_exceeds_max') {
                                log(`💰 Wallet ${currentIndex} gas cost exceeds maximum limit - skipping`);
                            }
                        }
                        
                        // Move to next wallet
                        currentIndex++;
                        
                        // Check if we've reached the end of the range
                        if (currentIndex >= Math.min(endAt, walletsForVolume.length)) {
                            totalCycles++;
                            currentIndex = startAt; // Reset to beginning
                            
                            const totalProcessed = v3SuccessCount + v3FailCount;
                            const successRate = totalProcessed > 0 ? ((v3SuccessCount / totalProcessed) * 100).toFixed(2) : '0.00';
                            
                            log(`\n🔄 Cycle ${totalCycles} completed! Starting new cycle...`);
                            log(`📈 Cumulative Stats:`);
                            log(`   • Total Processed: ${totalProcessed}`);
                            log(`   • Successful: ${v3SuccessCount}`);
                            log(`   • Failed: ${v3FailCount}`);
                            log(`   • Success Rate: ${successRate}%`);
                            log(`   • Cycles Completed: ${totalCycles}`);
                            log(`🔄 Looping back to wallet ${startAt}`);
                            log(`⏱️  Waiting ${delayBetweenCycles}ms before next cycle...\n`);
                            
                            // Configurable delay between cycles
                            await sleep(delayBetweenCycles);
                        } else {
                            // Calculate delay for next transaction
                            const totalProcessed = v3SuccessCount + v3FailCount;
                            const currentSuccessRate = totalProcessed > 0 ? (v3SuccessCount / totalProcessed) * 100 : 100;
                            const actualDelay = getDynamicDelay(delayBetweenTx, currentSuccessRate);
                            
                            log(`⏱️  Waiting ${actualDelay}ms before next transaction...`);
                            await sleep(actualDelay);
                        }
                        
                        // Log progress every 25 transactions
                        if ((v3SuccessCount + v3FailCount) % 25 === 0 && (v3SuccessCount + v3FailCount) > 0) {
                            const totalProcessed = v3SuccessCount + v3FailCount;
                            const successRate = ((v3SuccessCount / totalProcessed) * 100).toFixed(2);
                            log(`📊 Progress Update - Processed: ${totalProcessed}, Success: ${v3SuccessCount}, Failed: ${v3FailCount}, Rate: ${successRate}%`);
                        }
                        
                    } catch (err) {
                        v3FailCount++;
                        errorLog(`💥 Unexpected error for wallet ${currentIndex}: ${err.message}`);
                        
                        // Move to next wallet even on error
                        currentIndex++;
                        
                        // Reset if at end
                        if (currentIndex >= Math.min(endAt, walletsForVolume.length)) {
                            totalCycles++;
                            currentIndex = startAt;
                            log(`🔄 Error occurred, but continuing to next cycle (${totalCycles})`);
                            log(`⏱️  Waiting ${delayBetweenCycles}ms after error before next cycle...`);
                            await sleep(delayBetweenCycles);
                        } else {
                            log(`⏱️  Waiting ${delayOnError}ms after error before next transaction...`);
                            await sleep(delayOnError); // Configurable delay on error
                        }
                    }
                }
                
                break;

            case 'volumeV3Fresh':
            // Load wallets is not needed for fresh mode, but keeping variable structure consistent
            const freshV3Token = args[0]; // Unique variable name

             if (!freshV3Token) {
                throw new Error('Missing contract address');
            }

            let v3BuyAndSellFresh = args[3] === "true";
            
            // New timing parameters
            delayBetweenTx = parseInt(args[2]) || 2000; // milliseconds between individual fresh wallet cycles
            delayBetweenCycles = parseInt(args[3]) || 5000; // milliseconds between full cycles
            delayOnError = parseInt(args[4]) || 3000; // milliseconds when error occurs

           
            
            
            if (!config.fundingPrivateKey) {
                throw new Error('PK_MAIN not configured in .env file');
            }
            
            const freshMainWallet = new ethers.Wallet(config.fundingPrivateKey); // Unique variable name
            
            log(`🆕 Starting Fresh Wallet VolumeV3 Bot for token: ${freshV3Token}`);
            log(`👛 Fresh wallet cycles: ${startAt} to ${endAt}`);
            log(`🔑 Main wallet: ${freshMainWallet.address}`);
            log(`⏱️  Timing Configuration:`);
            log(`   • Delay between fresh wallets: ${delayBetweenTx}ms`);
            log(`   • Delay between cycles: ${delayBetweenCycles}ms`);
            log(`   • Delay on errors: ${delayOnError}ms`);
            
            // Get contract address for the token (EXACTLY like volumeV3)
            const freshContractResultV3 = await getContractAddress(freshV3Token, freshMainWallet.address, contracts.deployerContract); // Unique variable name
            
            if (!freshContractResultV3.success) {
                log(`❌ No contract found for token. Deploying new contract...`);
                const deployResult = await deployContract(freshV3Token);
                
                if (!deployResult.success) {
                    throw new Error(`Failed to deploy contract: ${deployResult.reason || 'Unknown error'}`);
                }
                
                log(`✅ Contract deployed successfully: ${deployResult.deployedContract}`);
                log(`📤 Remember to fund the contract with ETH and/or tokens before running again!`);
                return;
            }
            
            const freshContractAddress = freshContractResultV3.contractAddress; // Unique variable name
            log(`✅ Using existing contract: ${freshContractAddress}`);
            
            // Check contract balances before starting (EXACTLY like volumeV3)
            log(`🔍 Checking contract balances...`);
            
            const freshContractETHBalance = await provider.getBalance(freshContractAddress); // Unique variable name
            log(`💰 Contract ETH balance: ${ethers.utils.formatUnits(freshContractETHBalance, 18)} ETH`);
            
            // Check token balance in contract
            const freshTokenContract = new ethers.Contract(freshV3Token, [ // Unique variable name
                "function balanceOf(address) external view returns (uint256)",
                "function symbol() external view returns (string)",
                "function decimals() external view returns (uint8)"
            ], provider);
            
            let freshTokenSymbol = "TOKEN"; // Unique variable name
            let freshTokenDecimals = 18; // Unique variable name
            let freshContractTokenBalance; // Unique variable name
            
            try {
                freshContractTokenBalance = await freshTokenContract.balanceOf(freshContractAddress);
                freshTokenSymbol = await freshTokenContract.symbol();
                freshTokenDecimals = await freshTokenContract.decimals();
                log(`🪙 Contract ${freshTokenSymbol} balance: ${ethers.utils.formatUnits(freshContractTokenBalance, freshTokenDecimals)} ${freshTokenSymbol}`);
            } catch (tokenError) {
                log(`⚠️  Could not check token balance: ${tokenError.message}`);
                freshContractTokenBalance = ethers.BigNumber.from("0");
            }
            
            // Check if contract has any balance to work with
            if (freshContractETHBalance.eq(0) && freshContractTokenBalance.eq(0)) {
                throw new Error(`
        ❌ Contract has no ETH or token balance!

        📋 Instructions:
        1. Send ETH to contract: ${freshContractAddress}
        2. OR send ${freshTokenSymbol} tokens to contract: ${freshContractAddress}
        3. The contract needs balance to execute buy/sell operations

        💡 Tip: You can send both ETH and tokens for full functionality
                `);
            }
            
            // Show balance warnings
            if (freshContractETHBalance.eq(0)) {
                log(`⚠️  Contract has no ETH balance - will only be able to sell ${freshTokenSymbol} tokens`);
            }
            
            if (freshContractTokenBalance.eq(0)) {
                log(`⚠️  Contract has no ${freshTokenSymbol} balance - will only be able to buy ${freshTokenSymbol} tokens`);
            }
            
            if (freshContractETHBalance.gt(0) && freshContractTokenBalance.gt(0)) {
                log(`✅ Contract has both ETH and token balance - full buy/sell functionality available`);
            } else {
                log(`✅ Contract has sufficient balance to proceed with limited functionality`);
            }
            
            // Additional check for main wallet balance for fresh wallet funding
            log(`🔍 Checking main wallet balance for fresh wallet funding...`);
            const freshMainBalance = await provider.getBalance(freshMainWallet.address); // Unique variable name
            log(`💰 Main wallet balance: ${ethers.utils.formatUnits(freshMainBalance, 18)} ETH`);
            
            const freshFundingAmount = "0.00001"; // Unique variable name - Default funding amount for fresh wallets
            const freshRequiredBalance = ethers.utils.parseUnits(freshFundingAmount, 18).mul(20); // Unique variable name - 20x buffer
            
            if (freshMainBalance.lt(freshRequiredBalance)) {
                log(`⚠️  Warning: Main wallet balance might be low for sustained fresh wallet operation`);
                log(`   Recommended minimum: ${ethers.utils.formatUnits(freshRequiredBalance, 18)} ETH for funding fresh wallets`);
            }
            
            let freshSuccessCount = 0; // Unique variable name
            let freshFailCount = 0; // Unique variable name
            let freshTotalCycles = 0; // Unique variable name
            let freshCurrentIndex = startAt; // Unique variable name
            let freshTotalWalletsCreated = 0; // Unique variable name
            let freshTotalETHSpent = ethers.BigNumber.from("0"); // Unique variable name
            
            log(`\n🔄 Starting infinite fresh wallet volume bot loop for cycles ${startAt}-${endAt}`);
            log(`📄 Contract: ${freshContractAddress}`);
            log(`🎯 Token: ${freshV3Token} (${freshTokenSymbol})`);
            log(`🆕 Each cycle creates a brand new wallet`);
            log(`⏹️  Press Ctrl+C to stop the infinite loop\n`);
            
            // Function to create dynamic delays (optional enhancement)
            const getFreshDynamicDelay = (baseDelay, successRate) => { // Unique function name
                // Optionally adjust delay based on success rate
                // Higher success rate = slightly faster execution
                // Lower success rate = slightly slower to reduce stress
                if (successRate > 80) return Math.max(baseDelay * 0.8, 100);
                if (successRate < 20) return baseDelay * 1.5;
                return baseDelay;
            };
            
            // Infinite loop
            while (true) {
                try {
                    const freshCycleProgress = `${freshCurrentIndex - startAt + 1}/${endAt - startAt}`; // Unique variable name
                    log(`📊 Cycle ${freshTotalCycles + 1} - Fresh Wallet ${freshCycleProgress} (Cycle: ${freshCurrentIndex})`);
                    
                    // Record starting main wallet balance
                    const freshPreBalance = await provider.getBalance(freshMainWallet.address); // Unique variable name
                    
                    // Create fresh wallet and execute volume swap using the deployed contract
                    const freshResult = await volumeBotV3Fresh(freshContractAddress, [freshV3Token], freshFundingAmount, v3BuyAndSellFresh); // Unique variable name
                    
                    // Record ending main wallet balance to calculate actual cost
                    const freshPostBalance = await provider.getBalance(freshMainWallet.address); // Unique variable name
                    const freshActualCost = freshPreBalance.sub(freshPostBalance); // Unique variable name
                    
                    if (freshResult && freshResult.success) {
                        freshSuccessCount++;
                        freshTotalWalletsCreated++;
                        freshTotalETHSpent = freshTotalETHSpent.add(freshActualCost);
                        log(`✅ Fresh wallet ${freshCurrentIndex} successful (Total success: ${freshSuccessCount})`);
                        if (freshResult.newWalletAddress) {
                            log(`🔑 Wallet: ${freshResult.newWalletAddress}`);
                        }
                        log(`💰 Cost: ${ethers.utils.formatUnits(freshActualCost, 18)} ETH`);
                    } else {
                        freshFailCount++;
                        freshTotalWalletsCreated++;
                        freshTotalETHSpent = freshTotalETHSpent.add(freshActualCost);
                        const freshReason = freshResult?.reason || freshResult?.error || 'unknown'; // Unique variable name
                        log(`❌ Fresh wallet ${freshCurrentIndex} failed: ${freshReason} (Total failed: ${freshFailCount})`);
                        
                        // Handle specific failure cases
                        if (freshReason === 'insufficient_funds') {
                            log(`💸 Fresh wallet ${freshCurrentIndex} has insufficient funds - skipping`);
                        } else if (freshReason === 'insufficient_gas') {
                            log(`⛽ Fresh wallet ${freshCurrentIndex} cannot afford gas - skipping`);
                        } else if (freshReason === 'gas_cost_exceeds_max') {
                            log(`💰 Fresh wallet ${freshCurrentIndex} gas cost exceeds maximum limit - skipping`);
                        }
                    }
                    
                    // Move to next cycle
                    freshCurrentIndex++;
                    
                    // Check if we've reached the end of the range
                    if (freshCurrentIndex >= endAt) {
                        freshTotalCycles++;
                        freshCurrentIndex = startAt; // Reset to beginning
                        
                        const freshTotalProcessed = freshSuccessCount + freshFailCount; // Unique variable name
                        const freshSuccessRate = freshTotalProcessed > 0 ? ((freshSuccessCount / freshTotalProcessed) * 100).toFixed(2) : '0.00'; // Unique variable name
                        
                        log(`\n🔄 Cycle ${freshTotalCycles} completed! Starting new cycle...`);
                        log(`📈 Cumulative Stats:`);
                        log(`   • Total Fresh Wallets: ${freshTotalProcessed}`);
                        log(`   • Successful: ${freshSuccessCount}`);
                        log(`   • Failed: ${freshFailCount}`);
                        log(`   • Success Rate: ${freshSuccessRate}%`);
                        log(`   • Cycles Completed: ${freshTotalCycles}`);
                        log(`   • Total ETH Spent: ${ethers.utils.formatUnits(freshTotalETHSpent, 18)} ETH`);
                        if (freshTotalWalletsCreated > 0) {
                            const freshAvgETH = ethers.utils.formatUnits(freshTotalETHSpent.div(freshTotalWalletsCreated), 18); // Unique variable name
                            log(`   • Avg ETH per Wallet: ${freshAvgETH} ETH`);
                        }
                        log(`🔄 Looping back to cycle ${startAt}`);
                        log(`⏱️  Waiting ${delayBetweenCycles}ms before next cycle...\n`);
                        
                        // Configurable delay between cycles
                        await sleep(delayBetweenCycles);
                    } else {
                        // Calculate delay for next transaction
                        const freshTotalProcessed = freshSuccessCount + freshFailCount;
                        const freshCurrentSuccessRate = freshTotalProcessed > 0 ? (freshSuccessCount / freshTotalProcessed) * 100 : 100; // Unique variable name
                        const freshActualDelay = getFreshDynamicDelay(delayBetweenTx, freshCurrentSuccessRate); // Unique variable name
                        
                        log(`⏱️  Waiting ${freshActualDelay}ms before next fresh wallet...`);
                        await sleep(freshActualDelay);
                    }
                    
                    // Log progress every 25 transactions
                    if ((freshSuccessCount + freshFailCount) % 25 === 0 && (freshSuccessCount + freshFailCount) > 0) {
                        const freshTotalProcessed = freshSuccessCount + freshFailCount;
                        const freshSuccessRate = ((freshSuccessCount / freshTotalProcessed) * 100).toFixed(2);
                        log(`📊 Progress Update - Fresh wallets: ${freshTotalProcessed}, Success: ${freshSuccessCount}, Failed: ${freshFailCount}, Rate: ${freshSuccessRate}%`);
                        
                        // Check main wallet balance during progress updates
                        const freshCurrentMainBalance = await provider.getBalance(freshMainWallet.address); // Unique variable name
                        log(`💰 Main wallet balance: ${ethers.utils.formatUnits(freshCurrentMainBalance, 18)} ETH`);
                    }
                    
                } catch (err) {
                    freshFailCount++;
                    errorLog(`💥 Unexpected error for fresh wallet ${freshCurrentIndex}: ${err.message}`);
                    
                    // Move to next cycle even on error
                    freshCurrentIndex++;
                    
                    // Reset if at end
                    if (freshCurrentIndex >= endAt) {
                        freshTotalCycles++;
                        freshCurrentIndex = startAt;
                        log(`🔄 Error occurred, but continuing to next cycle (${freshTotalCycles})`);
                        log(`⏱️  Waiting ${delayBetweenCycles}ms after error before next cycle...`);
                        await sleep(delayBetweenCycles);
                    } else {
                        log(`⏱️  Waiting ${delayOnError}ms after error before next fresh wallet...`);
                        await sleep(delayOnError); // Configurable delay on error
                    }
                }
            }
            
            break;
                
            case 'withdraw':
                var contractAddr = args[0];
                var tokenAddr = args[1] || null;
                
                if (!contractAddr) {
                    throw new Error('Contract address required. Usage: withdraw <contract_address> [token_address]');
                }
                
                await withdrawFromContract(contractAddr, tokenAddr);
                break;

            case 'withdraw-token':
                var tokenAddr = args[0];
                
                if (!tokenAddr) {
                    throw new Error('Token address required. Usage: withdraw-token <token_address>');
                }
                
                await withdrawByToken(tokenAddr);
                break;

                case 'addToken':
                   const AddTokens = args[0] ? args[0].split(',') : null
                
                if (!AddTokens) {
                    throw new Error('Token address required');
                }
                
                await addTokens(AddTokens);
                break;

            case 'deploy':
                tokenAddress = args[0];
                
                if (!tokenAddress) {
                    throw new Error('Token address required. Usage: deploy <token_address>');
                }
                
                log(`🚀 Deploying VolumeSwap contract for token: ${tokenAddress}`);
                const deployResult = await deployContract(tokenAddress);
                
                if (deployResult.success) {
                    log(`✅ Contract deployed successfully: ${deployResult.deployedContract}`);
                    log(`📋 Next steps:`);
                    log(`   1. Fund contract with ETH: ${deployResult.deployedContract}`);
                    log(`   2. Fund contract with tokens: ${deployResult.deployedContract}`);
                    log(`   3. Run volume generation: node script.js volumeV2 0 100 ${tokenAddress}`);
                } else {
                    log(`❌ Contract deployment failed: ${deployResult.reason || 'Unknown error'}`);
                }
                break;
                
            default:
                errorLog(`Unknown command: ${command}`);
                // showHelp();
                // process.exit(1);
        }
    } catch (err) {
        errorLog(`Command failed: ${err.message}`);
        process.exit(1);
    }
}

// Run the main function
if (require.main === module) {
    main().catch(err => {
        errorLog(`Fatal error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    createWallets,
    createWalletsToTarget,
    checkWallets,
    airdropBatch,
    swapBatch,
    multiSwapBatch,
    v3SwapBatch,
    loadWallets,
    saveWallets
};