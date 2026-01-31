import { getTokensToListen, analyzeAndExecute } from "./helper.js";
import logger from "../../logger.js";
import pLimit from "p-limit";

const CONCURRENCY_LIMIT = 500;
const LOOP_INTERVAL_MS = 2000;
let LISTENING = true;

export const startOrderListening = () => {
  LISTENING = true;
};

export const stopOrderListening = () => {
  LISTENING = false;
};

export const listenOrder = async () => {
  while (LISTENING) {
    const startTime = Date.now();
    try {
      await processTick();
    } catch (err) {
      logger.error("[ORDER_LISTENING_ERROR]:", err);
    }
    const elapsed = Date.now() - startTime;
    await new Promise((r) =>
      setTimeout(r, Math.max(100, LOOP_INTERVAL_MS - elapsed)),
    );
  }
};

const processTick = async () => {
  const { marketData, ordersByToken } = await getTokensToListen();
  if (!marketData.length) return;

  const limit = pLimit(CONCURRENCY_LIMIT);
  const executionPromises = [];

  for (const tokenData of marketData) {
    const key = `${tokenData.token.address}:${tokenData.token.networkId}`;
    const orders = ordersByToken.get(key) || [];

    for (const order of orders) {
      executionPromises.push(limit(() => analyzeAndExecute(order, tokenData)));
    }
  }

  await Promise.allSettled(executionPromises);
};
