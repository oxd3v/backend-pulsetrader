import { ZeroAddress } from "ethers";
import { throwError, simpleRetryFn } from "../errorHandler/handleError.jss";
import {
  getNativeBalance,
  getTokenBalance,
} from "../lib/blockchain/transfer.js";

// GLOBAL CACHE: This ensures that different parts of your app 
// share the SAME "pendingSpends" for a specific wallet address.
const WALLET_STATE_CACHE = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 Hours
//const MAX_CACHE_SIZE = 500; // Protection against memory overflow

class WalletState {
  constructor(address) {
    this.pendingSpends = new Map(); // Key: "chainId:tokenAddress"
    this.lastUsedAt = Date.now();
    this.address = address;
  }

  /**
   * Enhanced Fund Guard
   * Checks if (On-Chain Balance - Pending Spends) >= (Required + Fees)
   */
  async hasSufficientFunds({
    chainId,
    tokenAddress,
    amountRequired,
    txFee = 0n,
  }) {
    this.lastUsedAt = Date.now();
    const nativeKey = `${chainId}:${ZeroAddress}`;
    const tokenKey = `${chainId}:${tokenAddress}`;

    // Get currently "locked" amounts from previous trades not yet mined
    const nativePending = this.pendingSpends.get(nativeKey) || 0n;
    const tokenPending = this.pendingSpends.get(tokenKey) || 0n;

    try {
      // 1. Fetch Real-time Native Balance (for gas)
      const nativeBalance = await simpleRetryFn({
        fn: async () => await getNativeBalance({ walletAddress: this.address, chainId }),
        retry: 3,
      });

      // Scenario A: Trading Native Token (ETH/SOL)
      if (tokenAddress === ZeroAddress) {
        const effectiveBalance = BigInt(nativeBalance) - nativePending;
        const totalNeeded = BigInt(amountRequired) + BigInt(txFee);

        if (effectiveBalance < totalNeeded) {
          this._triggerInsufficientError("Native", nativeBalance, nativePending, totalNeeded);
        }
        return true;
      }

      // Scenario B: Trading an ERC20/SPL Token
      const tokenBalance = await simpleRetryFn({
        fn: async () => await getTokenBalance({ walletAddress: this.address, tokenAddress, chainId }),
        retry: 3,
      });

      const effectiveTokenBalance = BigInt(tokenBalance) - tokenPending;
      const effectiveNativeBalance = BigInt(nativeBalance) - nativePending;

      // Check if we have enough of the token to trade
      if (effectiveTokenBalance < BigInt(amountRequired)) {
        this._triggerInsufficientError(tokenAddress, tokenBalance, tokenPending, amountRequired);
      }

      // Check if we have enough native for the transaction fee (Gas)
      if (effectiveNativeBalance < BigInt(txFee)) {
        this._triggerInsufficientError("Gas (Native)", nativeBalance, nativePending, txFee);
      }

      return true;
    } catch (err) {
      // If it's our custom error, rethrow it. Otherwise, generic error.
      if (err.message.includes("[FundGuard]")) throw err;
      
      throwError({
        message: `[FundGuard] Internal balance verification failed: ${err.message}`,
        shouldContinue: false,
      });
    }
  }

  /**
   * Lock funds locally
   */
  addPendingSpend({chainId, tokenAddress, amount}) {
    const key = `${chainId}:${tokenAddress}`;
    const current = this.pendingSpends.get(key) || 0n;
    this.pendingSpends.set(key, current + BigInt(amount));
    this.lastUsedAt = Date.now();
  }

  /**
   * Release funds locally
   */
  removePendingSpend({chainId, tokenAddress, amount}) {
    const key = `${chainId}:${tokenAddress}`;
    const current = this.pendingSpends.get(key) || 0n;
    const next = current - BigInt(amount);
    this.pendingSpends.set(key, next > 0n ? next : 0n);
    this.lastUsedAt = Date.now();
  }

  _triggerInsufficientError(label, real, pending, req) {
    throwError({
      message: `[FundGuard] Insufficient ${label}. Available: ${real.toString()}, Locked: ${pending.toString()}, Needed: ${req.toString()}`,
      shouldContinue: false,
    });
  }
}



/**
 * Cleanup Logic: Iterates through the cache and removes 
 * expired or unused wallet states.
 */
const cleanupCache = () => {
  const now = Date.now();
  for (const [address, state] of WALLET_STATE_CACHE.entries()) {
    // Check if the state has exceeded TTL 
    // AND ensure no funds are currently "locked" (pendingSpends)
    const isExpired = (now - state.lastUsedAt) > CACHE_TTL;
    const hasNoActiveTrades = state.pendingSpends.size === 0;

    if (isExpired && hasNoActiveTrades) {
      WALLET_STATE_CACHE.delete(address);
    }
  }
};

export const getWalletGuard = (address) => {
  if (!address) throw new Error("Wallet address required for Guard");
  
  const key = address.toLowerCase();
  let state = WALLET_STATE_CACHE.get(key);
  
  if (!state) {
    // Trigger cleanup when adding a new entry to keep memory clean
    cleanupCache();
    
    state = new WalletState(key);
    WALLET_STATE_CACHE.set(key, state);
  }
  
  state.lastUsedAt = Date.now(); // Update activity timestamp
  return state;
};