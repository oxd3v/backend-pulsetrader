import UserModel from "../model/user.js";
import OrderModel from "../model/order.js";
import ActivityModel from "../model/activity.js";
import WalletModel from "../model/wallet.js";
import {
  checkRequirements,
  encodeInvitationCode,
} from "../lib/join/joinRequirements.js";
import {
  generateWallet,
  encryptPrivateKeyForFrontend,
} from "../lib/walletHandler/generate.js";
import { withdraw } from "../lib/transfer/withdraw.js";

export const checkUser = async (req, res) => {
  let { userAccount } = req.query;
  try {
    let userData = await UserModel.findOne({
      account: { $regex: userAccount, $options: "i" },
    });
    if (!userData) {
      return res
        .status(200)
        .send({ validation: false, type: "USER_NOT_FOUND" });
    }
    let orders = (await OrderModel.find({ user: userData._id }).populate('user', 'account status inviter').populate('wallet', 'address ')) || [];
    let histories = (await ActivityModel.find({ user: userData._id })) || [];
    let wallets =
      (await WalletModel.find(
        { user: userData._id },
        { encryptedWalletKey: 0 },
      )) || [];
    return res.status(200).send({
      validation: true,
      user: { userData, orders, histories, wallets },
    });
  } catch (err) {
    return res.status(500).send({ type: "SERVER_ERROR" });
  }
};

export const join = async (req, res) => {
  let account = req.account;
  let { signUpMethod, invitationCode } = req.body;
  try {
    let userData = await UserModel.findOne({
      account: { $regex: account, $options: "i" },
    });
    if (userData) {
      return res.status(200).send({
        joining: false,
        type: "USER_EXIST",
        message: "User already joined!",
      });
    }
    userData = new UserModel({
      account,
    });
    let verifyAndUpdate = await checkRequirements({
      method: signUpMethod,
      user: userData,
      option: { invitationCode },
    });
    if (verifyAndUpdate.success == false) {
      return res.status(500).send({
        joining: false,
        type: "UNAUTHORIZED",
        message: verifyAndUpdate.error || "Authorization failed",
      });
    }
    userData.silver = verifyAndUpdate.update.status;
    userData.inviter = verifyAndUpdate.update.inviter;
    await userData.save();

    try {
      await generateWallet({
        user: userData,
        previousWallets: [],
        evmWalletCounts: 3,
        svmWalletCounts: 2,
      });
    } catch (err) {}

    let wallets =
      (await WalletModel.find(
        { user: userData._id },
        { encryptedWalletKey: 0 },
      )) || [];
    return res.status(200).send({
      joining: true,
      user: { userData, orders: [], histories: [], wallets },
    });
  } catch (err) {
    return res.status(500).send({
      joining: false,
      type: "SERVER_ERROR",
    });
  }
};

export const getEncryptedPrivateKey = async (req, res) => {
  let user = req.user;
  let { walletAddress } = req.query;
  if (!walletAddress) {
    return res.status(400).send({ message: "required wallet address" });
  }
  try {
    let key = await encryptPrivateKeyForFrontend({
      address: walletAddress,
      userId: user._id,
    });
    return res.status(200).send({ key });
  } catch (err) {
    return res
      .status(500)
      .send({ message: err.message || "wallet private key fetching failed" });
  }
};

export const createInvitationCode = async (req, res) => {
  try {
    const user = req.user;
    const { invitedTo, expireAt, status = "silver" } = req.body;

    // 1. Validation
    if (!invitedTo) {
      return res
        .status(400)
        .send({ message: "Missing required field: invitedTo" });
    }

    // 2. Encode the code
    // Ensure expireAt is a valid date or default to 7 days from now
    const expirationDate = expireAt
      ? new Date(expireAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitationCodeDetails = encodeInvitationCode({
      invitedTo,
      expireAt: expirationDate,
      metadata: { status },
    });

    // 3. Database Update
    // FIX: $push must be the key, followed by the field to update
    const updateResult = await UserModel.updateOne(
      { _id: user._id },
      { $push: { invitationCodes: invitationCodeDetails.invitationCode } },
    );

    return res.status(200).send({
      code: invitationCodeDetails.invitationCode,
      message: "Successfully created invitation code",
    });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "Invitation creation failed", type: "SERVER_ERROR" });
  }
};

export const deleteInvitationCode = async (req, res) => {
  try {
    const user = req.user;
    const { code } = req.body;

    // 1. Validation
    if (!code) {
      return res.status(400).send({ message: "Missing required field: code" });
    }
    let isCodeExist =
      Array.isArray(user.invitationCodes) &&
      user.invitationCodes.includes(code);

    if (!isCodeExist) {
      return res.status(200).send({
        message: "Code isnt exist in user invitation codes",
        type: "INVITATION_NOT_EXIST",
      });
    }
    // 3. Database Update
    // FIX: $push must be the key, followed by the field to update
    await UserModel.updateOne(
      { _id: user._id },
      { $pull: { invitationCodes: code } },
    );

    return res.status(200).send({
      message: "Successfully remove invitation code",
    });
  } catch (err) {
    return res.status(500).send({ message: "Invitation code removed failed" });
  }
};

export const withdrawBalance = async (req, res) => {
  let user = req.user;
  let {
    receiver,
    tokenAddress,
    chainId,
    value,
    walletAddress,
    tokenDecimals,
    tokenSymbol,
  } = req.body;
  if (
    !receiver ||
    !tokenAddress ||
    !chainId ||
    !walletAddress ||
    !tokenDecimals ||
    !tokenSymbol
  ) {
    return res.status(400).send({
      message: `Missing required field: ${!receiver ? "reaceiver" : ""} ${value ? (Number(value) == 0 ? "invalid value" : "") : "value"}  ${!tokenAddress ? "tokenaAddress" : ""} ${!chainId ? "chainId" : ""} ${!walletAddress ? "walletAddress" : ""} ${!tokenDecimals ? "tokenDecimals" : ""} ${!tokenSymbol ? "tokenSymbol" : ""}   params`,
    });
  }
  if (Number(value) == 0) {
    return res.status(400).send({
      message: `Invalid field: value`,
    });
  }
  try {
    let walletData = await WalletModel.findOne({
      address: { $regex: walletAddress, $options: "i" },
      user: user._id,
    });
    await withdraw({
      walletData,
      chainId,
      receiver,
      value,
      tokenAddress,
      tokenSymbol,
      tokenDecimals,
      user,
    });
    return res
      .status(200)
      .send({ success: true, message: "Successfully withdraw asset" });
  } catch (err) {
    return res.status(500).send({ type: "WITHDRAW_FAILED" });
  }
};

export const createNewWallet = async (req, res) => {
  const user = req.user;
  const { evmWallets, svmWallets } = req.body;
  if (evmWallets == 0 && svmWallets == 0) {
    return res
      .status(400)
      .send({
        message: `Invalid field: ${evmWallets == 0 ? "evmWallets" : ""} ${svmWallets == 0 ? "svmWallets" : ""}`,
      });
  }
  let previousWallets = (await WalletModel.find({ user: user._id })) || [];
  try {
    await generateWallet({
      user,
      previousWallets,
      evmWalletCounts: evmWallets,
      svmWalletCounts: svmWallets,
    });
    let wallets = await WalletModel.find({ user: user._id });
    return res.status(200).send({ wallets, message: "Successfully created" });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "Wallet creation failed", type: "SERVER_ERROR" });
  }
};

export const addToken = async (req, res) => {
  let user = req.user;
  let { tokenAddress, chainId } = req.body;
  if (!tokenAddress || !chainId) {
    return res
      .status(400)
      .send({
        message: `Missing required params: ${!tokenAddress ? "tokenAddress" : ""} ${!chainId ? "chainId" : ""}`,
        type: "MISSING_PARAMS",
      });
  }
  try {
    let tokenKey = `${tokenAddress}:${chainId}`;
    const isIncluded = array.some(
      (item) => item.toLowerCase() === search.toLowerCase(),
    );
    if (isIncluded) {
      return res
        .status(200)
        .send({
          message: "Token is already exist in user asset",
          type: "TOKEN_EXIST",
        });
    }
    await UserModel.updateOne(
      { _id: user._id },
      { assetes: { $push: tokenKey } },
    );
    return res.status(200).send({ message: "Token added successfully" });
  } catch (err) {
    return res.status(500).send({ message: "User token addition failed" });
  }
};
