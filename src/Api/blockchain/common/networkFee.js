import {
  chains,
  chainConfig,
  getConnectionProvider,
} from "../../constant/common/chain.js";
import { BASIS_POINT_DIVISOR_BIGINT, SOLANA_BASE_FEE, DEFAULT_SOLANA_PRIORITY_FEE, DEFAULT_GAS_PRICE, GAS_LIMIT, GAS_BUFFER } from "../../constant/common/order.js";

export async function getSolanaPriorityFeeEstimate(accounts = []) {
  let priorityFee;
  try {
    const response = await fetch(chainConfig[chains.Solana].rpcUrls[0], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getRecentPrioritizationFees",
        params: accounts.length ? [accounts] : [],
      }),
    });

    const { result: fees } = await response.json();
    if (!fees?.length) return DEFAULT_SOLANA_PRIORITY_FEE;

    fees.sort((a, b) => a.prioritizationFee - b.prioritizationFee);

    priorityFee = BigInt(
      fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.9))]
        .prioritizationFee || DEFAULT_SOLANA_PRIORITY_FEE
    );
  } catch (err) {
    priorityFee = DEFAULT_SOLANA_PRIORITY_FEE;
  }
  if(priorityFee == BigInt(0)){
    priorityFee = DEFAULT_SOLANA_PRIORITY_FEE;
  }
  return priorityFee
  
}

export async function getEVMSpotGasFee(chainId) {
  let gasPrice;
  try {
    let provider = getConnectionProvider(chainId);
    let gasObject = await provider.getFeeData();
    gasPrice =  gasObject.gasPrice;
  } catch (err) {
    gasPrice = DEFAULT_GAS_PRICE[chainId];
  }

  return gasPrice;
}

export const getGasFee = async (chainId)=>{
  let gasFee = chainId == chains.Solana ? await getSolanaPriorityFeeEstimate([]) : await getEVMSpotGasFee(chainId);
  return gasFee;
}


export const spotNetworkFee = async (chainId)=>{
  let networkFee = BigInt(0);
  let gasLimit = GAS_LIMIT['SPOT'][chainId]
  if(chainId == chains.Solana){
    let priorityFee = await getSolanaPriorityFeeEstimate([]) || DEFAULT_SOLANA_PRIORITY_FEE;
    const expFee = SOLANA_BASE_FEE + ((gasLimit * priorityFee) / BigInt(1_000_000));
    networkFee = expFee;
  }else{
    let gasFee = await getEVMSpotGasFee(chainId);
    let fee = gasFee * gasLimit;
    networkFee = fee;
  }
   networkFee = (networkFee * BigInt(GAS_BUFFER[chainId]))/ BASIS_POINT_DIVISOR_BIGINT;
  return networkFee;
}

