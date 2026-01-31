import {
  transferEVMNative,
  transferEVMTokens,
  getEvmBalance,
  getEVMTokenBalance,
} from "../evm/evmTransfer.js";
import {
  transferSolNative,
  transferSOLTokens,
  getSolanaNativeBalance,
  getSolanaTokenBalance,
} from "../svm/svmTransfer.js";
import { chains } from "../../constant/common/chain.js";
import { ZeroAddress } from "ethers";

export const transferNative = async ({ chainId, receiver, value, signer }) => {
  let details;
  if (chainId == chains.Solana) {
    details = await transferSolNative({ chainId, receiver, value, KeyPair:signer });
  } else {
    details = await transferEVMNative({ chainId, receiver, value, signer });
  }
  return details;
};

export const transferTokens = async ({
  chainId,
  tokenAddress,
  receiver,
  value,
  signer,
}) => {
  let details;
  if (chainId == chains.Solana) {
    details = await transferSOLTokens({
      chainId,
      tokenAddress,
      receiver,
      value,
      KeyPair: signer,
    });
  } else {
    details = await transferEVMTokens({
      chainId,
      tokenAddress,
      receiver,
      value,
      signer,
    });
  }
  return details;
};

export const transfer = async ({
  receiver,
  tokenAddress,
  value,
  chainId,
  signer,
}) => {
  let TxDetails;
  if (tokenAddress == ZeroAddress) {
    TxDetails = await transferNative({ chainId, receiver, value, signer });
  } else {
    TxDetails = await transferTokens({
      chainId,
      tokenAddress,
      receiver,
      value,
      signer,
    });
  }
  return TxDetails;
};

export const getNativeBalance = async ({ walletAddress, chainId }) => {
  let balance;
  if (chains.Solana == chainId) {
    balance = await getSolanaNativeBalance({ walletAddress, chainId });
  } else {
    balance = await getEvmBalance({ walletAddress, chainId });
  }
  return balance;
};

export const getTokenBalance = async ({
  walletAddress,
  tokenAddress,
  chainId,
}) => {
  let balance;
  if (chains.Solana == chainId) {
    balance = await getSolanaTokenBalance({
      walletAddress,
      tokenAddress,
      chainId,
    });
  } else {
    balance = await getEVMTokenBalance({
      walletAddress,
      tokenAddress,
      chainId,
    });
  }
  return balance;
};
