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
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  user,
}) => {
  try {
    let signer = getSigner(walletData.encryptedWalletKey, walletData.network);
    let txDetails = await transfer({
      receiver,
      tokenAddress,
      chainId,
      value,
      signer,
    });
    try {
      let wrappednative = chainConfig[chainId].nativeToken;
      let tokenPriceQuery = [
        { address: wrappednative.address, networkId: chainId },
      ];
      let isNative =
        tokenAddress.toLowerCase() == wrappednative.address.toLowerCase() ||
        tokenAddress == ZeroAddress;
      if (!isNative) {
        tokenPriceQuery.push({ address: tokenAddress, networkId: chainId });
      }
      let valueInUsd,
        feeInUsd = BigInt(0);
      try {
        let tokenPrices = await fetchCodexTokenPrices(tokenPriceQuery);
        let nativePriceUsd = safeParseUnits(
          tokenPrices[0].priceUsd,
          PRECISION_DECIMALS,
        );

        if (!isNative) {
          let tokenPriceUsd = safeParseUnits(
            tokenPrices[1].priceUsd,
            PRECISION_DECIMALS,
          );
          valueInUsd = convertToUsd(
            BigInt(value),
            tokenDecimals,
            tokenPriceUsd,
          );
        } else {
          valueInUsd = convertToUsd(
            BigInt(value),
            tokenDecimals,
            nativePriceUsd,
          );
        }
        feeInUsd = convertToUsd(
          txDetails.fee,
          wrappednative.decimals,
          nativePriceUsd,
        );
      } catch (err) {
        logger.error(
          `[API_FAILED]: fetchCodexTokenPrices=> ${JSON.stringify(err.message)}`,
        );
      }

      await addActivity({
        walletId: walletData._id,
        userId: user._id,
        status: "Success",
        type: "WITHDRAW",
        chainId,
        txHash: txDetails.signature,
        indexTokenAddress: tokenAddress,
        txFee: {
          feeAmount: txDetails.fee.toString(),
          feeInUsd: feeInUsd.toString() || "0",
        },
        payToken: {
          address: tokenAddress,
          symbol: tokenSymbol,
          decimal: tokenDecimals,
          amount: value,
          amountInUsd: valueInUsd.toString() || "0",
        },
        receiver,
      });
    } catch (err) {
      console.log(err);
      logger.error(`Withdraw activity isnt save tx:${txDetails.signature}`);
    }
  } catch (err) {
    console.log(err);
    throw new Error("Tx failed");
  }
};
