import { ethers, Wallet } from "ethers";
import bip39 from "bip39";
import bs58 from "bs58";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import { encrypt, decrypt } from "../crypto/encryption.js";
import "dotenv/config";
const SEED_PHRASES = process.env.MNEMONIC;
const SECURITY = process.env.WALLET_PRIVATE_KEY_SECURITY;

export const createWalletFromMnemonic = async (accountIndex = 0, chainType) => {
  try {
    if (!SEED_PHRASES || typeof SEED_PHRASES !== "string") {
      throw new Error("Invalid seed phrases provided");
    }

    if (accountIndex < 0 || !Number.isInteger(accountIndex)) {
      throw new Error(`Invalid account index: ${accountIndex}`);
    }

    if (!ethers.Mnemonic.isValidMnemonic(SEED_PHRASES)) {
      throw new Error(`Invalid mnemonic phrase`);
    }

    let wallet;
    if (chainType == "EVM") {
      wallet = await createEVMWallet(accountIndex);
    } else {
      wallet = await createSVMWallet(accountIndex);
    }

    return wallet;
  } catch (error) {
    throw error;
  }
};

export const createRandomWallet =  (chainType) => {
  let wallet;
  if (chainType == "EVM") {
    wallet =  createRandomEVMWallet();
  } else {
    wallet =  createRandomSVMWallet();
  }

  return wallet;
};

const createEVMWalletFromMnemoic = async (accountIndex) => {
  const mnemonic = ethers.Mnemonic.fromPhrase(SEED_PHRASES);
  const path = `m/44'/60'/${accountIndex}'/0/0`;
  try {
    // 3. Create the HDNodeWallet
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic, path);
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  } catch (error) {
    throw new Error(`Wallet generation failed: ${error.message}`);
  }
};

const createSVMWalletFromMnemoic = async (accountIndex) => {
  let seedHex;
  try {
    seedHex = bip39.mnemonicToSeedSync(SEED_PHRASES).toString("hex");
  } catch (seedError) {
    throw new Error(
      `Failed to derive seed from mnemonic: ${seedError.message}`,
    );
  }

  const path = `m/44'/501'/${accountIndex}'`;

  let derivedSeed;
  try {
    derivedSeed = derivePath(path, seedHex).key;
  } catch (deriveError) {
    throw new Error(`Failed to derive key from path: ${deriveError.message}`);
  }

  let keyPair;
  try {
    keyPair = Keypair.fromSeed(Uint8Array.from(derivedSeed));
  } catch (keypairError) {
    throw new Error(`Failed to derive key from path: ${keypairError.message}`);
  }

  return {
    address: keyPair.publicKey.toBase58(),
    privateKey: bs58.encode(keyPair.secretKey),
  };
};

const createRandomEVMWallet =  () => {
  let wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
};

const createRandomSVMWallet =  () => {
  const keyPair = Keypair.generate();
  return {
    address: keyPair.publicKey.toBase58(),
    privateKey: bs58.encode(keyPair.secretKey),
  };
};

export const encryptPrivateKey = async (privateKey) => {
  let encryptedWalletKey = encrypt(privateKey, SECURITY);
  return encryptedWalletKey;
};

export const decryptWalletKey = (encryptedKey) => {
  let decryptWalletKey = decrypt(encryptedKey, SECURITY);
  return decryptWalletKey;
};

export const solanaKeyPair = (WalletSecretKey) => {
  const secretKey = bs58.decode(WalletSecretKey);
  return Keypair.fromSecretKey(secretKey);
};

export const evmSigner = (WalletSecretKey) => {
  return new Wallet(WalletSecretKey);
};
