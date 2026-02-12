import { ZeroAddress } from "ethers";
import { throwError, simpleRetryFn } from "../errorHandler/handleError.js";
import {
  getNativeBalance,
  getTokenBalance,
} from "../../blockchain/common/transfer.js";

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
    this.balance = new Map();
    this.currentState = 0;
  }

  async updateBalance({ chainId, tokenAddress, updateStatus = false }) {
    const tokenKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    let balanceInfo = this.pendingSpends.get(tokenKey);
    try {
      const tokenBalance =
        tokenAddress === ZeroAddress
          ? await simpleRetryFn({
              fn: async () =>
                await getNativeBalance({
                  walletAddress: this.address,
                  chainId,
                }),
              retry: 3,
            })
          : await simpleRetryFn({
              fn: async () =>
                await getTokenBalance({
                  walletAddress: this.address,
                  tokenAddress,
                  chainId,
                }),
              retry: 3,
            });
      if (updateStatus) {
        this.currentState += 1;
      }
      this.balance.set(tokenKey, {
        balance: tokenBalance,
        state: this.currentState,
      });
      return tokenBalance;
    } catch (err) {
      if (this.currentState > balanceInfo.state) {
        throw err;
      }
    }
  }

  async assetHasSufficientFunds({ chainId, tokenAddress, amountRequired }) {
    this.lastUsedAt = Date.now();
    const tokenKey = `${chainId}:${tokenAddress.toLowerCase()}`;
    const tokenPending = this.pendingSpends.get(tokenKey) || 0n;
    let currentBalance = await this.updateBalance({ chainId, tokenAddress });
    if(!currentBalance){
     const balanceInfo = this.balance.get(tokenKey);
      currentBalance = balanceInfo.balance;
    }
    const effectiveTokenBalance = BigInt(currentBalance) - tokenPending;
    if (effectiveTokenBalance < BigInt(amountRequired)) {
      throw new Error(
        `Insufficient ${tokenAddress}. Available: ${currentBalance.toString()}, Locked: ${tokenPending.toString()}, Needed: ${amountRequired.toString()}`,
      );
    }
    return true;
  }

  addPendingSpend({ chainId, tokenAddress, amount }) {
    this.lastUsedAt = Date.now();
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;
    const current = this.pendingSpends.get(key) || 0n;
    this.pendingSpends.set(key, current + BigInt(amount));
    this.lastUsedAt = Date.now();
  }

  removePendingSpend({ chainId, tokenAddress, amount }) {
    const key = `${chainId}:${tokenAddress}`;
    const current = this.pendingSpends.get(key) || 0n;
    const next = current - BigInt(amount);
    this.pendingSpends.set(key, next > 0n ? next : 0n);
    this.lastUsedAt = Date.now();
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
    const isExpired = now - state.lastUsedAt > CACHE_TTL;
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
