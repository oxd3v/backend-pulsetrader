import { NonceManager, Wallet } from "ethers";
import logger from "../../logger.js";

// Enhanced nonce manager with safety features
let EVM_WALLET_NONCE_SIGHER_CACHE = new Map();
const MAX_CACHE_SIZE = 300;
const CACHE_TTL = 2 * 86400000;

export const getSignerFromNonceManager = (privateKey) => {
  try {
    // Validate inputs

    if (!privateKey) {
      throw new Error("Invalid params to get signer");
    }
    let tempWallet = new Wallet(privateKey);
    if (!tempWallet) {
      throw new Error("signer failed");
    }
    const key = tempWallet.address.toLowerCase();

    // Check cache with proper atomic update
    const entry = EVM_WALLET_NONCE_SIGHER_CACHE.get(key);
    if (entry && entry.signer != null) {
      entry.lastUsedAt = Date.now();
      return entry.signer;
    }

    // Create new signer with nonce manager
    const nonceManager = new NonceManager(tempWallet);

    // Add to cache with size check
    EVM_WALLET_NONCE_SIGHER_CACHE.set(key, {
      signer: nonceManager,
      lastUsedAt: Date.now(),
    });

    // Cleanup if cache is getting large
    if (EVM_WALLET_NONCE_SIGHER_CACHE.size > MAX_CACHE_SIZE) {
      cleanupCache();
    }

    return nonceManager;
  } catch (error) {
    throw error;
  }
};

export const updateSignerFromNonceManager = (privateKey) => {
  try {
    if (!privateKey) {
      throw new Error("Wallet ID, encrypted JSON, and chain ID are required");
    }

    let tempWallet = new Wallet(privateKey);
    if (!tempWallet) {
      throw new Error("signer failed");
    }
    const key = tempWallet.address.toLowerCase();

    const nonceManager = new NonceManager(tempWallet);

    // Clean up old signer if it exists
    const oldEntry = EVM_WALLET_NONCE_SIGHER_CACHE.get(key);
    if (oldEntry && oldEntry.signer) {
      oldEntry.signer = null;
    }

    EVM_WALLET_NONCE_SIGHER_CACHE.set(key, {
      signer: nonceManager,
      lastUsedAt: Date.now(),
    });

    return nonceManager;
  } catch (error) {
    throw new Error(`Failed to update signer: ${error.message}`);
  }
};

export const updateNonce = (signer) => {
  let provider = signer.provider;
  if (provider) {
    let signer = updateSignerFromNonceManager(signer.privateKey).connect(
      provider,
    );
    return signer;
  }
};

const cleanupCache = () => {
  const now = Date.now();
  const cutoff = now - CACHE_TTL;
  let deletedCount = 0;

  // Clean by TTL first
  for (const [key, value] of EVM_WALLET_NONCE_SIGHER_CACHE.entries()) {
    if (value.lastUsedAt < cutoff) {
      EVM_WALLET_NONCE_SIGHER_CACHE.delete(key);
      deletedCount++;
    }
  }

  // If still too large, clean by oldest usage
  if (EVM_WALLET_NONCE_SIGHER_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(EVM_WALLET_NONCE_SIGHER_CACHE.entries()).sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
    );

    const toDelete = entries.slice(0, Math.floor(entries.length * 0.1));
    toDelete.forEach(([key]) => EVM_WALLET_NONCE_SIGHER_CACHE.delete(key));
    deletedCount += toDelete.length;
  }

  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} stale signer entries`);
  }
};
