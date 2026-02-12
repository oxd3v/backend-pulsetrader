import OrderModel from "../../../Api/model/order.js";
import {
  fetchCodexFilterTokens,
  fetchCodexTokenPrices,
} from "../../../Api/lib/oracle/codex.js";
import { CollateralTokens } from "../../../Api/constant/common/token.js";
import { technicalAnalysisOrder } from "../../../Api/lib/analysis/technicalAnalysis.js";
import { safeParseUnits } from "../../../Api/lib/utility/number.js";
import { PRECISION_DECIMALS } from "../../../Api/constant/common/order.js";
import logger from "../../logger.js";

export const getTokensToListen = async () => {
  try {
    // Use more specific indexes for better performance
    let activeOrderGroups = [];
    try {
      activeOrderGroups = await OrderModel.aggregate([
        {
          $match: {
            isActive: true,
            isBusy: false,
            orderStatus: { $in: ["PENDING", "OPENED", "PROCESSING"] },
            "orderAsset.orderToken.address": { $exists: true, $ne: null },
            chainId: { $exists: true, $ne: null },
          },
        },
        {
          $project: {
            tokenAddress: "$orderAsset.orderToken.address",
            chainId: 1,
            orderType: 1,
            orderStatus: 1,
            entry: 1,
            exit: 1,
            _id: 1,
            createdAt: 1,
          },
        },
        {
          $group: {
            _id: {
              tokenAddress: "$tokenAddress",
              chainId: "$chainId",
            },
            orders: {
              $push: {
                _id: "$_id",
                orderType: "$orderType",
                orderStatus: "$orderStatus",
                entry: "$entry",
                exit: "$exit",
                createdAt: "$createdAt",
              },
            },
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 },
        },
      ]);
    } catch (err) {
      logger.error({
        id: "MONGODB_ERROR_ON_TOKEN_LISTENING",
        error: err.message,
      });
    }

    if (activeOrderGroups.length === 0) {
      return { listening: false, ordersByToken: new Map() };
    }

    // Batch token queries for efficiency
    const tokenQueries = activeOrderGroups.map(
      (g) => `${g._id.tokenAddress}:${g._id.chainId}`,
    );

    let marketData = [];
    try {
      marketData = await fetchCodexFilterTokens({
        variables: {
          filters: { change24: {} },
          tokens: tokenQueries,
          limit: tokenQueries.length,
          rankings: [{ attribute: "volume24", direction: "DESC" }],
        },
      });
    } catch (err) {
      logger.error({
        id: "ORACLE_DATA_FAILED_ON_LISTENING",
        error: err.message,
      });
    }

    if (marketData.length === 0) {
      return { listening: false, ordersByToken: new Map() };
    }

    // Create lookup map for market data
    const marketDataMap = new Map();
    marketData.forEach((token) => {
      const key = token.token.id.toLowerCase();
      marketDataMap.set(key, token);
    });

    // Group orders by token
    const ordersByToken = new Map();
    activeOrderGroups.forEach((group) => {
      const tokenId = `${group._id.tokenAddress}:${group._id.chainId}`;
      const tokenKey = tokenId.toLowerCase();

      // Get token data from market data or create minimal object
      let tokenData = marketDataMap.get(tokenKey);
      if (!tokenData) {
        logger.error({
          id: "LISTENING:TOKEN_DATA_NOT_FOUND",
          error: `${tokenKey} data not found on listening`,
        });
      }
      if (tokenData) {
        ordersByToken.set(tokenKey, {
          orders: group.orders,
          tokenData,
        });
      }
    });

    return {
      listening: ordersByToken.size > 0,
      ordersByToken,
    };
  } catch (err) {
    logger.error({
      id: "TOKEN_LISTENING_FAILED",
      error: err.message,
      stack: err.stack,
    });
    return { listening: false, ordersByToken: new Map() };
  }
};

export const getDefaultTokenPrices = async () => {
  let tokenPrices;
  try {
    const tokenPriceQueries = Object.values(CollateralTokens).flatMap(
      (chainTokens) =>
        Object.values(chainTokens)
          .filter((token) => !token.isNative)
          .map((token) => ({
            address: token.address,
            networkId: token.chainId,
          })),
    );
    tokenPrices = await fetchCodexTokenPrices(tokenPriceQueries);
    return { tokenPrices };
  } catch (err) {
    // logger.warn({
    //   id: "DEFAULT_TOKEN_PRICE_FAILED",
    //   error: err.message,
    //   stack: err.stack,
    // });
    return { tokenPrices: null };
  }
};

export const evaluateBuyConditions = async (order, tokenData, option) => {
  let shouldBuy = false;
  let reason = "NO_CONDITION_MET";
  let conditionType = "none";

  // Technical entry condition
  if (order.entry.isTechnicalEntry == true && order.entry.technicalLogic) {
    conditionType = "technical";
    try {
      const candleData = option?.candleData;
      if (!candleData) {
        return {
          shouldBuy: false,
          reason: "CANDLE_DATA_MISSING",
          conditionType,
        };
      }
      shouldBuy = technicalAnalysisOrder({
        technicalLogics: order.entry.technicalLogic,
        tokenData,
        candleData,
      });

      reason = shouldBuy
        ? "TECHNICAL_CONDITION_MET"
        : "TECHNICAL_CONDITION_NOT_MET";
    } catch (err) {
      // logger.error("[TECHNICAL_ANALYSIS_FAILED]", {
      //   orderId: order._id,
      //   error: err.message,
      // });
      reason = "TECHNICAL_ANALYSIS_ERROR";
    }
  }

  // Price-based entry condition
  else if (
    !order.entry.isTechnicalEntry &&
    order.entry.priceLogic?.id === "price" &&
    BigInt(order.entry.priceLogic.threshold || 0) > 0n
  ) {
    conditionType = "price";
    try {
      const priceUsd = safeParseUnits(
        tokenData.priceUSD || "0",
        PRECISION_DECIMALS,
      );
      const threshold = BigInt(order.entry.priceLogic.threshold);
      shouldBuy = priceUsd < threshold;
      reason = shouldBuy ? "PRICE_CONDITION_MET" : "PRICE_CONDITION_NOT_MET";
    } catch (err) {
      // logger.error("[PRICE_CONDITION_EVALUATION_FAILED]", {
      //   orderId: order._id,
      //   error: err.message,
      // });
      reason = "PRICE_EVALUATION_ERROR";
    }
  }

  return { shouldBuy, reason, conditionType };
};

export const evaluateSellConditions = async (order, tokenData, option) => {
  let shouldSell = false;
  let reason = "NO_CONDITION_MET";
  let conditionType = "none";

  // Technical exit condition
  if (order.exit.isTechnicalExit && order.exit.technicalLogic) {
    conditionType = "technical";
    try {
      const candleData = option?.candleData;
      if (!candleData) {
        return {
          shouldSell: false,
          reason: "CANDLE_DATA_MISSING",
          conditionType,
        };
      }
      shouldSell = technicalAnalysisOrder({
        technicalLogics: order.exit.technicalLogic,
        tokenData,
        candleData,
      });
      reason = shouldSell
        ? "TECHNICAL_CONDITION_MET"
        : "TECHNICAL_CONDITION_NOT_MET";
    } catch (err) {
      // logger.error("[TECHNICAL_EXIT_ANALYSIS_FAILED]", {
      //   orderId: order._id,
      //   error: err.message,
      // });
      reason = "TECHNICAL_ANALYSIS_ERROR";
    }
  } else if (
    !order.exit.isTechnicalExit &&
    BigInt(order.exit.takeProfit?.takeProfitPrice || 0) > 0n
  ) {
    conditionType = "take_profit";
    try {
      const priceUsd = safeParseUnits(
        tokenData.priceUSD || "0",
        PRECISION_DECIMALS,
      );
      const takeProfitPrice = BigInt(order.exit.takeProfit.takeProfitPrice);
      shouldSell = priceUsd > takeProfitPrice;
      reason = shouldSell ? "TAKE_PROFIT_CONDITION_MET" : "TAKE_PROFIT_NOT_MET";
    } catch (err) {
      // logger.error("[TAKE_PROFIT_EVALUATION_FAILED]", {
      //   orderId: order._id,
      //   error: err.message,
      // });
      reason = "TAKE_PROFIT_EVALUATION_ERROR";
    }
  }

  // Stop loss condition (only if take profit not triggered)
  if (
    !shouldSell &&
    !order.exit.isTechnicalExit &&
    order.exit.stopLoss?.isActive === true &&
    BigInt(order.exit.stopLoss?.stopLossPrice || 0) > 0n
  ) {
    conditionType = "stop_loss";
    try {
      const priceUsd = safeParseUnits(
        tokenData.priceUSD || "0",
        PRECISION_DECIMALS,
      );
      const stopLossPrice = BigInt(order.exit.stopLoss.stopLossPrice);
      shouldSell = priceUsd < stopLossPrice;
      reason = shouldSell ? "STOP_LOSS_CONDITION_MET" : "STOP_LOSS_NOT_MET";
    } catch (err) {
      // logger.error("[STOP_LOSS_EVALUATION_FAILED]", {
      //   orderId: order._id,
      //   error: err.message,
      // });
      reason = "STOP_LOSS_EVALUATION_ERROR";
    }
  }

  return { shouldSell, reason, conditionType };
};


