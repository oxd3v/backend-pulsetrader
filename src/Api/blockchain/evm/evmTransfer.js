import { getConnectionProvider } from "../../constant/common/chain.js";
import { Interface, Contract, ethers, ZeroAddress, toBeHex } from "ethers";
import { updateNonce } from "../../lib/walletHandler/nonceSigner.js";
import {
  handleEthersJsError,
  simpleRetryFn,
} from "../../lib/errorHandler/handleError.js";
import logger from "../../logger.js";

// Constant for maximum approval
const APPROVE_INFINITY_AMOUNT = ethers.MaxUint256.toString();

// Standard ERC20 ABI for consistency
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

export const sendEVMTransaction = async ({ signer, txData }) => {
  try {
    const tx = await signer.sendTransaction(txData);
    return await tx.wait();
  } catch (err) {
    // Check for nonce issues and attempt a single re-sync
    if (err.code === "NONCE_EXPIRED" || err.message?.includes("nonce")) {
      const newSigner = updateNonce(signer);
      if(!newSigner){
        throw err;
      }
      const tx = await newSigner.sendTransaction(txData);
      return await tx.wait();
    }
    // Throw error instead of returning it to prevent downstream .hash crashes
    throw err;
  }
};

export const sendEvmTxWithRetry = async ({ signer, txData, retry = 2 }) => {
  let attempts = 0;
  while (attempts <= retry) {
    try {
      return await sendEVMTransaction({ signer, txData });
    } catch (err) {
      const { message, shouldContinue } = handleEthersJsError(err);

      // Fixed: Changed assignment (=) to comparison (===)
      if (shouldContinue === true && attempts < retry) {
        attempts++;
        // Small delay before retry
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(message || err.message);
    }
  }
};

export const evmNativeTransfer = async ({
  chainId,
  receiver,
  value,
  signer,
}) => {
  const provider = getConnectionProvider(chainId);
  const connectSigner = signer.connect(provider);
  const receipt = await sendEvmTxWithRetry({
    signer: connectSigner,
    txData: { to: receiver, value },
  });
  return {
    signature: receipt.hash,
    fee: BigInt(receipt.gasUsed * (receipt.gasPrice || 0n)),
  };
};

export const evmTokenTransfer = async ({
  chainId,
  tokenAddress,
  receiver,
  value,
  signer,
}) => {
  const provider = getConnectionProvider(chainId);
  const erc20Interface = new Interface(ERC20_ABI);
  const data = erc20Interface.encodeFunctionData("transfer", [receiver, value]);

  const connectSigner = signer.connect(provider);
  const receipt = await sendEvmTxWithRetry({
    signer: connectSigner,
    txData: { to: tokenAddress, data, value: "0" },
  });
  return {
    signature: receipt.hash,
    fee: BigInt(receipt.gasUsed * ( receipt.gasPrice || 0n)),
  };
};

export const approveInfinityAllowance = async ({
  tokenAddress,
  owner,
  spender,
  amount,
  signer,
}) => {
  const executionResult = {
    allowance: false,
    approve: null,
    label: "TOKEN_ALLOWANCE",
    error: null,
  };
  try {
    const contract = new Contract(tokenAddress, ERC20_ABI, signer);
    if (!contract) {
      executionResult.error = 'CONTRACT_NOT_FOUND';
      return executionResult;
    }
    // Single fetch for balance and allowance
    const [balance, allowance] = await simpleRetryFn({
      fn: () =>
        Promise.all([
          contract.balanceOf(owner),
          contract.allowance(owner, spender),
        ]),
      retry: 3,
    }).catch(err=>{
      executionResult.error = 'BALANSE_CHECK_FAILED';
      return executionResult;
    });

    const amountBI = BigInt(amount);

    if (BigInt(balance) < amountBI) {
      executionResult.error = 'INSUFFICIENT_FUND';
      return executionResult;
    }

    if (BigInt(allowance) < amountBI) {
      const erc20Interface = new Interface(ERC20_ABI);
      const data = erc20Interface.encodeFunctionData("approve", [
        spender,
        APPROVE_INFINITY_AMOUNT,
      ]);

      const txData = { to: tokenAddress, data, value: "0" };
      const receipt = await sendEvmTxWithRetry({ signer, txData, retry: 2 }).catch(err=>{
        const { message, shouldContinue} = handleEthersJsError(err)
        executionResult.error = 'APPROVE_TX_FAILED';
        if(shouldContinue){
          executionResult.error = 'RETRY_TRANSACTION_FAILED';
        }
        return executionResult;
      });
      // Use effectiveGasPrice for EIP-1559 compatibility
      const gasPrice = receipt.effectiveGasPrice || receipt.gasPrice || 0n;
      const approveFee = receipt.gasUsed * gasPrice;
      executionResult.allowance = true;
      executionResult.approve = {
        success: true,
        signature: receipt.hash,
        fee: approveFee,
      };
      return executionResult;
    }

    executionResult.allowance = true;
    return executionResult;
  } catch (err) {
    executionResult.error = err.message;
    return executionResult;
  }
};

export const getEvmBalance = async ({ walletAddress, chainId }) => {
  const provider = getConnectionProvider(chainId);
  return await provider.getBalance(walletAddress);
};

export const getEVMTokenBalance = async ({
  walletAddress,
  tokenAddress,
  chainId,
}) => {
  const provider = getConnectionProvider(chainId);
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider); // Fixed missing ABI
  return await tokenContract.balanceOf(walletAddress);
};

export const createEVMTransferTxData = ({
  sender,
  receiver,
  tokenAddress,
  value,
}) => {
  if (tokenAddress === ZeroAddress) {
    return {
      to: receiver,
      value: value.toString(),
    };
  }

  const erc20Interface = new Interface([
    "function transfer(address to, uint256 amount)",
  ]);
  const data = erc20Interface.encodeFunctionData("transfer", [
    receiver,
    value.toString(),
  ]);

  return {
    to: tokenAddress,
    data,
    value: "0",
  };
};

export async function getEVMTxInfo({
  Signature,
  chainId,
  receiver,
  sender,
  tokenOut,
}) {
  const provider = getConnectionProvider(chainId);
  const receipt = await provider.getTransactionReceipt(Signature);
  if(!receipt){
    throw new Error("Transaction receipt not found");
  }
  const gasUsed = receipt.gasUsed;
  const gasPrice =  receipt.gasPrice || 0n;
  const gasCost = gasUsed * gasPrice;
  let totalReceived;
  if (tokenOut == ZeroAddress) {
    // ETH Received = (Balance After - Balance Before) + Gas Fees Paid
    const blockNumber = receipt.blockNumber;

    // 2. Fetch balances at the block of the transaction and the block before it
    const [balanceBefore, balanceAfter] = await simpleRetryFn({
      fn: async () =>
        await Promise.all([
          provider.getBalance(receiver, blockNumber - 1),
          provider.getBalance(receiver, blockNumber),
        ]),
      retry: 3,
    });

    // 3. Calculate difference
    let ethDifference = balanceAfter - balanceBefore;

    totalReceived = ethDifference + gasCost;
  } else {
    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer event topic
    const toTopic = toBeHex(receiver.toLowerCase(), 32);

    const matchingLog = receipt.logs?.find(
      (log) =>
        log.address.toLowerCase() === tokenOut.toLowerCase() &&
        log.topics[0] === transferTopic &&
        log.topics[2]?.toLowerCase() === toTopic.toLowerCase(),
    );

    totalReceived = matchingLog ? BigInt(matchingLog.data) : undefined;
  }

  return {
    totalReceived,
    fee: gasCost,
  };
}
