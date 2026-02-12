import { fetchCodexTokenPrices } from "../oracle/codex.js";
import { transfer } from "../../blockchain/common/transfer.js";
import { getSigner } from "../walletHandler/generate.js";
import { addActivity } from "../activity/activityLog.js";
import { chains, chainConfig } from "../../constant/common/chain.js";
import { convertToUsd, safeParseUnits } from "../utility/number.js";
import { PRECISION_DECIMALS } from "../../constant/common/order.js";
import logger from "../../logger.js";
import { ZeroAddress } from "ethers";

export const withdraw = async ({
  walletData,
  chainId,
  receiver,
  value,
  token,
  user,
  option,
}) => {
  let withdrawDetails = {
    execution: false,
    activityId: null,
    amount: value.toString(),
    txFeeAmount: "0",
    feeInUsd: "0",
    valueInUsd: "0",
    signature: null,
    error: null,
  };
  try {
    let signer = getSigner(walletData.encryptedWalletKey, walletData.network);
    let txDetails = await transfer({
      receiver,
      tokenAddress: token.address,
      chainId,
      value,
      signer,
    });
    withdrawDetails.execution = true;
    withdrawDetails.signature = txDetails.signature;
    withdrawDetails.txFeeAmount = txDetails.fee.toString();
  } catch (txError) {
    withdrawDetails.execution = false;
    withdrawDetails.error = txError.message || "Transfer tx failed";
    return withdrawDetails;
  }
  let feeInUsd,
    valueInUsd = 0n;
  try {
    let wrappednative = chainConfig[chainId].nativeToken;
    let isNative =
      tokenAddress.toLowerCase() == wrappednative.address.toLowerCase() ||
      tokenAddress == ZeroAddress;
    let { nativePriceUsd, tokenPriceUsd } = option;
    if (!nativePriceUsd || nativePriceUsd == 0n ||  !tokenPriceUsd || tokenPriceUsd == 0n) {
      try {
        let tokenPriceQuery = [
          { address: wrappednative.address, networkId: chainId },
        ];

        if (!isNative) {
          tokenPriceQuery.push({ address: tokenAddress, networkId: chainId });
        }
        let tokenPrices = await fetchCodexTokenPrices(tokenPriceQuery);
        nativePriceUsd = safeParseUnits(
          tokenPrices[0].priceUsd,
          PRECISION_DECIMALS,
        );

        if (!isNative) {
          tokenPriceUsd = safeParseUnits(
            tokenPrices[1].priceUsd,
            PRECISION_DECIMALS,
          );
        } else {
          tokenPriceUsd = nativePriceUsd;
        }
      } catch (PRICE_ERR) {
        logger.error(`ACTIVITY_PRICE_FETCHING_FAILED%userid:${user._id}%error:${PRICE_ERR.message || JSON.stringify(PRICE_ERR)}`);
      }
    }

    feeInUsd =
      convertToUsd(
        BigInt(withdrawDetails.txFeeAmount),
        wrappednative.decimals,
        nativePriceUsd,
      ) || 0n;
    valueInUsd =
      convertToUsd(BigInt(value), token.decimals, tokenPriceUsd) || 0n;
  } catch (USD_CAL_ERR) {
    logger.error(`ACTIVITY_USD_CALCULATION_ERROR%userid:${user._id}%error:${USD_CAL_ERR.message || JSON.stringify(USD_CAL_ERR)}`);
  }
  withdrawDetails.feeInUsd = feeInUsd.toString();
  withdrawDetails.valueInUsd = valueInUsd.toString();
  withdrawDetails.activityId = await addActivity({
    walletId: walletData._id,
    userId: user._id,
    ...(option.orderId && { orderId: option.orderId }),
    status: "Success",
    type: option.type ? option.type : "TRANSFER",
    chainId,
    txHash: txDetails.signature,
    indexTokenAddress: tokenAddress,
    txFee: {
      feeAmount: withdrawDetails.txFeeAmount.toString(),
      feeInUsd: feeInUsd.toString() || "0",
    },
    payToken: {
      ...token,
      amount: value,
      amountInUsd: valueInUsd.toString() || "0",
    },
    receiver,
  });
  return withdrawDetails;
};
