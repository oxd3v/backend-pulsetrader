import { fetchCodexTokenPrices, fetchCodexFilterTokens, fetchCodexTokenPrice, fetchMultiTimeFrameCandleData } from "../Api/lib/oracle/codex.js";
import { chainConfig } from "../Api/constant/common/chain.js";

// const fetch = async (chainId, tokenAddress)=>{
// let txDetails = {
//   signature: '0xd948d738e68ac89ba671a1f7cc34a52e84cb1997536ef4deed73d8621e43a993',
//   fee: 152851272000n
// }
//   let wrappednative = chainConfig[chainId].nativeToken;
//   console.log(wrappednative);
//   let res = await fetchCodexFilterTokens({variables: {
//     limit: 50,
//     offset:0,
//     filters: {change24: {}},
//     rankings: [{"attribute":"trendingScore24","direction":"DESC"}]
//   }})
//   let res2 = await fetchCodexTokenPrices([{address: wrappednative.address, networkId: chainId}, {address: tokenAddress, networkId: chainId}])
//   console.log(res, res2)
// }

// const fetch = async (pairAddress, quoteToken, chainId) =>{
//   let result = await fetchMultiTimeFrameCandleData({pairAddress, chainId, quoteToken});
//   console.log(result)
// }

const fetchLocalHost = async ()=>{
  let res = await fetch('http://localhost:6795');
  console.log(res)
}


fetchLocalHost()
//fetch('ASCSDmpkbXDNRiPRKGAPiLU4Kukc6P8vgNBtNhGw3Hnf', 'token0', 1399811149);

