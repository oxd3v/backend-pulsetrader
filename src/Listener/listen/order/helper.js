import OrderModel from "../../../Api/model/order.js";
import { fetchMultiTimeFrameCandleData, fetchCodexFilterTokens} from "../../../Api/lib/oracle/codex.js";
import { technicalAnalysisOrder } from "../../../Api/lib/analysis/technicalAnalysis.js";
import { safeParseUnits } from "../../../Api/lib/utility/number.js";
import { PRECISION_DECIMALS } from '../../../Api/constant/common/order.js';
import { updateOrder, openSpotOrder, closeOpenOrder} from '../lib/order/spot/orderManager.js'
import logger from "../../logger.js";


export const getTokensToListen = async () => {
  try {
    const activeOrderGroups = await OrderModel.aggregate([
      {
        $match: {
          isActive: true,
          isBusy: false,
          orderStatus: { $in: ["PENDING", "OPENED"] },
        },
      },
      {
        $group: {
          _id: {
            tokenAddress: "$orderAsset.orderToken.address",
            chainId: "$chainId",
          },
          orders: { $push: "$$ROOT" },
        },
      },
    ]).allowDiskUse(true);

    if (activeOrderGroups.length === 0) return { marketData: [], ordersByToken: new Map() };

    const tokenQueries = activeOrderGroups.map(g => `${g._id.tokenAddress}:${g._id.chainId}`);
    const ordersByToken = new Map();
    activeOrderGroups.forEach(g => ordersByToken.set(`${g._id.tokenAddress}:${g._id.chainId}`, g.orders));

    const marketData = await fetchCodexFilterTokens({
      variables: {
        filters: { change24: {} },
        tokens: tokenQueries,
        limit: tokenQueries.length,
        rankings: [{ attribute: "volume24", direction: "DESC" }]
      }
    });

    return { marketData: marketData || [], ordersByToken };
  } catch (err) {
    logger.error("[TOKEN_LISTENING_FAILED]", err);
    return { marketData: [], ordersByToken: new Map() };
  }
};

export const analyzeAndExecute = async ({order, tokenData})=>{
    let isBuyOrder = order.orderType == 'BUY' && order.orderStatus == 'PENDING';
    let isSellOrder = order.orderType == 'SELL' && (order.orderStatus == 'OPENED' || order.orderStatus == 'PENDING');
    if(isBuyOrder == true){
        let shoulBuy = false;
        let reason = 'Invalid order condition';
        if(order.entry.isTechnicalEntry == true && order.entry.technicalLogic){
            let candleData = await fetchMultiTimeFrameCandleData({pairAddress: tokenData.pair.address, chainId: tokenData.token.networkId, quoteToken: tokenData.quoteToken, resolutions: ['1','60'], createdAt: tokenData.createdAt, limit: 500})
            shoulBuy = technicalAnalysisOrder({technicalLogics: order.entry.technicalLogic, tokenData, candleData});
            reason = 'Condition not meet';
        }

        if(order.entry.isTechnicalEntry == false && order.entry.priceLogic.id == 'Price' && BigInt(order.entry.priceLogic.threshold) > 0n){
           let priceUsd = safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS);
           shoulBuy = priceUsd < BigInt(order.entry.priceLogic.threshold);
           reason = 'Condition not meet';
        }

        if(shoulBuy == true){
            reason = 'Condition meet';
            await openSpotOrder(order);
            return
        }else{
           await updateOrder({orderId: order._id, updates: {
              message: reason,
              isBusy: false,
              isActive: reason == 'Invalid order condition' ? false : true
           }})
           return
        }

    }

    if(isSellOrder == true){
        let shoulSell = false;
        let reason = 'Invalid order condition';
        if(order.exit.isTechnicalExit == true && order.exit.technicalLogic){
            let candleData = await fetchMultiTimeFrameCandleData({pairAddress: tokenData.pair.address, chainId: tokenData.token.networkId, quoteToken: tokenData.quoteToken, resolutions: ['1','60'], createdAt: tokenData.createdAt, limit: 500})
            shoulSell = technicalAnalysisOrder({technicalLogics: order.exit.technicalLogic, tokenData, candleData});
            reason = 'Condition not meet'
        }

        if(order.exit.isTechnicalExit == false &&  BigInt(order.exit.takeProfit.takeProfitPrice) > 0n){
           let priceUsd = safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS);
           shoulSell = priceUsd > BigInt(order.exit.takeProfit.takeProfitPrice);
           reason = 'Condition not meet';
        }

        if(order.exit.isTechnicalExit == false && order.exit.stopLoss.isActive == true &&  BigInt(order.exit.stopLoss.stopLossPrice) > 0n){
           let priceUsd = safeParseUnits(tokenData.priceUSD, PRECISION_DECIMALS);
           shoulSell = priceUsd < BigInt(order.exit.stopLoss.stopLossPrice);
           reason = 'Condition not meet';
        }

        if(shoulSell == true){
            reason = 'Condition meet';
            await closeOpenOrder(order);
            return
        }else{
           await updateOrder({orderId: order._id, updates: {
              message: reason,
              isBusy: false,
              isActive: reason == 'Invalid order condition' ? false : true
           }})
           return
        }

    }
}
