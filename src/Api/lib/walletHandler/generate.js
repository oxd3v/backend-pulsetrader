import { USER_LEVEL } from "../../constant/common/user.js";
import WalletModal from "../../model/wallet.js";
import { encrypt } from "../crypto/encryption.js";
import { getSignerFromNonceManager } from "./nonceSigner.js";
import {
  createWalletFromMnemonic,
  createRandomWallet,
  decryptWalletKey,
  solanaKeyPair,
} from "./create.js";
import "dotenv/config";
// Consideration: If this is a server, these global counters will reset on restart.
// Consider fetching the last index from the database instead.
const FRONT_END_SECURITY = process.env.FRONT_END_WALLET_SECURITY;
const WALLET_PRIVATE_KEY_SECURITY = process.env.WALLET_PRIVATE_KEY_SECURITY;

export const getWalletCount = async (status) => {
  const userLevel = USER_LEVEL[status?.toUpperCase()];
  return {
    evmWallets: userLevel.maxEVMWallets || 3,
    svmWallets: userLevel.maxSVMWallets || 2,
  };
};

export const createNewWallet = async (networkType, userId) => {
  const walletObj = await createRandomWallet(networkType);

  return WalletModal.create({
    user: userId,
    address: walletObj.address,
    encryptedWalletKey: encrypt(walletObj.privateKey, WALLET_PRIVATE_KEY_SECURITY),
    network: networkType,
  });
};

export const createWallets = async ({ evmWallets, svmWallets }, user) => {
  const tasks = [];

  // Use a helper loop to push tasks into the array
  const pushTasks = (count, type) => {
    for (let i = 0; i < count; i++) {
      tasks.push(createNewWallet(type, user._id));
    }
  };

  if (evmWallets > 0) pushTasks(evmWallets, "EVM");
  if (svmWallets > 0) pushTasks(svmWallets, "SVM");

  // Execute all creations in parallel for maximum performance
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
};

export const generateWallet = async ({
  user,
  previousWallets,
  evmWalletCounts,
  svmWalletCounts,
}) => {
  if (user.status != 'admin') {
    let userLevel = USER_LEVEL[user.status.toUpperCase()];
    let presentEVMWalletCount =
      previousWallets.filter((w) => w.network == "EVM") + evmWalletCounts;
    let presentSVMWalletCount =
      previousWallets.filter((w) => w.network == "SVM") + svmWalletCounts;

    if (
      presentEVMWalletCount > userLevel.maxEVMWallets ||
      presentSVMWalletCount > userLevel.maxSVMWallets
    ) {
      throw new Error("Max Wallet exceed!");
    }
  }

  await createWallets(
    { evmWallets: evmWalletCounts, svmWallets: svmWalletCounts },
    user,
  );
};

export const encryptPrivateKeyForFrontend = async ({ address, userId }) => {
  let WalletData = await WalletModal.findOne({
    address: { $regex: walletAddress, $options: "i" },
    user: userId,
  });
  if (!WalletData) {
    throw new Error("wallet not found");
  }
  if (!WalletData.encryptedWalletKey) {
    throw new Error("invalid wallet");
  }
  let privateKey = decryptWalletKey(WalletData.encryptedWalletKey);
  let encryptedPrivateKey = encrypt(privateKey, FRONT_END_SECURITY);
  return encryptedPrivateKey;
};

export const getSigner =  (encryptedWalletKey, networkType) => {
  let decryptKey = decryptWalletKey(encryptedWalletKey);
  let signer;
  if (networkType == "SVM") {
    signer = solanaKeyPair(decryptKey);
  } else {
    signer = getSignerFromNonceManager(decryptKey);
  }
  return signer;
};
