import {
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  PublicKey,
  Connection,
  Keypair,
} from "@solana/web3.js";
import { getSolanaSwapInstructionRoute } from "../../lib/oracle/swap.js";
import { sendSvmTxWithRetry, simulateSolTransaction } from "./svmTransfer.js";
import { ZeroAddress } from "ethers";
import {
  handleAxiosError,
  throwError,
  handleSolanaWeb3Error,
} from "../../lib/errorHandler/handleError.js";
import {
  SOLANA_BASE_FEE,
  DEFAULT_SOLANA_PRIORITY_FEE,
  SOLANA_AGGREGATORS,
  ORDER_GAS_BUFFER,
  BASIS_POINT_DIVISOR_BIGINT,
} from "../../constant/common/order.js";

// Constants
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
const DEFAULT_COMPUTE_UNIT = 250000n;

export async function getBestSwapRoute({
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps = 500,
  userAddress,
}) {
  const results = [];
  const errors = [];

  // Use Promise.all to fetch concurrently
  let res = await Promise.allSettled(
    SOLANA_AGGREGATORS.map(async (aggregator) => {
      // Jupiter specific normalization (if needed strictly, otherwise generic works)
      const currentTokenIn =
        tokenIn === ZeroAddress
          ? aggregator === "jupiter"
            ? SOL_MINT
            : DEFAULT_PUBLIC_KEY
          : tokenIn;
      const currentTokenOut =
        tokenOut === ZeroAddress
          ? aggregator === "jupiter"
            ? SOL_MINT
            : DEFAULT_PUBLIC_KEY
          : tokenOut;
      try {
        //console.log(aggregator,currentTokenIn, currentTokenOut)
        const result = await getSolanaSwapInstructionRoute({
          tokenIn: currentTokenIn,
          tokenOut: currentTokenOut,
          amountIn,
          slippageBps,
          aggregator,
          userAddress,
        });
        //console.log(result)
        if (result?.success && result.amountOut > 0n) {
          results.push({ ...result, aggregator });
        }
      } catch (err) {
        //console.log(err);
        const { message, shouldContinue } = handleAxiosError(err);
        errors.push({ aggregator, error: message, shouldContinue });
      }
    }),
  );

  if (results.length === 0) {
    const lastError = errors[errors.length - 1];
    throwError({
      message: lastError
        ? lastError.error
        : "All aggregators failed to find a route",
      shouldContinue: lastError ? lastError.shouldContinue : false,
    });
  }

  // Sort by Best Output (Highest amountOut)
  return results.sort((a, b) => {
    if (Number(a.amountOut) > Number(b.amountOut)) return -1;
    if (Number(a.amountOut) < Number(b.amountOut)) return 1;
    return 0;
  });
}

async function createVersionedTransaction({
  swapInstruction,
  connection,
  feePayer,
}) {
  const { addressLookupTable, instructions } = swapInstruction;
  const lookupTables = await Promise.all(
    addressLookupTable.map((pubkey) =>
      connection
        .getAddressLookupTable(new PublicKey(pubkey))
        .then((res) => res.value)
    )
  );
  const parsedInstructions = instructions.map((ix) => {
    return new TransactionInstruction({
      keys: ix.accounts.map((acc) => ({
        pubkey: new PublicKey(acc.address),
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      })),
      programId: new PublicKey(ix.programId),
      data: Buffer.from(ix.data, "base64"),
    });
  });
  const blockhash = (await connection.getLatestBlockhash()).blockhash;

  const message = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: blockhash,
    instructions: parsedInstructions,
  }).compileToV0Message(lookupTables);

  const versionedTx = new VersionedTransaction(message);
  return versionedTx;
}

async function simulateTransaction({
  transaction,
  connection,
  KeyPair,
}) {
  // We clone to avoid mutating the original tx object before sending
  // (though signing in place is usually required, simulation signature is separate)
  const txToSimulate = transaction;
  txToSimulate.sign([KeyPair]);

  const simulation = await connection.simulateTransaction(txToSimulate, {
    sigVerify: true,
    commitment: "processed",
  });

  return simulation;
}

export async function getReceivedAmountFromTx(
  connection,
  feePayer,
  tokenOut,
  signature,
) {
  try {
    const payerKey = new PublicKey(feePayer);
    const tokenOutKey = new PublicKey(tokenOut);

    // Retry strategy could be added here, but keeping it simple for now
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx?.meta) return { totalReceived: "0", fee: "0" };

    const feeLamports = tx.meta.fee;
    const isNative =
      tokenOutKey.equals(PublicKey.default) ||
      tokenOutKey.toBase58() === SOL_MINT;

    // 1. Native SOL Transfer
    if (isNative) {
      const idx = tx.transaction.message.accountKeys.findIndex((k) =>
        k.equals(payerKey),
      );
      if (idx === -1) return { totalReceived: "0", fee: feeLamports };

      const pre = tx.meta.preBalances?.[idx] ?? 0;
      const post = tx.meta.postBalances?.[idx] ?? 0;

      // Logic: (Post - Pre) + Fee = Net Change.
      // If I received SOL, Post > Pre.
      const received = Math.max(0, post - pre + feeLamports);

      return {
        totalReceived: BigInt(received),
        fee: BigInt(feeLamports),
      };
    }

    // 2. SPL Token Transfer
    const tokenOutMint = tokenOutKey.toBase58();
    const payerStr = payerKey.toBase58();

    const preBalObj = tx.meta.preTokenBalances?.find(
      (b) => b.mint === tokenOutMint && b.owner === payerStr,
    );
    const postBalObj = tx.meta.postTokenBalances?.find(
      (b) => b.mint === tokenOutMint && b.owner === payerStr,
    );

    const preAmount = BigInt(preBalObj?.uiTokenAmount?.amount || "0");
    const postAmount = BigInt(postBalObj?.uiTokenAmount?.amount || "0");

    const received = postAmount - preAmount;

    return {
      totalReceived: received > 0n ? received : 0n,
      fee: BigInt(feeLamports),
    };
  } catch (err) {
    //console.error("Error parsing tx amount:", err);
    return { totalReceived: "0", fee: "0" };
  }
}

export async function executeSolanaSwap({
  tokenIn,
  tokenOut,
  amountIn,
  slippage = 500,
  keyPair,
}) {
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const walletAddress = keyPair.publicKey.toBase58();

  // 1. Get Routes
  const bestRoutes = await getBestSwapRoute({
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    slippageBps: slippage,
    userAddress: walletAddress,
  });
  //console.log(bestRoutes);

  if (!bestRoutes || bestRoutes.length === 0) {
    throwError({ message: "No swap routes found", shouldContinue: false });
  }

  // 3. Simulate & Select Best Valid Route
  let workingVersionTransaction;
  let computeUnits = DEFAULT_COMPUTE_UNIT;
  for (let i = 0; i < bestRoutes.length; i++) {
    try {
      let route = bestRoutes[i];
      const versionedTransaction = await createVersionedTransaction({
        swapInstruction: route,
        connection,
        feePayer: keyPair,
      });
      console.log(versionedTransaction);
      //versionedTransaction.sign([keyPair]);
      const simResult = await simulateTransaction({
        transaction: versionedTransaction,
        connection,
        KeyPair: keyPair,
      });
      console.log(simResult);

      if (simResult.value && !simResult.value.err) {
        computeUnits = BigInt(
          simResult.value.unitsConsumed || DEFAULT_COMPUTE_UNIT,
        );
        workingVersionTransaction = versionedTransaction;
        break;
      }
    } catch (err) {
      console.log(err)
      let { message, shouldContinue } = handleSolanaWeb3Error(err);
      if (shouldContinue == true) {
        i--;
        await new Promise((r) => setTimeout(r, 1000));
      }
      continue;
      // Continue to next route
    }
  }

  if (!workingVersionTransaction) {
    throwError({
      message: "Transaction simulation failed for all routes",
      shouldContinue: true,
    });
  }

  const expFee = SOLANA_BASE_FEE + (computeUnits * DEFAULT_SOLANA_PRIORITY_FEE) / 1_000_000n;
  bufferGasFee = (expFee * ORDER_GAS_BUFFER) / BASIS_POINT_DIVISOR_BIGINT;

  let walletState = getWalletGuard(walletAddress);
  const hasFunds = await walletState.hasSufficientFunds({
    chainId,
    tokenAddress: tokenIn,
    amountRequired: BigInt(amountIn),
    txFee: bufferGasFee,
  });

  if (!hasFunds) {
    throwError({
      message: "Insufficient funds for Swap + Fee",
      shouldContinue: false,
    });
  }
  walletState.addPendingSpend({
    chainId,
    tokenAddress: ZeroAddress,
    amount: bufferGasFee,
  });
  walletState.addPendingSpend({
    chainId,
    tokenAddress: tokenIn,
    amount: amountIn,
  });

  try {
    let signature = await sendSvmTxWithRetry({
      connection,
      Keypair: keyPair,
      transaction: workingVersionTransaction,
      maxRetries: 3,
      errorLabel: `SWAP_FAILED: by ${walletAddress} for ${tokenOut} from ${tokenIn} `,
    });

    return {
      success: true,
      signature,
      ...(await getReceivedAmountFromTx(
        connection,
        keyPair.publicKey,
        tokenOut,
        signature,
      )),
    };
  } catch (err) {
    console.log(err)
    const { message, shouldContinue } = handleSolanaWeb3Error(err);
    throwError({ message, shouldContinue });
  } finally {
    walletState.removePendingSpend({
      chainId,
      tokenAddress: ZeroAddress,
      amount: bufferGasFee,
    });
    walletState.removePendingSpend({
      chainId,
      tokenAddress: tokenIn,
      amount: totalAmountCheck,
    });
  }
}
