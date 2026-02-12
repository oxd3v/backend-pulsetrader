import { chainConfig } from "../../constant/common/chain.js";
export const getSwapRoute = async ({
  aggregator,
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps,
  userAddress,
  chainId,
}) => {
  let chainName = chainConfig[chainId].name.toLowerCase();
  let url = `https://router.lfj.gg/v2/aggregator/routes/${chainName}/${aggregator}/swap?amountIn=${amountIn}&feeBps=0&slippageBps=${slippageBps}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&userAddress=${userAddress}`;
  let res = await fetch(url);
  let data = await res.json();
   // Ensure strict validation of return data
  if (!data || !data.amountOut) {
    throw new Error("Invalid response from aggregator");
  }

  let txData = {
    to: data.to,
    from: data.from,
    data: data.data,
    value: data.value,
  };

  return {
    success: true,
    amountOut: BigInt(data.amountOut),
    txData
  };
};

export const getSolanaSwapInstructionRoute = async ({
  aggregator,
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps,
  userAddress,
}) => {
  const url = `https://router.lfj.gg/v2/aggregator/routes/solana/${aggregator}/swap-instruction?amountIn=${amountIn}&slippageBps=${slippageBps}&feeBps=0&tokenIn=${tokenIn}&tokenOut=${tokenOut}&userAddress=${userAddress}`;
  const res = await fetch(url);
  const data = await res.json();

  // Ensure strict validation of return data
  if (!data || !data.amountOut) {
    throw new Error("Invalid response from aggregator");
  }

  return {
    success: true,
    amountOut: BigInt(data.amountOut),
    addressLookupTable: data.addressLookupTable || [],
    instructions: data.instructions || [],
  };
};