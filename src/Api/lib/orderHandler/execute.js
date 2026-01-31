import OrderModel from "../../../../src/model/order.js";
import { throwError, handleError } from "../../errorHandler.js";
import { getSigner } from "../../../walletManager/generate.js";
import { executeSwap } from "../../blockchain/common/executeSwap.js";
import { getTradeFee } from "../transfer/fees.js";
import { addActivity } from "../activity/activityLog.js";
import { ZeroAddress } from "ethers";
import logger from "../../logger.js"; // Added missing import
import {
  safeParseUnits,
  convertToUsd,
  expandDecimals,
} from "../utility/number.js";
import {
  chainConfig,
  getConnectionProvider,
} from "../../constant/common/chain.js";
import {
  PRECISION_DECIMALS,
  BASIS_POINT_DIVISOR_BIGINT,
  BASIS_POINT_DIVISOR,
  ACCUMULATE_STRATEGY,
  DEFAULT_TAKE_PROFIT_PERCENTAGE,
  DEFAULT_STOP_LOSS_PERCENTAGE,
  ORDER_TRADE_FEE,
} from "../../constant/common/order.js";
import { COLLATERAL_TOKEN_DATA_MAP } from "../../../Listener/listen/token.js";

/**
 * Updates an order in the database with strict field mapping.
 * Optimized: Uses $set to only update changed fields.
 */
export const updateOrder = async ({ orderId, updates }) => {
  const updatePayload = {};
  const fieldMap = {
    tokenAmount: "amount.tokenAmount",
    takeProfitPrice: "exit.takeProfit.takeProfitPrice",
    profitUsd: "exit.takeProfit.profit",
    stopLossPrice: "exit.stopLoss.stopLossPrice",
    saveUsd: "exit.stopLoss.save",
    status: "orderStatus",
    type: "orderType",
    message: "message",
    feeInUsd: "executionFee.feeInUsd",
    payInUsd: "executionFee.payInUsd",
    entryPrice: "additional.entryPrice",
    exitPrice: "additional.exitPrice",
    realizedPnl: "additional.realizedPnl",
    isBusy: "isBusy",
    isActive: "isActive",
    retry: "additional.retry",
    pendingTask: "additional.pendingTask",
  };

  Object.keys(updates).forEach((key) => {
    if (updates[key] !== undefined && fieldMap[key]) {
      const val = updates[key];
      // Store BigInts as strings to prevent Mongo errors
      updatePayload[fieldMap[key]] = typeof val === "bigint" ? val.toString() : val;
    }
  });

  return await OrderModel.updateOne({ _id: orderId }, { $set: updatePayload });
};

/**
 * Executes a BUY order (Entry).
 */
export const openSpotOrder = async (order, tokenData) => {
  if (order.orderType !== "BUY" || order.orderStatus !== "PENDING" || order.isBusy) return;

  try {
    const { orderAsset, wallet, slippage, chainId, amount } = order;
    const tokenIn = orderAsset.collateralToken.address;
    const tokenOut = orderAsset.orderToken.address;
    const amountIn = amount.orderSize;
    const signer = getSigner(wallet.encryptedWalletKey, wallet.network);
    const connectionProvider = getConnectionProvider(chainId);

    if (!tokenIn || !tokenOut || !amountIn || !signer)
      throw new Error("Missing execution parameters");

    const wrappedNative = chainConfig[chainId].nativeToken;
    const collateralToken = orderAsset.collateralToken;

    // Safe Price Lookups (Default to 0n to prevent crashes)
    const nativePriceUsd = COLLATERAL_TOKEN_DATA_MAP.get(`${chainId}:${wrappedNative.address.toLowerCase()}`) || 0n;
    const collateralPriceUsd = COLLATERAL_TOKEN_DATA_MAP.get(`${chainId}:${collateralToken.address.toLowerCase()}`) || 0n;

    // Calculate estimated trade fee
    let tradeFee = (BigInt(amountIn) * ORDER_TRADE_FEE) / BASIS_POINT_DIVISOR_BIGINT;
    let tradeFeeInUsd = (tradeFee * collateralPriceUsd) / expandDecimals(1, collateralToken.decimals) || 0n;

    // Execute Swap
    const executionResult = await executeSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      signer,
      connectionProvider,
    });

    if (executionResult?.success && executionResult.signature) {
      if (BigInt(executionResult.totalReceived) > 0n) {
        let tradeFeeTxFeeInUsd = 0n;

        // Collect Protocol Fee
        if (tradeFee > 0n) {
          // FIX: Pass 'order' object, not 'user', to match fees.js signature
          const tradeFeeTx = await getTradeFee({
            order: order,
            chainId,
            amount: tradeFee,
            token: { address: tokenIn }, // Helper wrapper for fees.js
            signer,
          });

          if (tradeFeeTx.success === true) {
            tradeFeeTxFeeInUsd = convertToUsd(BigInt(tradeFeeTx.fee), wrappedNative.decimals, nativePriceUsd);
            
            // Optimization: Non-blocking activity log
            addActivity({
              orderId: order._id,
              walletId: order.wallet._id,
              userId: order.user._id,
              type: "TRADE FEE",
              status: "Success",
              chainId,
              txHash: tradeFeeTx.signature,
              payToken: { ...collateralToken, amount: tradeFee.toString(), amountInUsd: tradeFeeInUsd.toString() },
              feeToken: { feeAmount: tradeFeeTx.fee, feeInUsd: tradeFeeTxFeeInUsd.toString() },
            }).catch(e => logger.error(`[Activity Log Error]: ${e.message}`));
          }
        }

        const payInUsd = (tokenIn === ZeroAddress || tokenIn === wrappedNative.address
            ? convertToUsd(executionResult.totalReceived, wrappedNative.decimals, nativePriceUsd)
            : convertToUsd(executionResult.totalReceived, collateralToken.decimals, collateralPriceUsd)) + tradeFeeInUsd;

        const feeInUsd = convertToUsd(executionResult.fee, wrappedNative.decimals, nativePriceUsd) + tradeFeeTxFeeInUsd;

        await convertOpenOrder({
          order,
          executionResult: { ...executionResult, feeInUsd, payInUsd, tradeFee },
        });

      } else {
        // Transaction successful but 0 tokens received (rare edge case)
        const indexPriceStr = tokenData?.priceUSD 
            ? safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS).toString() 
            : "0";

        await updateOrder({
          orderId: order._id,
          updates: {
            isActive: true,
            isBusy: false,
            status: 'PROCESSING',
            pendingTask: {
              txCompleted: true,
              feeCollected: false,
              openCalculation: false,
              activityCreated: false,
              prices: {
                nativePriceUsd: nativePriceUsd.toString(),
                collateralPriceUsd: collateralPriceUsd.toString(),
                indexTokenPriceUsd: indexPriceStr
              },
              txSignature: executionResult.signature
            }
          }
        });
      }
    } else {
      throwError({ message: "Execution failed", shouldContinue: false });
    }
  } catch (err) {
    const { message, shouldContinue } = handleError(err);
    await updateOrder({
      orderId: order._id,
      updates: {
        message,
        status: message === "Processing" ? "PROCESSING" : (shouldContinue ? order.orderStatus : "FAILED"),
        isBusy: false,
        isActive: shouldContinue,
      },
    });
  }
};

/**
 * Handles post-buy logic: calculating average entry price, TP/SL, and accumulating positions.
 */
export const convertOpenOrder = async ({ order, executionResult }) => {
  try {
    const { feeInUsd, payInUsd, totalReceived } = executionResult;
    const decimalsBI = BigInt(expandDecimals(1, order.orderAsset.orderToken.decimals || 18));

    const feeBI = BigInt(feeInUsd);
    const payBI = BigInt(payInUsd);
    const receiveBI = BigInt(totalReceived);

    // If Technical Exit is active, we don't set fixed price targets
    if (order.exit?.isTechnicalExit && order.exit?.technicalLogic) {
      return await updateOrder({
        orderId: order._id,
        updates: {
          message: "Technical Exit Activated",
          status: "OPENED",
          type: "SELL",
          isBusy: false,
          isActive: true,
        },
      });
    }

    let totalExecutionFee = feeBI + payBI;
    let totalTokenAmount = receiveBI;
    
    // Calculate Entry Price (Cost Basis)
    const entryPrice = totalTokenAmount > 0n 
        ? (payBI * decimalsBI) / totalTokenAmount 
        : 0n;

    // Handle Accumulation Strategy (DCA)
    let accumulatedOrders = [];
    if (ACCUMULATE_STRATEGY.includes(order.strategy)) {
      accumulatedOrders = await OrderModel.find({
        name: order.name,
        strategy: order.strategy,
        orderStatus: "OPENED",
        isActive: true,
        isBusy: false,
        orderType: "SELL",
      });

      accumulatedOrders.forEach((o) => {
        totalExecutionFee += BigInt(o.executionFee.payInUsd || 0) + BigInt(o.executionFee.feeInUsd || 0);
        totalTokenAmount += BigInt(o.amount.tokenAmount || 0);
      });
    }

    // Calculate TP/SL
    const tpPercent = BigInt(order.exit.takeProfit.takeProfitPercentage || DEFAULT_TAKE_PROFIT_PERCENTAGE);
    const profitUsd = (totalExecutionFee * tpPercent) / BASIS_POINT_DIVISOR_BIGINT;
    const totalExpected = profitUsd + totalExecutionFee;
  
    const takeProfitPrice = totalTokenAmount > 0n 
        ? (totalExpected * decimalsBI) / totalTokenAmount 
        : 0n;

    let stopLossPrice = 0n;
    let saveUsd = 0n;
    
    if (order.exit.stopLoss.isActive) {
      const slPercent = BigInt(order.exit.stopLoss.stopLossPercentage || DEFAULT_STOP_LOSS_PERCENTAGE);
      saveUsd = (totalExecutionFee * (BigInt(BASIS_POINT_DIVISOR) - slPercent)) / BASIS_POINT_DIVISOR_BIGINT;
      stopLossPrice = totalTokenAmount > 0n 
          ? (saveUsd * decimalsBI) / totalTokenAmount 
          : 0n;
    }

    // Update Primary Order
    await updateOrder({
      orderId: order._id,
      updates: {
        status: "OPENED",
        message: 'Successfully opened order',
        type: "SELL",
        profitUsd: profitUsd,
        saveUsd: saveUsd,
        takeProfitPrice,
        stopLossPrice,
        tokenAmount: receiveBI,
        feeInUsd: feeBI,
        payInUsd: payBI,
        entryPrice,
        isBusy: false,
        isActive: true,
      },
    });

    // Sync TP/SL across accumulated positions
    if (accumulatedOrders.length > 0) {
      await Promise.all(
        accumulatedOrders.map((o) => {
          const oAmountBI = BigInt(o.amount.tokenAmount);
          return updateOrder({
            orderId: o._id,
            updates: {
              takeProfitPrice,
              stopLossPrice,
              profitUsd: (takeProfitPrice * oAmountBI) / decimalsBI,
              saveUsd: (stopLossPrice * oAmountBI) / decimalsBI,
            },
          });
        })
      );
    }
  } catch (err) {
    throwError({ message: "Processing Error in Convert", shouldContinue: true });
  }
};

/**
 * Executes a SELL order (Exit).
 */
export const closeOpenOrder = async (order, tokenData) => {
  if (order.orderStatus !== "OPENED" || order.isBusy) return;

  try {
    const { orderAsset, wallet, chainId, slippage, amount } = order;
    const tokenIn = orderAsset.orderToken.address;
    const tokenOut = orderAsset.outputToken.address;
    const amountIn = amount.tokenAmount;
    const signer = getSigner(wallet.encryptedWalletKey, wallet.network);
    const connectionProvider = getConnectionProvider(chainId);
    
    const wrappedNative = chainConfig[chainId].nativeToken;
    const outputToken = orderAsset.outputToken;

    // Safe price lookups
    const nativePriceUsd = COLLATERAL_TOKEN_DATA_MAP.get(`${chainId}:${wrappedNative.address.toLowerCase()}`) || 0n;
    const outputTokenPriceUsd = COLLATERAL_TOKEN_DATA_MAP.get(`${chainId}:${outputToken.address.toLowerCase()}`) || 0n;

    const executionResult = await executeSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      connectionProvider,
      signer,
    });

    if (executionResult?.success && executionResult.signature && BigInt(executionResult.totalReceived) > 0n) {
      
      let tradeFee = (BigInt(executionResult.totalReceived) * ORDER_TRADE_FEE) / BASIS_POINT_DIVISOR_BIGINT;
      let tradeFeeInUsd = (tradeFee * outputTokenPriceUsd) / expandDecimals(1, outputToken.decimals) || 0n;
      let tradeFeeTxFeeInUsd = 0n;

      if (tradeFee > 0n) {
        // FIX: Pass 'order' object to match fees.js signature
        const tradeFeeTx = await getTradeFee({
          order: order,
          chainId,
          amount: tradeFee,
          token: { address: tokenOut }, // Fee is taken from output token
          signer,
        });

        if (tradeFeeTx.success === true) {
          tradeFeeTxFeeInUsd = convertToUsd(BigInt(tradeFeeTx.fee), wrappedNative.decimals, nativePriceUsd);
          
          addActivity({
            orderId: order._id,
            walletId: order.wallet._id,
            userId: order.user._id,
            type: "TRADE FEE",
            status: "Success",
            chainId,
            txHash: tradeFeeTx.signature,
            payToken: { ...outputToken, amount: tradeFee.toString(), amountInUsd: tradeFeeInUsd.toString() },
            feeToken: { feeAmount: tradeFeeTx.fee, feeInUsd: tradeFeeTxFeeInUsd.toString() },
          }).catch(e => logger.error(`[Activity Log Error]: ${e.message}`));
        }
      }

      // Financial Calculations
      const receivedInUsd = convertToUsd(executionResult.totalReceived, outputToken.decimals, outputTokenPriceUsd);
      const feeInUsd = convertToUsd(executionResult.fee, wrappedNative.decimals, nativePriceUsd) + tradeFeeTxFeeInUsd;
      const originalCost = BigInt(order.executionFee.payInUsd || 0) + BigInt(order.executionFee.feeInUsd || 0);
      
      // Realized PnL = (Received - Protocol Fee Value) - (Tx Fees) - (Original Entry Cost)
      const realizedPnl = (receivedInUsd - tradeFeeInUsd) - feeInUsd - originalCost;

      // Calculate Exit Price
      const totalReceivedBI = BigInt(executionResult.totalReceived);
      const outputDecimals = BigInt(expandDecimals(1, outputToken.decimals));
      const exitPriceUsd = totalReceivedBI > 0n 
         ? (receivedInUsd * outputDecimals) / totalReceivedBI 
         : outputTokenPriceUsd;

      const isReEntry = order.reEntrance?.isReEntrance;

      await updateOrder({
        orderId: order._id,
        updates: {
          status: isReEntry ? "PENDING" : "CLOSED",
          type: isReEntry ? "BUY" : "SELL",
          exitPrice: exitPriceUsd,
          realizedPnl,
          message: "Execution Successful",
          isBusy: false,
          isActive: isReEntry,
          retry: isReEntry ? (order.additional?.retry || 0) + 1 : undefined,
        },
      });
    }
  } catch (err) {
    const { message } = handleError(err);
    await updateOrder({
      orderId: order._id,
      updates: { message, isBusy: false },
    });
  }
};