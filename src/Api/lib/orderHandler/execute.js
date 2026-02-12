import OrderModel from "../../../../src/Api/model/order.js";
import { getSigner } from "../walletHandler/generate.js";
import { executeSwap } from "../../blockchain/common/executeSwap.js";
import { getTxInfoFromSignature } from "../../blockchain/common/transfer.js";
import { withdraw } from "../transfer/withdraw.js";
import { addActivity, updateActivity } from "../activity/activityLog.js";
import { getWalletGuard } from "../walletHandler/walletGurd.js";
import { ZeroAddress } from "ethers";
import logger from "../../logger.js"; // Added missing import
import {
  safeParseUnits,
  convertToUsd,
  expandDecimals,
} from "../utility/number.js";
import {
  chains,
  chainConfig,
  getConnectionProvider,
} from "../../constant/common/chain.js";
import { spotNetworkFee } from "../../blockchain/common/networkFee.js";
import {
  PRECISION_DECIMALS,
  BASIS_POINT_DIVISOR_BIGINT,
  BASIS_POINT_DIVISOR,
  ACCUMULATE_STRATEGY,
  DEFAULT_TAKE_PROFIT_PERCENTAGE,
  DEFAULT_STOP_LOSS_PERCENTAGE,
  ORDER_TRADE_FEE,
  ORDER_TRADE_FEE_EXEMPT_STATUS,
  ORDER_PRIORITY_FEE,
  EVM_ORDER_TRADE_FEE_COLLECTOR,
  SOLANA_ORDER_TRADE_FEE_COLLECTOR,
} from "../../constant/common/order.js";
import { COLLATERAL_TOKEN_DATA_MAP } from "../../../Listener/listen/token.js";

export const getOrderTradeFee = (userStatus, orderPriority) => {
  let tradeFee = BigInt(0);
  if (!ORDER_TRADE_FEE_EXEMPT_STATUS.includes(userStatus)) {
    tradeFee = ORDER_TRADE_FEE;
    if (orderPriority == 2) {
      tradeFee += ORDER_PRIORITY_FEE;
    }
  }

  return tradeFee;
};

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
    inProcessing: "additional.inProcessing",
  };

  Object.keys(updates).forEach((key) => {
    if (updates[key] !== undefined && fieldMap[key]) {
      const val = updates[key];
      updatePayload[fieldMap[key]] =
        typeof val === "bigint" ? val.toString() : val;
    }
  });

  return await OrderModel.updateOne({ _id: orderId }, { $set: updatePayload });
};

export const openSpotOrder = async ({ orderId, tokenData }) => {
  // 1. Fetch order with populated data
  const orderData = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      orderStatus: "PENDING",
      isBusy: false,
      $or: [
        { "additional.retry": { $lt: 3 } },
        { "additional.retry": { $exists: false } },
      ],
    },
    {
      $set: {
        orderStatus: "PROCESSING",
        isBusy: true,
        message: "PROCESSING_ORDER",
      },
      $inc: { "additional.retry": 1 },
    },
    {
      new: true,
      populate: [
        { path: "user", select: "_id account status defaultWallet" },
        { path: "wallet", select: "_id address encryptedWalletKey network" },
      ],
    },
  ).catch((MongoErr) => {
    logger.warn(`MONGO_FAILED_GET_BUY_ORDER%orderId:${orderId}%error:${MongoErr.message || JSON.stringify(MongoErr)}`);
    return;
  });

  if (!orderData) {
    logger.warn(`BUY_ORDER_NOT_EXIST%orderId:${orderId}`);
    return;
  }

  //2. Get order properties
  const { orderAsset, wallet, slippage, chainId, amount, user, priority } =
    orderData;
  const userStatus = user?.status;
  const wrappedNative = chainConfig[chainId]?.nativeToken;
  const collateralToken = orderAsset.collateralToken;
  const orderToken = orderAsset.orderToken;
  const tokenIn = collateralToken.address;
  const tokenOut = orderToken.address;
  const amountIn = BigInt(amount.orderSize || "0");
  const walletAddress = wallet?.address;

  // Validate required data
  if (
    !wrappedNative ||
    !tokenIn ||
    !tokenOut ||
    amountIn == 0n ||
    !walletAddress ||
    !wallet?.encryptedWalletKey ||
    !wallet.network ||
    !userStatus
  ) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "INVALID_ORDER",
        isBusy: false,
      },
    });
    return;
  }

  //3. Getting Signer and connection providers
  const signer = getSigner(wallet.encryptedWalletKey, wallet.network);
  const connectionProvider = getConnectionProvider(chainId);

  if (!signer || !connectionProvider) {
    await updateOrder({
      orderId,
      updates: {
        message: "SIGNER_FAILED",
        isBusy: false,
      },
    });
    return;
  }

  //4. Calculating trading fee
  const tradeFee = getOrderTradeFee(userStatus, priority);
  const tradeFeeAmount = (amountIn * tradeFee) / BASIS_POINT_DIVISOR_BIGINT;
  const tradeFeeCollector =
    chains.Solana === chainId
      ? SOLANA_ORDER_TRADE_FEE_COLLECTOR
      : EVM_ORDER_TRADE_FEE_COLLECTOR;
  const networkFee = await spotNetworkFee(chainId);
  const totalCollateralAmount = tradeFeeAmount + amountIn;

  // 5. Check wallet funds using WalletGuard
  const walletState = getWalletGuard(walletAddress);
  let hasFunds = false;

  try {
    if (tokenIn === ZeroAddress) {
      hasFunds = await walletState.assetHasSufficientFunds({
        chainId,
        tokenAddress: tokenIn,
        amountRequired: totalCollateralAmount + networkFee,
      });
    } else {
      const [hasNativeFunds, hasTokenFund] = await Promise.all([
        walletState.assetHasSufficientFunds({
          chainId,
          tokenAddress: ZeroAddress,
          amountRequired: networkFee,
        }),
        walletState.assetHasSufficientFunds({
          chainId,
          tokenAddress: tokenIn,
          amountRequired: totalCollateralAmount,
        }),
      ]);
      hasFunds = hasNativeFunds && hasTokenFund;
    }
  } catch (fundError) {
    await updateOrder({
      orderId,
      updates: {
        message: `WALLET_FAILED`,
        isBusy: false,
      },
    });
    logger.error(`FUNDS_CHECK_FAILED%orderId:${orderId}%walletId:${wallet._id}%error:${fundError.message || JSON.stringify(fundError)}`);
    return;
  }

  if (!hasFunds) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "INSUFFICIENT_FUND",
        isBusy: false,
      },
    });
    return;
  }

  // 6. Lock funds in WalletGuard
  try {
    if (tokenIn === ZeroAddress) {
      walletState.addPendingSpend({
        chainId,
        tokenAddress: ZeroAddress,
        amount: totalCollateralAmount + networkFee,
      });
    } else {
      walletState.addPendingSpend({
        chainId,
        tokenAddress: ZeroAddress,
        amount: networkFee,
      });
      walletState.addPendingSpend({
        chainId,
        tokenAddress: tokenIn,
        amount: totalCollateralAmount,
      });
    }
  } catch (lockError) {
    await updateOrder({
      orderId,
      updates: {
        message: "WALLET_FAILED",
        isBusy: false,
      },
    });
    logger.error(`FUND_LOCK_FAILED%orderId:${orderId}%walletAddress:${wallet.address}%error:${lockError.message || JSON.stringify(lockError)}`);
    return;
  }

  const inProcessing = {
    activityId: null,
    processType: "BUY",
    nativePriceUsd: null,
    tokenPriceUsd: null,
    collateralPriceUsd: null,
    oracleCalculation: false,
    tradeFee: {
      executed: false,
      amount: tradeFeeAmount.toString(),
    },
    tx: {
      signature: null,
      amountOut: null,
      fee: null,
    },
  };

  let executionResult;
  try {
    // 7. Execute the swap transaction
    executionResult = await executeSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      signer,
      connectionProvider,
      option: {walletAddress}
    });

    if (!executionResult?.success || !executionResult.signature) {
      await updateOrder({
        orderId,
        updates: {
          status: executionResult.retry ? "PENDING" : "FAILED",
          message: executionResult.errorLabel || 'TX_FAILED',
          isBusy: false,
        },
      });
      logger.error(`ORDER_BUY_TRANSACTION_FAILED%orderId:${orderId}%error:${executionResult.error})}`);
      return;
    }
    inProcessing.tx.signature = executionResult.signature;
  } catch (txError) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "TX_FAILED",
        isBusy: false,
      },
    });
    logger.error(`ORDER_BUY_TRANSACTION_FAILED%orderId:${orderId}%error:${txError.message || JSON.stringify(txError)})}`);
    return;
  } finally {
    try {
      if (tokenIn === ZeroAddress) {
        walletState.removePendingSpend({
          chainId,
          tokenAddress: ZeroAddress,
          amount: totalCollateralAmount + networkFee,
        });
      } else {
        walletState.removePendingSpend({
          chainId,
          tokenAddress: ZeroAddress,
          amount: networkFee,
        });
        walletState.removePendingSpend({
          chainId,
          tokenAddress: tokenIn.toLowerCase(),
          amount: totalCollateralAmount,
        });
      }
    } catch (unlockError) {
      logger.error(`FUND_UNLOCK_FAILED%orderId:${orderId}%error:${unlockError.message || JSON.stringify(unlockError)})}`);
    }
  }

  try {
    // 8. Get token prices early for calculations
    inProcessing.nativePriceUsd =
      COLLATERAL_TOKEN_DATA_MAP.get(
        `${chainId}:${wrappedNative.address.toLowerCase()}`,
      ) || 0;

    inProcessing.tokenPriceUsd =
      safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS).toString() || 0;

    inProcessing.collateralPriceUsd = collateralToken.address == ZeroAddress ? inProcessing.nativePriceUsd :
      COLLATERAL_TOKEN_DATA_MAP.get(
        `${chainId}:${collateralToken.address.toLowerCase()}`,
      ) || 0;

    const totalReceived = BigInt(executionResult.totalReceived || "0");
    const txFeeAmount = BigInt(executionResult.fee || "0");
    inProcessing.tx.amountOut = totalReceived.toString();
    inProcessing.tx.fee = txFeeAmount.toString();

    // 9. Calculate USD values for activity logging
    let feeInUsd = convertToUsd(
      txFeeAmount,
      wrappedNative.decimals || 18,
      BigInt(inProcessing.nativePriceUsd),
    );

    let payInUsd = convertToUsd(
      amountIn,
      collateralToken.decimals || 18,
      BigInt(inProcessing.collateralPriceUsd),
    );

    // 10. Log activity (non-blocking)
    const activityLogId = await addActivity({
      orderId: orderData._id,
      walletId: orderData.wallet._id,
      userId: orderData.user._id,
      type: "BUY TRADE",
      status: "Success",
      chainId,
      txHash: executionResult.signature,
      indexTokenAddress: orderToken.address,
      payToken: {
        ...collateralToken,
        amount: amountIn.toString(),
        amountInUsd: payInUsd.toString(),
      },
      receiveToken: {
        ...orderToken,
        amount: totalReceived.toString(),
        amountInUsd: convertToUsd(
          totalReceived,
          orderToken.decimals || 18,
          BigInt(inProcessing.tokenPriceUsd),
        ).toString(),
      },
      txFee: {
        feeAmount: executionResult.fee,
        feeInUsd: feeInUsd.toString(),
      },
    });

    inProcessing.activityId = activityLogId;
    // 11. Execute trade fee if applicable
    if (tradeFee > 0n && tradeFeeAmount > 0n) {
      try {
        let tradeFeeExecutionResult = await withdraw({
          walletData: wallet,
          chainId,
          receiver: tradeFeeCollector,
          value: tradeFeeAmount,
          token: collateralToken,
          user: orderData.user,
          option: {
            nativePriceUsd: BigInt(inProcessing.nativePriceUsd  || 0),
            tokenPriceUsd: BigInt(inProcessing.collateralPriceUsd || 0),
            type: "TRADE_FEE",
            orderId,
          },
        });

        if (tradeFeeExecutionResult.signature) {
          inProcessing.tradeFee = tradeFeeExecutionResult;
          feeInUsd += BigInt(tradeFeeExecutionResult.feeInUsd || 0);
          payInUsd += BigInt(tradeFeeExecutionResult.valueInUsd || 0);
        } else {
          throw new Error("Trade fee execution failed");
        }
      } catch (tradeFeeErr) {
        await updateOrder({
          orderId,
          updates: {
            status: "PROCESSING",
            message: "TRADE_FEE_EXECUTED_FAILED",
            isActive: true,
            isBusy: false,
            inProcessing: inProcessing,
          },
        });
        logger.error(`TRADE_FEE_EXECUTED_FAILED%orderId:${orderId}%error:${tradeFeeErr.message || JSON.stringify(tradeFeeErr)}`);
        return;
      }
    } else {
      inProcessing.tradeFee.executed = true;
      inProcessing.tradeFee.amount = "0";
    }

    //12. check amountOut and fee
    if (
      !totalReceived ||
      totalReceived <= 0n ||
      txFeeAmount <= 0n ||
      !txFeeAmount
    ) {
      await updateOrder({
        orderId,
        updates: {
          status: "PROCESSING",
          message: "TX_PROCESSING_FAILED",
          isActive: true,
          isBusy: false,
          inProcessing: inProcessing,
        },
      });
      logger.error(
        `ORDER_EXECUTED_RECEIVE_AMOUNT_NOT_FOUND%orderId:${orderId}`,
      );
      return;
    }

    // 13. Price and usd calculation
    if (
      feeInUsd === 0n ||
      payInUsd === 0n ||
      inProcessing.nativePriceUsd <= 0n ||
      inProcessing.tokenPriceUsd <= 0n ||
      inProcessing.collateralPriceUsd <= 0n
    ) {
      await updateOrder({
        orderId,
        updates: {
          status: "PROCESSING",
          message: "PRICE_NOT_FETCHED",
          isActive: true,
          isBusy: false,
          inProcessing: inProcessing,
        },
      });
      logger.error(`EXECUTED_BUT_PRICE_NOT_FETCHED%orderId:${orderId}`);
      return;
    }

    inProcessing.oracleCalculation = true;

    // 14. Handle technical exit or convert to opened order
    if (orderData.exit?.isTechnicalExit === true) {
      await updateOrder({
        orderId: orderData._id,
        updates: {
          tokenAmount: totalReceived.toString(),
          feeInUsd: feeInUsd.toString(),
          payInUsd: payInUsd.toString(),
          message: "ORDER_OPENED",
          status: "OPENED",
          type: "SELL",
          isBusy: false,
          isActive: true,
          inProcessing: inProcessing,
          retry: 0,
        },
      });
    } else {
      await convertOpenOrder({
        order: orderData,
        executionResult: {
          feeInUsd,
          payInUsd,
          totalReceived,
          tokenPriceUsd: inProcessing.tokenPriceUsd,
        },
      });
    }
  } catch (globalError) {
    // Catch-all for any unexpected errors
    logger.error(
      `PENDING_SPOT_ORDER_UNEXPECTED_ERROR%orderId:${orderId}%error:${globalError.message || JSON.stringify(globalError)}`,
    );

    // Try to set order to PROCESSING for later retry
    if (orderData?._id) {
      try {
        await updateOrder({
          orderId,
          updates: {
            status: "PROCESSING",
            message: `UNEXPECTED_ERROR`,
            isBusy: false,
          },
        });
      } catch (updateError) {
        logger.error(
          `ORDER_UPDATE_AFTER_ERROR_FAILED%orderId:${orderId}%error:${updateError.message || JSON.stringify(updateError)}`,
        );
      }
    }
  }
};

export const convertOpenOrder = async ({ order, executionResult }) => {
  const { feeInUsd, payInUsd, totalReceived, tokenPriceUsd } = executionResult;
  const decimalsBI = BigInt(
    expandDecimals(1, order.orderAsset.orderToken.decimals || 18),
  );

  let totalExecutionFee = feeInUsd + payInUsd;
  let totalTokenAmount = totalReceived;

  // Calculate Entry Price (Cost Basis)
  const entryPrice =
    (payInUsd * decimalsBI) / totalTokenAmount || BigInt(tokenPriceUsd);

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
      totalExecutionFee +=
        BigInt(o.executionFee.payInUsd || 0) +
        BigInt(o.executionFee.feeInUsd || 0);
      totalTokenAmount += BigInt(o.amount.tokenAmount || 0);
    });
  }

  // Calculate TP/SL
  const tpPercent = BigInt(
    order.exit.takeProfit.takeProfitPercentage ||
      DEFAULT_TAKE_PROFIT_PERCENTAGE,
  );
  const profitUsd =
    (totalExecutionFee * tpPercent) / BASIS_POINT_DIVISOR_BIGINT;
  const totalExpected = profitUsd + totalExecutionFee;

  const takeProfitPrice =
    totalTokenAmount > 0n
      ? (totalExpected * decimalsBI) / totalTokenAmount
      : 0n;

  let stopLossPrice = 0n;
  let saveUsd = 0n;

  if (order.exit.stopLoss.isActive) {
    const slPercent = BigInt(
      order.exit.stopLoss.stopLossPercentage || DEFAULT_STOP_LOSS_PERCENTAGE,
    );
    saveUsd =
      (totalExecutionFee * (BigInt(BASIS_POINT_DIVISOR) - slPercent)) /
      BASIS_POINT_DIVISOR_BIGINT;
    stopLossPrice =
      totalTokenAmount > 0n ? (saveUsd * decimalsBI) / totalTokenAmount : 0n;
  }

  // Update Primary Order
  await updateOrder({
    orderId: order._id,
    updates: {
      status: "OPENED",
      message: "ORDER_OPENED",
      type: "SELL",
      profitUsd: profitUsd.toString(),
      saveUsd: saveUsd.toString(),
      takeProfitPrice,
      stopLossPrice,
      tokenAmount: totalReceived.toString(),
      feeInUsd: feeInUsd.toString(),
      payInUsd: payInUsd.toString(),
      retry: 0,
      entryPrice,
      isBusy: false,
      inProcessing: null,
      isActive: true,
    },
  });

  // Sync TP/SL across accumulated positions
  if (accumulatedOrders.length > 0) {
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
      }).catch((updateErr) => {
        logger.error(
          `ORDER_ACCUMULATION_UPDATE_FAILED%orderId:${o._id}%error:${updateErr.message || JSON.stringify(updateErr)}`,
        );
      });
    });
  }
};

export const closeOpenOrder = async ({ orderId, tokenData }) => {
  // 1. Fetch order with populated data
  const orderData = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      orderStatus: { $in: ["PENDING", "OPENED"] },
      isBusy: false,
      $or: [
        { "additional.retry": { $lt: 3 } },
        { "additional.retry": { $exists: false } },
      ],
    },
    {
      $set: {
        orderStatus: "PROCESSING",
        isBusy: true,
        message: "PROCESSING_ORDER",
      },
      $inc: { "additional.retry": 1 },
    },
    {
      new: true,
      populate: [
        { path: "user", select: "_id account status defaultWallet" },
        { path: "wallet", select: "_id address encryptedWalletKey network" },
      ],
    },
  ).catch((MongoErr) => {
    logger.warn(`MONGO_FAILED_SELL_ORDER%orderId:${orderId}%error:${MongoErr.message || JSON.stringify(MongoErr)}`);
    return;
  });

  if (!orderData) {
    logger.warn(`SELL_ORDER_NOT_EXIST%orderId:${orderId}`);
    return;
  }

  //2. Get order properties
  const { orderAsset, wallet, slippage, chainId, amount, user, priority } =
    orderData;
  const userStatus = user?.status;
  const wrappedNative = chainConfig[chainId]?.nativeToken;
  const outputToken = orderAsset.outputToken;
  const orderToken = orderAsset.orderToken;
  const tokenIn = orderToken.address;
  const tokenOut = outputToken.address;
  const amountIn = BigInt(amount.tokenAmount || "0");
  const walletAddress = wallet?.address;

  // Validate required data
  if (
    !wrappedNative ||
    !tokenIn ||
    !tokenOut ||
    amountIn == 0n ||
    !walletAddress ||
    !wallet?.encryptedWalletKey ||
    !wallet.network ||
    !userStatus
  ) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "INVALID_ORDER",
        isBusy: false,
      },
    });
    return;
  }

  //3. Getting Signer and connection providers
  const signer = getSigner(wallet.encryptedWalletKey, wallet.network);
  const connectionProvider = getConnectionProvider(chainId);

  if (!signer || !connectionProvider) {
    await updateOrder({
      orderId,
      updates: {
        message: "SIGNER_FAILED",
        isBusy: false,
      },
    });
    return;
  }

  // 4. Check wallet funds using WalletGuard
  const networkFee = await spotNetworkFee(chainId);
  const walletState = getWalletGuard(walletAddress);
  let hasFunds = false;

  try {
    const [hasNativeFunds, hasTokenFund] = await Promise.all([
      walletState.assetHasSufficientFunds({
        chainId,
        tokenAddress: ZeroAddress,
        amountRequired: networkFee,
      }),
      walletState.assetHasSufficientFunds({
        chainId,
        tokenAddress: tokenIn,
        amountRequired: amountIn,
      }),
    ]);
    hasFunds = hasNativeFunds && hasTokenFund;
  } catch (fundError) {
    await updateOrder({
      orderId,
      updates: {
        message: `WALLET_FAILED`,
        isBusy: false,
      },
    });
    logger.error(`FUNDS_CHECK_FAILED%orderId:${orderId}%error:${fundError.message || JSON.stringify(fundError)}`);
    return;
  }

  if (!hasFunds) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "INSUFFICIENT_FUND",
        isBusy: false,
      },
    });
    return;
  }

  // 5. Lock funds in WalletGuard
  try {
    walletState.addPendingSpend({
      chainId,
      tokenAddress: ZeroAddress,
      amount: networkFee,
    });
    walletState.addPendingSpend({
      chainId,
      tokenAddress: tokenIn,
      amount: amountIn,
    });
  } catch (lockError) {
    await updateOrder({
      orderId,
      updates: {
        message: "WALLET_FAILED",
        isBusy: false,
      },
    });
    logger.error(`FUND_LOCK_FAILED%orderId:${orderId}%error:${lockError.message || JSON.stringify(lockError)}`);
    return;
  }

  const inProcessing = {
    activityId: null,
    processType: "SELL",
    nativePriceUsd: null,
    tokenPriceUsd: null,
    outputPriceUsd: null,
    oracleCalculation: false,
    tradeFee: {
      executed: false,
      amount: "0",
    },
    tx: {
      signature: null,
      amountOut: null,
      fee: null,
    },
  };

  let executionResult;
  try {
    // 6. Execute the swap transaction
    executionResult = await executeSwap({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
      chainId,
      signer,
      connectionProvider,
      option: {walletAddress}
    });
    if (!executionResult?.success || !executionResult.signature) {
      await updateOrder({
        orderId,
        updates: {
          status: executionResult.retry ? "OPENED" : "FAILED",
          message: executionResult.errorLabel || 'TX_FAILED',
          isBusy: false,
        },
      });
      logger.error(`ORDER_BUY_TRANSACTION_FAILED%orderId:${orderId}%error:${executionResult.error})}`);
      return;
    }
    inProcessing.tx.signature = executionResult.signature;
  } catch (txError) {
    await updateOrder({
      orderId,
      updates: {
        status: "FAILED",
        message: "TX_FAILED",
        isBusy: false,
      },
    });
    logger.error(`ORDER_SELL_TRANSACTION_FAILED%orderId:${orderId}%error:${txError.message || JSON.stringify(txError)})}`);
    return;
  } finally {
    try {
      walletState.removePendingSpend({
        chainId,
        tokenAddress: ZeroAddress,
        amount: networkFee,
      });
      walletState.removePendingSpend({
        chainId,
        tokenAddress: tokenIn.toLowerCase(),
        amount: amountIn,
      });
      walletState.updateBalance({
        chainId,
        tokenAddress: tokenIn,
        updateState: true,
      });
      walletState.updateBalance({
        chainId,
        tokenAddress: ZeroAddress,
        updateState: true,
      });
    } catch (unlockError) {
      logger.error(`FUND_UNLOCK_FAILED%orderId:${orderId}%error:${unlockError.message || JSON.stringify(unlockError)}`);
    }
  }

  try {
    // 7. Get token prices early for calculations
    inProcessing.nativePriceUsd =
      COLLATERAL_TOKEN_DATA_MAP.get(
        `${chainId}:${wrappedNative.address.toLowerCase()}`,
      ) || 0 ;

    inProcessing.tokenPriceUsd =
      safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS).toString() || 0;

    inProcessing.outputPriceUsd = outputToken.address == ZeroAddress ? 
      inProcessing.nativePriceUsd: COLLATERAL_TOKEN_DATA_MAP.get(
        `${chainId}:${outputToken.address.toLowerCase()}`,
      ) || 0;

    const totalReceived = BigInt(executionResult.totalReceived || "0");
    const txFeeAmount = BigInt(executionResult.fee || "0");
    inProcessing.tx.amountOut = totalReceived.toString();
    inProcessing.tx.fee = txFeeAmount.toString();

    // 8. Calculate USD values for activity logging
    let feeInUsd =
      convertToUsd(
        txFeeAmount,
        wrappedNative.decimals || 18,
        BigInt(inProcessing.nativePriceUsd),
      ) || 0n;

    let payInUsd =
      convertToUsd(
        amountIn,
        orderToken.decimals || 18,
        BigInt(inProcessing.tokenPriceUsd),
      ) || 0n;

    let receiveInUsd =
      convertToUsd(
        totalReceived,
        outputToken.decimals,
        BigInt(inProcessing.outputPriceUsd),
      ) || 0n;

    // 9. Log activity (non-blocking)
    const activityLogId = await addActivity({
      orderId: orderData._id,
      walletId: orderData.wallet._id,
      userId: orderData.user._id,
      type: "SELL TRADE",
      status: "Success",
      chainId,
      txHash: executionResult.signature,
      indexTokenAddress: orderToken.address,
      payToken: {
        ...orderToken,
        amount: amountIn.toString(),
        amountInUsd: payInUsd.toString(),
      },
      receiveToken: {
        ...outputToken,
        amount: totalReceived.toString(),
        amountInUsd: receiveInUsd.toString(),
      },
      txFee: {
        feeAmount: executionResult.fee,
        feeInUsd: feeInUsd.toString(),
      },
    });

    inProcessing.activityId = activityLogId;
    //9. Calculate trade fee
    const tradeFee = getOrderTradeFee(userStatus, priority);
    const tradeFeeAmount =
      (totalReceived * tradeFee) / BASIS_POINT_DIVISOR_BIGINT;
    const tradeFeeCollector =
      chains.Solana === chainId
        ? SOLANA_ORDER_TRADE_FEE_COLLECTOR
        : EVM_ORDER_TRADE_FEE_COLLECTOR;
    inProcessing.tradeFee.amount = tradeFeeAmount.toString();
    // 10. Execute trade fee if applicable
    if (tradeFee > 0n && tradeFeeAmount > 0n) {
      try {
        let tradeFeeExecutionResult = await withdraw({
          walletData: wallet,
          chainId,
          receiver: tradeFeeCollector,
          value: tradeFeeAmount,
          token: outputToken,
          user: orderData.user,
          option: {
            nativePriceUsd: BigInt(inProcessing.nativePriceUsd || 0),
            tokenPriceUsd: BigInt(inProcessing.outputPriceUsd || 0),
            type: "TRADE_FEE",
            orderId,
          },
        });

        if (tradeFeeExecutionResult.signature) {
          inProcessing.tradeFee = tradeFeeExecutionResult;
          feeInUsd += BigInt(tradeFeeExecutionResult.feeInUsd || "0");
          receiveInUsd -= BigInt(tradeFeeExecutionResult.valueInUsd || "0");
        } else {
          throw new Error("Trade fee execution failed");
        }
      } catch (tradeFeeErr) {
        await updateOrder({
          orderId,
          updates: {
            status: "PROCESSING",
            message: "TRADE_FEE_EXECUTED_FAILED",
            isActive: true,
            isBusy: false,
            inProcessing: inProcessing,
          },
        });
        logger.error(`TRADE_FEE_EXECUTED_FAILED%orderId:${orderId}%error:${tradeFeeErr.message || JSON.stringify(tradeFeeErr)}`);
        return;
      }
    } else {
      inProcessing.tradeFee.executed = true;
      inProcessing.tradeFee.amount = "0";
    }
    //11. check amountOut and fee
    if (
      !totalReceived ||
      totalReceived <= 0n ||
      txFeeAmount <= 0n ||
      !txFeeAmount
    ) {
      await updateOrder({
        orderId,
        updates: {
          status: "PROCESSING",
          message: "TX_PROCESSING_FAILED",
          isActive: true,
          isBusy: false,
          inProcessing: inProcessing,
        },
      });
      return;
    }

    // 12. validate Price and usd calculation
    if (feeInUsd === 0n || receiveInUsd === 0n) {
      await updateOrder({
        orderId,
        updates: {
          status: "PROCESSING",
          message: "PRICE_NOT_FETCHED",
          isActive: true,
          isBusy: false,
          inProcessing: inProcessing,
        },
      });
      return;
    }
    inProcessing.oracleCalculation = true;

    const orderCostUsd =
      BigInt(orderData.executionFee.feeInUsd || "0") +
      BigInt(orderData.executionFee.payInUsd || "0");
    const realizePnl = receiveInUsd - (feeInUsd + orderCostUsd);
    //13. Update open order reEntrance if true
    await updateOrder({
      orderId,
      updates: {
        status: !orderData.reEntrance.isReEntrance ? "CLOSED" : "PENDING",
        type: !orderData.reEntrance.isReEntrance ? "STOPPED" : "BUY",
        exitPrice: inProcessing.tokenPriceUsd || '0',
        isActive: true,
        isBusy: false,
        realizedPnl: realizePnl.toString(),
        profitUsd: "0",
        saveUsd: "0",
        takeProfitPrice: "0",
        stopLossPrice: "0",
        retry: 0
      },
    });
  } catch (globalError) {
    console.log(globalError);
    // Catch-all for any unexpected errors
    logger.error(`OPEN_SPOT_ORDER_UNEXPECTED_ERROR%orderId:${orderId}%error:${globalError.message || JSON.stringify(globalError)}`);

    // Try to set order to PROCESSING for later retry
    if (orderData?._id) {
      try {
        await updateOrder({
          orderId,
          updates: {
            status: "PROCESSING",
            message: `UNEXPECTED_ERROR`,
            isBusy: false,
          },
        });
      } catch (updateError) {
        logger.error(
          `ORDER_UPDATE_AFTER_ERROR_FAILED%orderId:${orderId}%error:${updateError.message || JSON.stringify(updateError)}`,
        );
      }
    }
  }
};

export const processOrder = async ({ orderId, tokenData }) => {
  // 1. Fetch order with populated data - FIXED: $inc syntax
  const orderData = await OrderModel.findOneAndUpdate(
    {
      _id: orderId,
      orderStatus: "PROCESSING",
      isBusy: false,
      "additional.inProcessing": { $ne: null },
    },
    {
      $set: {
        isBusy: true,
        message: "Resuming order processing",
      },
      $inc: { "additional.retry": 1 },
    },
    {
      new: true,
      populate: [
        { path: "user", select: "_id account status defaultWallet" },
        { path: "wallet", select: "_id address encryptedWalletKey network" },
      ],
    },
  ).catch((MongoErr) => {
    logger.warn(`MONGO_FAILED_PROCESS_ORDER%orderId:${orderId}%error:${MongoErr.message || JSON.stringify(MongoErr)}`);
    return null;
  });

  if (!orderData) {
    logger.warn(`ORDER_NOT_EXIST%orderId:${orderId}`);
    return;
  }

  try {
    const { orderAsset, wallet, chainId, amount, user, priority, additional } =
      orderData;
    const { inProcessing } = additional;
    let {
      activityId,
      processType,
      oracleCalculation,
      nativePriceUsd,
      tokenPriceUsd,
      collateralPriceUsd,
      outputPriceUsd,
      tradeFee,
      tx,
    } = inProcessing;

    const userStatus = user?.status;
    const walletAddress = wallet.address;
    const wrappedNative = chainConfig[chainId]?.nativeToken;
    const collateralToken = orderAsset.collateralToken;
    const outputToken = orderAsset.outputToken;
    const orderToken = orderAsset.orderToken;

    // Validate required data
    if (
      !wrappedNative ||
      !wallet?.encryptedWalletKey ||
      !wallet.network ||
      !inProcessing
    ) {
      await updateOrder({
        orderId,
        updates: {
          status: "FAILED",
          message: "INVALID_ORDER",
          isBusy: false,
        },
      });
      return;
    }

    let { signature, fee, amountOut } = tx || {};

    if (!signature) {
      await updateOrder({
        orderId,
        updates: {
          status: "FAILED",
          message: "ORDER_NOT_EXECUTED",
          isBusy: false,
        },
      });
      return;
    }

    nativePriceUsd =
      !nativePriceUsd || BigInt(nativePriceUsd) <= 0n
        ? BigInt(
            COLLATERAL_TOKEN_DATA_MAP.get(
              `${chainId}:${wrappedNative.address.toLowerCase()}`,
            ),
          ) || "0"
        : BigInt(nativePriceUsd);

    tokenPriceUsd =
      !tokenPriceUsd || BigInt(tokenPriceUsd) <= 0n
        ? safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS) || 0n
        : BigInt(tokenPriceUsd);

    if (processType == "BUY") {
      collateralPriceUsd =
        !collateralPriceUsd || BigInt(collateralPriceUsd) <= 0n
          ? collateralToken.address == ZeroAddress ? nativePriceUsd : BigInt(
              COLLATERAL_TOKEN_DATA_MAP.get(
                `${chainId}:${collateralToken.address.toLowerCase()}`,
              ),
            ) || 0n
          : BigInt(collateralPriceUsd);
    }

    if (processType == "SELL") {
      outputPriceUsd =
        !outputPriceUsd || BigInt(outputPriceUsd) <= 0n
          ? outputToken.address == ZeroAddress ?  nativePriceUsd : BigInt(
              COLLATERAL_TOKEN_DATA_MAP.get(
                `${chainId}:${outputToken.address.toLowerCase()}`,
              ),
            )|| 0n
          : BigInt(outputPriceUsd);
    }

    // Get transaction info if missing
    let tradeTxFee = fee ? BigInt(fee) : 0n;
    let tradeTxAmountOut = amountOut ? BigInt(amountOut) : 0n;

    if (
      !tradeTxFee ||
      tradeTxFee === 0n ||
      !tradeTxAmountOut ||
      tradeTxAmountOut === 0n
    ) {
      try {
        const tokenOut =
          processType === "BUY" ? orderToken.address : outputToken.address;
        const txInfo = await getTxInfoFromSignature({
          signature,
          chainId,
          receiver: walletAddress,
          sender: walletAddress,
          tokenOut,
        });

        if (txInfo) {
          tradeTxFee = BigInt(txInfo.fee || "0");
          tradeTxAmountOut = BigInt(txInfo.totalReceived || "0");
          inProcessing.tx.fee = tradeTxFee.toString();
          inProcessing.tx.amountOut = tradeTxAmountOut.toString();
        }
      } catch (txInfoError) {
        logger.error(`TX_INFO_FETCH_FAILED%orderId:${orderId}%error:${txInfoError.message || JSON.stringify(txInfoError)}`);
        await updateOrder({
          orderId,
          updates: {
            message: "TX_PROCESSING_FAILED",
            isBusy: false,
          },
        });
        return;
      }
    }

    // Handle trade fee if required
    let txTradeFeeAmount = tradeFee?.amount ? BigInt(tradeFee.amount) : 0n;

    if (txTradeFeeAmount > 0n) {
      if (!tradeFee?.executed || !tradeFee?.signature) {
        const tradeFeeCollector =
          chains.Solana === chainId
            ? SOLANA_ORDER_TRADE_FEE_COLLECTOR
            : EVM_ORDER_TRADE_FEE_COLLECTOR;

        try {
          const tokenForFee =
            processType === "BUY" ? collateralToken : outputToken;
          const tokenPriceForFee =
            processType === "BUY" ? collateralPriceUsd : outputPriceUsd;

          const tradeFeeExecutionResult = await withdraw({
            walletData: orderData.wallet,
            chainId,
            receiver: tradeFeeCollector,
            value: txTradeFeeAmount,
            token: tokenForFee,
            user: orderData.user,
            option: {
              nativePriceUsd: nativePriceUsd || 0n,
              tokenPriceUsd: tokenPriceForFee || 0n,
              type: "TRADE_FEE",
              orderId,
            },
          });

          if (tradeFeeExecutionResult.execution == true && tradeFeeExecutionResult?.signature) {
            inProcessing.tradeFee = {
              ...inProcessing.tradeFee,
              ...tradeFeeExecutionResult,
              executed: true,
            };
          } else {
            throw new Error(tradeFeeExecutionResult.error || "Trade fee execution failed");
          }
        } catch (tradeFeeErr) {
          await updateOrder({
            orderId,
            updates: {
              status: "PROCESSING",
              message: "TRADE_FEE_EXECUTED_FAILED",
              isActive: true,
              isBusy: false,
              inProcessing: inProcessing,
            },
          });
          logger.error( `TRADE_FEE_EXECUTED_FAILED%orderId:${orderId}%error${tradeFeeErr.message || JSON.stringify(tradeFeeErr)}`);
          return;
        }
      }
    }

    if (
      !nativePriceUsd ||
      nativePriceUsd == 0n ||
      (processType == "BUY" &&
        !collateralPriceUsd &&
        collateralPriceUsd == 0n) ||
      (processType == "SELL" && !outputPriceUsd && outputPriceUsd == 0n) ||
      !tokenPriceUsd ||
      tokenPriceUsd == 0n
    ) {
      await updateOrder({
        orderId,
        updates: {
          status: "PROCESSING",
          message: "PRICE_NOT_FETCHED",
          isActive: true,
          isBusy: false,
          inProcessing: inProcessing,
        },
      });
      return;
    }
    console.log(tradeTxFee, nativePriceUsd);

    if (
      orderData.message == "PRICE_NOT_FETCHED" ||
      oracleCalculation == false
    ) {
      if (
        txTradeFeeAmount > 0n &&
        tradeFee.activityId &&
        inProcessing.tradeFee.feeInUsd != 0n &&
        inProcessing.tradeFee.valueInUsd != 0n
      ) {
        updateActivity({
          activityId: tradeFee.activityId,
          updates: {
            feeInUsd: inProcessing.tradeFee.feeInUsd.toString(),
            payInUsd: inProcessing.tradeFee.valueInUsd.toString(),
          },
        });
      }
      updateActivity({
        activityId,
        updates: {
          feeInUsd: convertToUsd(
            tradeTxFee,
            wrappedNative.decimals,
            nativePriceUsd,
          ),
          payInUsd:
            processType == "BUY"
              ? convertToUsd(
                  BigInt(amount.orderSize),
                  collateralToken.decimals,
                  collateralPriceUsd,
                )
              : convertToUsd(
                  BigInt(amount.tokenAmount),
                  orderToken.decimals,
                  tokenPriceUsd,
                ),
          receiveInUsd:
            processType == "BUY"
              ? convertToUsd(
                  tradeTxAmountOut,
                  orderToken.decimals,
                  tokenPriceUsd,
                )
              : convertToUsd(
                  tradeTxAmountOut,
                  outputToken.decimals,
                  outputPriceUsd,
                ),
        },
      });
    }

    const totalTxFee =
      tradeTxFee + BigInt(inProcessing.tradeFee.txFeeAmount || 0n);
    const feeInUsd =
      convertToUsd(totalTxFee, wrappedNative.decimals, nativePriceUsd) || 0n;
    if (processType === "BUY") {
      const totalPayAmount = BigInt(amount.orderSize) + txTradeFeeAmount;
      const payInUsd =
        convertToUsd(
          totalPayAmount,
          collateralToken.decimals,
          collateralPriceUsd,
        ) || 0n;

      if (orderData.exit?.isTechnicalExit === true) {
        await updateOrder({
          orderId: orderData._id,
          updates: {
            tokenAmount: tradeTxAmountOut.toString(),
            feeInUsd: feeInUsd.toString(),
            payInUsd: payInUsd.toString(),
            message: "ORDER_OPENED",
            status: "OPENED",
            type: "SELL",
            isBusy: false,
            isActive: true,
            inProcessing: null,
            retry: 0,
          },
        });
      } else {
        await convertOpenOrder({
          order: orderData,
          executionResult: {
            feeInUsd,
            payInUsd,
            totalReceived: tradeTxAmountOut,
            tokenPriceUsd,
          },
        });
      }
    }
    if (processType === "SELL") {
      const totalReceive = tradeTxAmountOut - txTradeFeeAmount;
      const receiveInUsd = convertToUsd(
        totalReceive,
        outputToken.decimals,
        outputPriceUsd,
      );
      const orderCostUsd =
        BigInt(orderData.executionFee.feeInUsd) +
        BigInt(orderData.executionFee.payInUsd);
      const realizePnl = receiveInUsd - (feeInUsd + orderCostUsd);
      //13. Update open order reEntrance if true
      await updateOrder({
        orderId,
        updates: {
          status: !orderData.reEntrance.isReEntrance ? "CLOSED" : "PENDING",
          type: !orderData.reEntrance.isReEntrance ? "STOPPED" : "BUY",
          message: !orderData.reEntrance.isReEntrance
            ? "ORDER_CLOSED"
            : "ORDER_RESTART",
          exitPrice: tokenPriceUsd.toString(),
          isActive: true,
          isBusy: false,
          realizedPnl: realizePnl.toString(),
          profitUsd: "0",
          saveUsd: "0",
          takeProfitPrice: "0",
          stopLossPrice: "0",
          retry: 0,
          inProcessing: null,
        },
      });
    }
  } catch (globalError) {
    console.log(globalError);
    // Catch-all for any unexpected errors
    logger.error(
      `PROCESS_SPOT_ORDER_UNEXPECTED_ERROR%orderId:${orderId}%error:${globalError.message || JSON.stringify(globalError)}`,
    );

    // Try to set order to PROCESSING for later retry
    if (orderData?._id) {
      try {
        await updateOrder({
          orderId,
          updates: {
            status: "PROCESSING",
            message: `UNEXPECTED_ERROR`,
            isBusy: false,
          },
        });
      } catch (updateError) {
        logger.error(
          `ORDER_UPDATE_AFTER_ERROR_FAILED%orderId:${orderId}%error:${updateError.message || JSON.stringify(updateError)}`,
        );
      }
    }
  }
};
