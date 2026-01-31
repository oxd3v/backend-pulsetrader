import { getConnectionProvider } from "../../constant/common/chain.js";
import { Interface, Contract, ethers } from "ethers";
import { updateSignerFromNonceManager } from "../../lib/walletHandler/nonceSigner.js";
import { handleEthersJsError, simpleRetryFn } from "../../lib/errorHandler/handleError.js";

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
      const provider = signer.provider;
      const newSigner = updateSignerFromNonceManager(signer.privateKey).connect(
        provider,
      );
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

export const transferEVMNative = async ({
  chainId,
  receiver,
  value,
  signer,
}) => {
  const provider = getConnectionProvider(chainId);
  const connectSigner = signer.connect(provider);
  const receipt = await sendEVMTransaction({
    signer: connectSigner,
    txData: { to: receiver, value },
  });
  return {signature: receipt.hash, fee: BigInt(receipt.gasUsed*receipt.gasPrice)}; 
};

export const transferEVMTokens = async ({
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
  const receipt = await sendEVMTransaction({
    signer: connectSigner,
    txData: { to: tokenAddress, data, value: "0" },
  });
  return {signature: receipt.hash, fee: BigInt(receipt.gasUsed*receipt.gasPrice)};
};


export const approveInfinityAllowance = async ({
  tokenAddress,
  owner,
  spender,
  amount,
  signer,
}) => {
  const contract = new Contract(tokenAddress, ERC20_ABI, signer);

  // Single fetch for balance and allowance
  const [balance, allowance] = await Promise.all([
    contract.balanceOf(owner),
    contract.allowance(owner, spender),
  ]);

  const amountBI = BigInt(amount);

  if (BigInt(balance) < amountBI) {
    throw new Error("Insufficient balance");
  }

  if (BigInt(allowance) < amountBI) {
    const erc20Interface = new Interface(ERC20_ABI);
    const data = erc20Interface.encodeFunctionData("approve", [
      spender,
      APPROVE_INFINITY_AMOUNT,
    ]);

    const txData = { to: tokenAddress, data, value: "0" };
    const receipt = await sendEvmTxWithRetry({ signer, txData, retry: 2 });

    // Use effectiveGasPrice for EIP-1559 compatibility
    const gasPrice = receipt.effectiveGasPrice || receipt.gasPrice || 0n;
    const approveFee = receipt.gasUsed * gasPrice;

    return { allowance: true, approve: true, tx: receipt, approveFee };
  }

  return { allowance: true, approve: false };
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

export const createEVMTransferTxData = ({sender, receiver, tokenAddress, value }) => {
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

export async function getEVMTxInfo(txHash, chainId, receiver, tokenOut) {
  const provider = getConnectionProvider(chainId);
  const receipt = await provider.getTransactionReceipt(txHash);
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice || tx.gasPrice;
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
