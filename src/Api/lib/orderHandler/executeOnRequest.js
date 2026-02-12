import { closeOpenOrder, openSpotOrder, processOrder  } from "./execute.js";
import { fetchCodexFilterTokens } from "../oracle/codex.js";

 export const openSpotOrderOnRequest = async (orderData)=>{
    let tokenKey = `${orderData.orderAsset.orderToken.address}:${orderData.chainId}`
    let filterTkens = await fetchCodexFilterTokens({variables:{
        filters: {change24: {}},
        tokens: [tokenKey],
        limit:1, 
        offset:0, 
        rankings: [{ attribute: "volume24", direction: "DESC" }]
    }});
   await openSpotOrder({orderId: orderData._id, tokenData: filterTkens[0]})
 }

 export const closeOpenOrderOnRequest = async (orderData)=>{
    let tokenKey = `${orderData.orderAsset.orderToken.address}:${orderData.chainId}`
    let filterTkens = await fetchCodexFilterTokens({variables:{
        filters: {change24: {}},
        tokens: [tokenKey],
        limit:1, 
        offset:0, 
        rankings: [{ attribute: "volume24", direction: "DESC" }]
    }});
   await closeOpenOrder({orderId: orderData._id, tokenData: filterTkens[0]})
 }