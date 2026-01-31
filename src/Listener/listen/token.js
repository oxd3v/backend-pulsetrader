import { fetchCodexTokenPrices } from "../../../Api/lib/oracle/codex.js";
import { CollateralTokens } from "../../../Api/constant/common/token.js";
import { safeParseUnits } from "../../../Api/lib/utility/number";
import { PRECISION_DECIMALS, TOKEN_LISTENING_INTERVAL } from "../../../Api/constant/common/order.js";

export const COLLATERAL_TOKEN_DATA_MAP = new Map();
const TOKEN_INTERVAL_ID = null;

export const updateTokenPrices = async ()=>{
  const tokenPriceQueries = Object.values(CollateralTokens).flatMap(chainTokens => 
  Object.values(chainTokens)
    .filter(token => !token.isNative) // Exclude native tokens like ETH/SOL/AVAX
    .map(token => ({
      address: token.address,
      networkId: token.chainId
    }))
 );
 let tokenPrices = await fetchCodexTokenPrices(tokenPriceQueries);
 tokenPrices.forEach(t=>{
    COLLATERAL_TOKEN_DATA_MAP.set(`${t.networkId}:${t.address.toLowerCase()}`, safeParseUnits(t.priceUsd, PRECISION_DECIMALS));
 })
}

export const startTokenListening = ()=>{
  if(TOKEN_INTERVAL_ID){
    clearInterval(TOKEN_INTERVAL_ID)
  }
  TOKEN_INTERVAL_ID = setInterval(updateTokenPrices, TOKEN_LISTENING_INTERVAL);
}

export const stopTokenListening = ()=>{
  if(TOKEN_INTERVAL_ID){
    clearInterval(TOKEN_INTERVAL_ID)
  }
}

 
