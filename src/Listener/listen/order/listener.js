import {
  evaluateBuyConditions,
  evaluateSellConditions,
  getTokensToListen,
} from "./helper.js";
import logger from '../../logger.js'
import {
  openSpotOrder,
  closeOpenOrder,
  processOrder,
} from "../../../Api/lib/orderHandler/execute.js";
import { fetchMultiTimeFrameCandleData } from "../../../Api/lib/oracle/codex.js";
import { COLLATERAL_TOKEN_DATA_MAP } from "../token.js"


let LISTENING_INTERVAL_ID = null;
let LISTENING_INTERVAL = 30000;
let IS_LISTENING = false;



const executeOrderIfReady = async (order, tokenData, option) => {
  if (order.orderStatus === "PROCESSING") {
    await processOrder({ orderId: order._id, tokenData });
    return;
  }

  if (order.orderType === "BUY" && order.orderStatus === "PENDING") {
    const { shouldBuy } = await evaluateBuyConditions(order, tokenData, option);
    if (shouldBuy) {
      await openSpotOrder({ orderId: order._id, tokenData });
    }
    return;
  }

  if (
    order.orderType === "SELL" &&
    (order.orderStatus === "PENDING" || order.orderStatus === "OPENED")
  ) {
    const { shouldSell } = await evaluateSellConditions(
      order,
      tokenData,
      option,
    );
    if (shouldSell) {
      await closeOpenOrder({ orderId: order._id, tokenData });
    }
  }
};

const listener = async () => {
  if (IS_LISTENING) {
    return;
  }
  IS_LISTENING = true;
  try {
    if (COLLATERAL_TOKEN_DATA_MAP.size === 0) {
      logger.error('COLLATERAL_PRICE_NOT_FETCHED_ON_LISTENING');
    }

    const { ordersByToken } = await getTokensToListen();
    if (ordersByToken.size === 0) {
      return;
    }
    

    for (const { tokenData, orders } of ordersByToken.values()) {
      if (!tokenData || !orders || orders.length === 0) {
        continue;
      }
      let TechnicalOrders = [];
      let GeneralOrders = [];
      let OrderExecutionPromises = [];
      orders.forEach((o) => {
        if (
          o.entry.isTechnicalEntry == true ||
          o.exit.isTechnicalExit == true
        ) {
          TechnicalOrders.push(o);
        } else {
          GeneralOrders.push(o);
        }
      });
      
      if (TechnicalOrders.length > 0) {
        const candleData = await fetchMultiTimeFrameCandleData({
          pairAddress: tokenData.pair.address,
          chainId: tokenData.token.networkId,
          quoteToken: tokenData.quoteToken,
          resolutions: ["1", "60"],
          createdAt: tokenData.createdAt,
          limit: 500,
        });

        if (candleData["1"] && candleData["60"]) {
          let executionPromise = TechnicalOrders.map((o) => {
            return executeOrderIfReady(o, tokenData, { candleData });
          });
          OrderExecutionPromises.push(...executionPromise);
        }
      }

      if (GeneralOrders.length > 0) {
        let executionPromise = GeneralOrders.map((o) => {
          return executeOrderIfReady(o, tokenData);
        });
        OrderExecutionPromises.push(...executionPromise);
      }

      

      await Promise.allSettled(OrderExecutionPromises);
    }
  } finally {
    IS_LISTENING = false;
  }
};

export const startOrderListening = async () => {
  if (LISTENING_INTERVAL_ID) {
    clearInterval(LISTENING_INTERVAL_ID);
  }
  await listener();
  LISTENING_INTERVAL_ID = setInterval(listener, LISTENING_INTERVAL);
};

export const stopOrderListening = async () => {
  if (LISTENING_INTERVAL_ID) {
    clearInterval(LISTENING_INTERVAL_ID);
    LISTENING_INTERVAL_ID = null;
  }
};
