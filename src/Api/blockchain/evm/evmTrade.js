import { ZeroAddress, toBeHex } from "ethers";
import {
  handleAxiosError,
  handleEthersJsError,
  throwError,
  simpleRetryFn,
} from "../../lib/errorHandler/handleError.js";

import { updateNonce } from "../../lib/walletHandler/nonceSigner.js";
import { sendEvmTxWithRetry, approveInfinityAllowance } from "./evmTransfer.js";
import { getSwapRoute } from "../../lib/oracle/swap.js";

// Constants
import { DEFAULT_GAS_RANGE } from "../../constant/common/chain.js";
import {
  BASIS_POINT_DIVISOR_BIGINT,
  EVM_AGGREGATORS,
  ORDER_GAS_BUFFER,
  EVM_ORDER_TRADE_FEE_COLLECTOR,
  ORDER_TRADE_FEE,
  ORDER_AGGREGATOR_SWAP_RESULT_FETCHING_TIMEOUT,
} from "../../constant/common/order.js";
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

  // 1. Create the aggregator promises
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

      if (route?.success && route?.amountOut && route?.amountOut !== "0") {
        results.push(route);
      }
    } catch (err) {
      const { message, shouldContinue } = handleAxiosError(err);
      errors.push({ aggregator, error: message, shouldContinue });
    }
  });

  // 2. Create a Timeout Promise
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => {
      // We don't 'reject', we 'resolve' so the function can return
      // whatever results it gathered so far.
      resolve("TIMEOUT_REACHED");
    }, ORDER_AGGREGATOR_SWAP_RESULT_FETCHING_TIMEOUT),
  );

  // 3. Race the aggregators against the clock
  // Promise.allSettled ensures we wait for all to finish if they are fast.
  await Promise.race([Promise.allSettled(aggregatorPromises), timeoutPromise]);

  // 4. Analysis and Sorting
  if (!results.length) {
    // If we timed out and have 0 results, check errors
    const lastError = errors[errors.length - 1];
    throw new Error(
      lastError?.error || "Aggregator routing failed or timed out",
    );
  }

  // 5. Sort by Amount Out (Descending)
  return results.sort((a, b) => {
    if (Number(a.amountOut) > Number(b.amountOut)) return -1;
    if (Number(a.amountOut) < Number(b.amountOut)) return 1;
    return 0;
  });
}

async function getReceivedAmountFromTx(provider, receipt, receiver, tokenOut) {
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice || 0n;
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
  signer,
  option,
}) {
  let executionResult = {
    success: false,
    signature: null,
    totalReceived: 0n,
    fee: 0n,
    errorLabel: null,
    error: null,
    retry: false,
  };
  try {
    let walletAddress = option?.walletAddress;
    if (!walletAddress) {
      walletAddress = await signer.getAddress();
    }
    let swapRoutes;
    try {
      swapRoutes = await getBestSwapRoutes({
        tokenIn,
        tokenOut,
        amountIn,
        slippageBps: slippage,
        userAddress: walletAddress,
        chainId,
      });
    } catch (err) {
      executionResult.errorLabel = "ROUTE_ORACLE_FAILED";
      executionResult.error = err.message;
      executionResult.retry = true;
      return executionResult;
    }

    if (swapRoutes.length === 0) {
      executionResult.errorLabel = "NO_ROUTE_FOUND";
      executionResult.retry = true;
      return executionResult;
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
      if (!approveResult.allowance) {
        executionResult.errorLabel = "APPROVE_FAILED";
        executionResult.error = approveResult.error;
        if (["CONTRACT_NOT_FOUND", "BALANSE_CHECK_FAILED", "RETRY_TRANSACTION_FAILED"].includes(approveResult.error)) {
          executionResult.retry = true;
        }
        return executionResult;
      } else {
        if (approveResult.approve?.success === true) {
          gasFee += approveResult?.approve?.fee || BigInt(0);
        }
      }
    }

    let swapTxData;
    let bufferGasFee;
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    for (let i = 0; i < swapRoutes.length; i++) {
      try {
        let swapInfo = swapRoutes[i];
        const swapEstimateGas = await signer.estimateGas(swapInfo.txData);
        const gasLimit =
          (swapEstimateGas * ORDER_GAS_BUFFER) / BASIS_POINT_DIVISOR_BIGINT;
        bufferGasFee = gasLimit * gasPrice;
        swapTxData = { ...swapInfo.txData, gasLimit };
        break;
      } catch (err) {
        if (err.code == "NONCE_EXPIRED") {
          let newSigner = updateNonce(signer);
          if (!newSigner) {
            executionResult.errorLabel = "TX_NONCE_FAILED";
            executionResult.retry = true;
            return executionResult;
          }
          signer = newSigner;
          i--;
          continue;
        }
        const { message, shouldContinue } = handleEthersJsError(err);
        if (shouldContinue == true) {
          i--;
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }
    }

    if (!swapTxData) {
      executionResult.errorLabel = "SIMULATION_FAILED";
      return executionResult;
    }

    try {
      const receipt = await sendEvmTxWithRetry({
        signer,
        txData: swapTxData,
        retry: 2,
      }).catch(err=>{
        let { message , shouldContinue} = handleEthersJsError(err);
         executionResult.errorLabel = "TX_FAILED";
         executionResult.error = message;
        if(shouldContinue == true){
          executionResult.retry = true;
        }
        return executionResult;
      });
      let received = await getReceivedAmountFromTx(
        provider,
        receipt,
        walletAddress,
        tokenOut,
      );
      gasFee += received.fee;
      executionResult.success = true;
      executionResult.signature = receipt.hash;
      executionResult.totalReceived = received.totalReceived;
      executionResult.fee = gasFee;
      return executionResult;
    } catch (err) {
      executionResult.error = err.message;
      executionResult.errorLabel = "SWAP_FAILED";
      return executionResult;
    }
  } catch (err) {
    executionResult.errorLabel = "SWAP_FAILED";
    executionResult.error = err.message;
    return executionResult;
  }
}

export async function simulateExecuteSwap({
  tokenIn,
  tokenOut,
  amountIn,
  slippage = 500,
  chainId,
  provider,
  signer,
  option,
}) {
  
  let executionResult = {
    success: false,
    signature: null,
    totalReceived: 0n,
    fee: 0n,
    errorLabel: null,
    error: null,
    retry: false,
  };
  let walletAddress = option.address;
  if (!walletAddress) {
    walletAddress = await signer.getAddress();
  }
  let swapRoutes;
  try {
    swapRoutes = await getBestSwapRoutes({
      tokenIn,
      tokenOut,
      amountIn,
      slippageBps: slippage,
      userAddress: walletAddress,
      chainId,
    });
  } catch (err) {
    executionResult.error = err.message;
    executionResult.retry = true;
    return executionResult;
  }

  if (swapRoutes.length === 0) {
    executionResult.error = "No valid route found";
    executionResult.retry = true;
    return executionResult;
  }

  let swapTxData;
  let expGasFee;
  let bufferGasFee;
  let expectedAmountOut;
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  for (let i = 0; i < swapRoutes.length; i++) {
    try {
      let swapInfo = swapRoutes[i];
      const swapEstimateGas = await signer.estimateGas(swapInfo.txData);
      expectedAmountOut = swapInfo.amountOut;
      expGasFee = swapEstimateGas * gasPrice;
      const gasLimit =
        (swapEstimateGas * ORDER_GAS_BUFFER) / BASIS_POINT_DIVISOR_BIGINT;
      bufferGasFee = gasLimit * gasPrice;
      swapTxData = { ...swapInfo.txData, gasLimit };
      break;
    } catch (err) {
      if (err.code == "NONCE_EXPIRED") {
        let newSigner = updateNonce(signer);
        if (!newSigner) {
          executionResult.errorLabel = "SIGNER FAILED";
          executionResult.retry = true;
          return executionResult;
        }
        signer = newSigner;
        i--;
        continue;
      }
      const { message, shouldContinue } = handleEthersJsError(err);
      if (shouldContinue == true) {
        i--;
        await new Promise((r) => setTimeout(r, 1000));
      }
      continue;
    }
  }

  if (!swapTxData) {
    executionResult.errorLabel = "ROUTE_FAILED";
    executionResult.error = "Route validation failed";
    return executionResult;
  }
  executionResult.success = true;
  if (
    tokenIn.toLowerCase() ==
    "0x152b9d0FdC40C096757F570A51E494bd4b943E50".toLowerCase()
  ) {
    executionResult.signature =
      "0x9d61bb98f94f0e1c747e850e0a64ea222296fb0abff8b6ded294d6c00bb5f494";
    executionResult.fee = BigInt("513021326903694");
    executionResult.totalReceived = BigInt("3035428");
  } else if (
    tokenOut.toLowerCase() ==
    "0x152b9d0FdC40C096757F570A51E494bd4b943E50".toLowerCase()
  ) {
    executionResult.signature =
      "0x1865eabc8c63619eb933583a39dfe247f92b5e52cea4d33b85fe8a07be69548c";
    executionResult.fee = BigInt("1073234285397480");
    executionResult.totalReceived = BigInt("00003237");
  } else {
    executionResult.signature =
      "0x1865eabc8c63619eb933583a39dfe247f92b5e52cea4d33b85fe8a07be69548c";
    executionResult.fee = BigInt(expGasFee);
    executionResult.totalReceived = BigInt(expectedAmountOut);
  }
  return executionResult;
}
