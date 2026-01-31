import { executeSolanaSwap } from "../svm/svmTrade.js";
import { executeEVMSwap } from "../evm/evmTrade.js";
import {chains } from "../../constant/common/chain.js";

export const executeSwap = async ({
  tokenIn,
  tokenOut,
  amountIn,
  slippage = 500,
  chainId,
  connectionProvider,
  signer,
}) => {
  let executionResult;
  if (chains.Solana == chainId) {
    executionResult = await executeSolanaSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      connection: connectionProvider,
      keyPair: signer,
    });
  }else{
    let connectedSigner = signer.connect(connectionProvider);
    executionResult = await executeEVMSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      provider: connectionProvider,
      signer: connectedSigner,
    });
  }
  return executionResult
};