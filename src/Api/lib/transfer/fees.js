import { EVM_ORDER_TRADE_FEE_COLLECTOR, SOLANA_ORDER_TRADE_FEE_COLLECTOR} from "../../constant/common/order.js";
import { transfer } from '../../blockchain/common/transfer.js';
import { chains } from "../../constant/common/chain.js";

 

export const getTradeFee = async ({order, chainId, amount, token, signer, prices})=>{
  let result = {
    success: false,
    isApplicable: false,
    signature: null,
  }
  let tokenAddress = token.address;
  let userStatus = order.user.status;
  if(userStatus == 'admin'){
    return result;
  }
  let receiver = chains.Solana == chainId ? SOLANA_ORDER_TRADE_FEE_COLLECTOR : EVM_ORDER_TRADE_FEE_COLLECTOR;
  let txDetails = await transfer({receiver, tokenAddress, value:amount, chainId, signer});
  result = {
    success: true,
    isApplicable: true,
    signature: txDetails.signature,
    fee: txDetails.fee
  }
  return result;
}