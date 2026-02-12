import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { handleSolanaWeb3Error } from "../../lib/errorHandler/handleError.js";
import { getConnectionProvider } from "../../constant/common/chain.js";
import { getReceivedAmountFromTx } from "./svmTrade.js"

export const getSolanaNativeBalance = async ({ walletAddress, chainId }) => {
  const connection = new Connection("https://solana.drpc.org", {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 30000, // 30 seconds
    wsEndpoint: undefined, // Disable WebSocket for simple RPC calls
  });
  const parsedWalletPublicKey = new PublicKey(walletAddress);
  const balance = await connection.getBalance(parsedWalletPublicKey);
  return BigInt(balance);
};

export const getSolanaTokenBalance = async ({
  walletAddress,
  tokenAddress,
  chainId,
}) => {
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const walletPublicKey = new PublicKey(walletAddress);
  const mintPublicKey = new PublicKey(tokenAddress);

  const associatedTokenAddress = getAssociatedTokenAddressSync(
    mintPublicKey,
    walletPublicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const accountInfo = await connection.getAccountInfo(associatedTokenAddress);

  if (!accountInfo) {
    return BigInt(0); // or 0n
  }

  const accountData = AccountLayout.decode(accountInfo.data);
  return BigInt(accountData.amount.toString());
};

export async function solTokenTransfer({
  chainId,
  tokenAddress,
  receiver,
  value,
  KeyPair,
}) {
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const mintPublicKey = new PublicKey(tokenAddress);
  const recipientPublicKey = new PublicKey(receiver);

  // 1. Get or create the ATA for the sender
  const sourceAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    KeyPair,
    mintPublicKey,
    KeyPair.publicKey,
  );

  // 2. Get or create the ATA for the receiver
  const destinationAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    KeyPair,
    mintPublicKey,
    recipientPublicKey,
  );

  // 3. Create the transfer instruction
  const transferInstruction = createTransferInstruction(
    sourceAccount.address,
    destinationAccount.address,
    KeyPair.publicKey,
    value,
  );

  // 4. Create Versioned Transaction
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: KeyPair.publicKey,
    recentBlockhash: blockhash,
    instructions: [transferInstruction],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([KeyPair]);
  const simulation = await simulateSolTransaction({
    transaction,
    connection,
    KeyPair,
  });
  const signature = await sendSolanaTx({ transaction, KeyPair, connection });
  const txDetails = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  const fee = txDetails?.meta?.fee || BigInt(0);
  return { signature, fee: BigInt(fee) };
}

export async function solNativeTransfer({ chainId, receiver, value, KeyPair }) {
  const connection = new Connection("https://solana-rpc.publicnode.com", {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 30000, // 30 seconds
    wsEndpoint: undefined, // Disable WebSocket for simple RPC calls
  });

  const transferInstruction = SystemProgram.transfer({
    fromPubkey: KeyPair.publicKey,
    toPubkey: new PublicKey(receiver),
    lamports: value,
  });

  // 2. Create Versioned Transaction
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: KeyPair.publicKey,
    recentBlockhash: blockhash,
    instructions: [transferInstruction],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([KeyPair]);
  // Simulate the transaction
  const simulation = await simulateSolTransaction({
    transaction,
    connection,
    KeyPair,
  });

  // Send and confirm the transaction
  const signature = await sendSolanaTx({ connection, KeyPair, transaction });

  const txDetails = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  const fee = txDetails?.meta?.fee || BigInt(0);
  return { signature, fee: BigInt(fee) };
}

export async function simulateSolTransaction({
  transaction,
  connection,
  KeyPair,
}) {
  // Check if it's a legacy or versioned transaction
  if (transaction instanceof VersionedTransaction) {
    const simulation = await connection.simulateTransaction(transaction, {
      commitment: "processed",
      sigVerify: true,
    });

    if (simulation.value.err) {
      throw new Error(
        `SIMULATION_FAILED: ${JSON.stringify(simulation.value.err)}`,
      );
    }

    return simulation;
  } else {
    // Legacy transaction
    const simulation = await connection.simulateTransaction(transaction, [
      KeyPair,
    ]);

    if (simulation.value.err) {
      throw new Error(
        `SIMULATION_FAILED: ${JSON.stringify(simulation.value.err)}`,
      );
    }

    return simulation;
  }
}

export const sendSolanaTx = async ({ connection, KeyPair, transaction }) => {
  // Handle both legacy and versioned transactions
  if (transaction instanceof VersionedTransaction) {
    // 1. Send the versioned transaction
    const signature = await connection.sendTransaction(transaction, {
      maxRetries: 3,
      skipPreflight: false,
      preflightCommitment: "processed",
    });

    // 2. Get latest blockhash for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();

    // 3. Confirm the transaction
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed",
    );

    if (confirmation.value.err) {
      throw new Error(`TX_FAILED: ${JSON.stringify(confirmation.value.err)}`);
    }

    return signature;
  } else {
    // Legacy transaction handling
    // Check blockhash validity
    if (transaction.recentBlockhash) {
      const isValid = await connection.isBlockhashValid(
        transaction.recentBlockhash,
      );
      if (!isValid) {
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
      }
    } else {
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
    }

    transaction.feePayer = KeyPair.publicKey;

    // Sign the transaction
    transaction.sign(KeyPair);

    // Send
    const signature = await connection.sendTransaction(transaction, [KeyPair], {
      skipPreflight: false,
      preflightCommitment: "processed",
    });

    // Confirm
    const confirmation = await connection.confirmTransaction({
      signature,
      commitment: "confirmed",
    });

    if (confirmation.value.err) {
      throw new Error(`TX_FAILED: ${JSON.stringify(confirmation.value.err)}`);
    }

    return signature;
  }
};

export const sendSvmTxWithRetry = async ({
  connection,
  KeyPair,
  transaction,
  maxRetries = 3,
  errorLabel,
}) => {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await sendSolanaTx({ connection, KeyPair, transaction });
    } catch (err) {
      attempts++;
      logger.error(`[SOLANA_RETRY_ATTEMPT_FAILED:${errorLabel}]`, err.message);

      // Handle specific Solana errors logic
      let { shouldContinue } = handleSolanaWeb3Error(err);

      if (shouldContinue == true) {
        attempts--;
      }

      if (attempts >= maxRetries) {
        throw err;
      }

      // Exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * attempts));
    }
  }
};

export const getSVMTxInfo = async ({Signature, chainId, receiver, sender, tokenOut})=>{
  let connection = getConnectionProvider(chainId);
  return getReceivedAmountFromTx(connection, sender, tokenOut, Signature)
}
