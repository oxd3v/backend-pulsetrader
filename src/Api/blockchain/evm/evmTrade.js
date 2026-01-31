import { ZeroAddress, Interface } from "ethers";
import {
  handleAxiosError,
  throwError,
  simpleRetryFn,
} from "../../lib/errorHandler/handleError.js";
import { updateSignerFromNonceManager } from "../../lib/walletHandler/nonceSigner.js";
import { sendEvmTxWithRetry, approveInfinityAllowance } from "./evmTransfer.js";
import { getSwapRoute } from "../../lib/oracle/swap.js";

// Constants
import { DEFAULT_GAS_RANGE } from "../../../../src/constant/common/chain.js";
import { BASIS_POINT_DIVISOR_BIGINT } from "../../../../src/constant/common/utility.js";
import {
  EVM_AGGREGATORS,
  ORDER_GAS_BUFFER,
  EVM_ORDER_TRADE_FEE_COLLECTOR,
  ORDER_TRADE_FEE,
} from "../../../../src/constant/common/order.js";
const JOE_AGGREGATOR_ROUTER = "0x45A62B090DF48243F12A21897e7ed91863E2c86b";



async function getBestSwapRoutes({
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps,
  userAddress,
  chainId,
  feeBps = 0,
  feeToken,
}) {
  const results = [];
  const errors = [];

  const aggregatorPromises = EVM_AGGREGATORS.map(async (aggregator) => {
    try {
      const route = await getSwapRoute({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps,
        aggregator,
        chainId,
        userAddress,
        feeBps,
        feeToken,
      });
      if (route?.success && route?.amountOut && route?.amountOut != "0")
        results.push(route);
    } catch (err) {
      const { message, shouldContinue } = handleAxiosError(err);
      errors.push({ aggregator, error: message, shouldContinue });
    }
  });

  await Promise.all(aggregatorPromises);

  if (!results.length) {
    throwError({
      message: errors.length
        ? errors[errors.length - 1].error
        : "All aggregators failed",
      shouldContinue: errors.length
        ? errors[errors.length - 1].shouldContinue || false
        : false,
    });
  }

  return results.sort((a, b) => Number(b.amountOut) - Number(a.amountOut));
}

async function getReceivedAmountFromTx(receipt, receiver, tokenOut) {
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice || tx.gasPrice;
  const gasCost = gasUsed * gasPrice;
  let totalReceived;
  if (tokenOut == ZeroAddress) {
    // ETH Received = (Balance After - Balance Before) + Gas Fees Paid
    const blockNumber = receipt.blockNumber;

    // 2. Fetch balances at the block of the transaction and the block before it
    const [balanceBefore, balanceAfter] = await simpleRetryFn({
      fn: async () =>
        await Promise.all([
          provider.getBalance(receiver, blockNumber - 1),
          provider.getBalance(receiver, blockNumber),
        ]),
      retry: 3,
    });

    // 3. Calculate difference
    let ethDifference = balanceAfter - balanceBefore;

    totalReceived = ethDifference + gasCost;
  } else {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer event topic
    const toTopic = toBeHex(receiver.toLowerCase(), 32);

    const matchingLog = receipt.logs?.find(
      (log) =>
        log.address.toLowerCase() === tokenOut.toLowerCase() &&
        log.topics[0] === transferTopic &&
        log.topics[2]?.toLowerCase() === toTopic.toLowerCase(),
    );

    totalReceived = matchingLog ? BigInt(matchingLog.data) : undefined;
  }

  return {
    totalReceived,
    fee: gasCost,
  };
}

export async function executeEVMSwap({
  tokenIn,
  tokenOut,
  amountIn,
  slippage = 500,
  chainId,
  provider,
  signer
}) {
  let walletAddress = await signer.getAddress();
  const swapRoutes = await getBestSwapRoutes({
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps: slippage,
    userAddress: walletAddress,
    chainId,
  });

  if (swapRoutes.length === 0) {
    throwError({ message: "No swap routes found", shouldContinue: false });
  }

  let gasFee = BigInt(0);
  if (tokenIn !== ZeroAddress) {
    let approveResult = await approveInfinityAllowance({
      tokenAddress: tokenIn,
      owner: walletAddress,
      spender: JOE_AGGREGATOR_ROUTER,
      amount: amountIn,
      signer,
    });
    gasFee += approveResult?.approveFee || BigInt(0);
  }

  let swapTxData;
  let gasPrice = (await provider.getFeeData()).gasPrice;
  let expectedAmountOut;
  let bufferGasFee;
  for (let i = 0; i < swapRoutes; i++) {
    try {
      let swapInfo = swapRoutes[i];
      const swapEstimateGas = await signer.estimateGas(swapInfo.txData);
      let fee =
        (swapEstimateGas * gasPrice * ORDER_GAS_BUFFER) /
        BASIS_POINT_DIVISOR_BIGINT;
      bufferGasFee = fee;
      swapTxData = swapInfo.txData;
      expectedAmountOut = swapInfo.amountOut
      break;
    } catch (err) {
      if (err.code == "NONCE_EXPIRED") {
        let provider = signer.provider;
        signer = updateSignerFromNonceManager(signer.privateKey).connect(
          provider,
        );
        i--;
        continue;
      }
      const { message, shouldContinue } = handleEthersJsError(err);
      if(shouldContinue == true){
        i--;
        await new Promise(r => setTimeout(r, 1000));
      }
      continue;
    }
  }

  if (!swapTxData) {
    throwError({ message: "No valid swap route found", shouldContinue: false });
  }

  let walletState = getWalletGuard(walletAddress);
  const hasFunds = await walletState.hasSufficientFunds({
    chainId,
    tokenAddress: tokenIn,
    amountRequired: BigInt(amountIn),
    txFee: bufferGasFee,
  });

  if (!hasFunds) {
    throwError({
      message: "Insufficient funds for Swap + Fee",
      shouldContinue: false,
    });
  }

  if (DEFAULT_GAS_RANGE[chainId] < bufferGasFee) {
    throwError({ message: "Gas limit Exceed", shouldContinue: true });
  }

  walletState.addPendingSpend({
    chainId,
    tokenAddress: ZeroAddress,
    amount: bufferGasFee,
  });
  walletState.addPendingSpend({
    chainId,
    tokenAddress: tokenIn,
    amount: amountIn,
  });

  try {
    const receipt = await sendEvmTxWithRetry({
      signer,
      txData: actualTxData,
      retry: 2,
    });
    let received = await getReceivedAmountFromTx(
      receipt,
      walletAddress,
      tokenOut,
    );
    gasFee += received.fee;
    return {
      success: true,
      signature: receipt.hash,
      totalReceived: received.totalReceived,
      fee: gasFee,
    };
  } catch (err) {
    throwError({ message: err.message, shouldContinue: false });
  } finally {
    walletState.removePendingSpend({
      chainId,
      tokenAddress: ZeroAddress,
      amount: bufferGasFee,
    });
    walletState.removePendingSpend({
      chainId,
      tokenAddress: tokenIn,
      amount: totalAmountCheck,
    });
  }
}

// export async function simulateExecuteSwap({
//   tokenIn,
//   tokenOut,
//   amountIn,
//   slippage,
//   wallet,
//   chainId,
//   provider,
//   feeBps = 0,
//   feeToken,
//   expectedAmount
// }) {
//   const walletAddress = wallet.address;
//   let totalGasUsed = 0n;
//   let totalReceived = 0n;
//   const swapRoutes = await getBestSwapRoutes({ tokenIn, tokenOut, amountIn, slippageBps: slippage, walletAddress, chainId, feeBps, feeToken });
//   if (swapRoutes.length === 0) {
//     throwError({ message: 'No swap routes found', shouldContinue: false });
//   }

//   totalGasUsed += BigInt(swapRoutes[0].gas);
//   let gasPrice = (await provider.getFeeData()).gasPrice;
//   totalReceived += BigInt(swapRoutes[0].amountOut);
//   const gasFee = totalGasUsed * BigInt(gasPrice);
//   let receivePortion;
//   if(expectedAmount){
//     receivePortion = totalReceived*BASIS_POINT_DIVISOR_BIGINT/expectedAmount;
//   }
//   if(!expectedAmount || receivePortion > 2000){
//      return {
//     success: true,
//     signature: 'demo',
//     totalReceived: totalReceived,
//     fee: gasFee,
//   };
//   }else{
//     return {
//       success: false
//     }
//   }

// }
