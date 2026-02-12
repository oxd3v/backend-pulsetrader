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
import { isEVMAddress } from "../blockchain/common/utility.js";
import { withdraw } from "../lib/transfer/withdraw.js";
import {
  verifyToken,
  extractAddressFromToken,
} from "../lib/middleware/auth.js";
import {
  DEFAULT_CONNECTION_EXPIRATION,
  DEFAULT_INVITATION_EXPIRY,
  USER_LEVEL,
} from "../constant/common/user.js";
import logger from "../logger.js";

export const validateParams = (params, requiredFields) => {
  const missing = requiredFields.filter((field) => !params[field]);

  if (missing.length > 0) {
    return {
      message: "MISSING_PARAMS",
      type: missing.join(", "),
      error: missing,
    };
  }

  return null;
};

export const checkUser = async (req, res) => {
  try {
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(500).json({ connect: false, error: "UNAUTHENTICATED" });
    }
    let { address, error, type } = extractAddressFromToken(token);
    if (!address) {
      return res.status(500).json({ connect: false, error: "UNAUTHENTICATED" });
    }
    const user = await UserModel.findOne({
      account: { $regex: new RegExp(`^${address}$`, "i") },
    }).lean();
    // Execute queries in parallel for better performance
    const [orders, histories, wallets] = await Promise.all([
      OrderModel.find({ user: user._id })
        .populate("user", "account status inviter")
        .populate("wallet", "address")
        .lean(),
      ActivityModel.find({ user: user._id }).lean(),
      WalletModel.find({ user: user._id }, { encryptedWalletKey: 0 }).lean(),
    ]);

    return res.status(200).json({
      connect: true,
      user: {
        userData: {
          ...user,
          // sensitiveInfo: undefined // Explicitly exclude sensitive data
        },
        orders,
        histories,
        wallets,
      },
    });
  } catch (err) {
    //logger.error("Check user error", { error: err.message, userId: req.user?._id });
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const connect = async (req, res) => {
  const { account, encryptedToken } = req.body;
  // Validate required parameters
  const validationError = validateParams({ account, encryptedToken }, [
    "account",
    "encryptedToken",
  ]);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  // Verify token
  const verificationResult = verifyToken(encryptedToken, account);
  if (!verificationResult.verified) {
    return res.status(401).json({
      success: false,
      message: verificationResult.message,
      type: verificationResult.type || null,
    });
  }

  try {
    // Find user
    const user = await UserModel.findOne({
      account: { $regex: new RegExp(`^${account}$`, "i") },
    }).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "USER_NOT_FOUND",
      });
    }

    // Parallel queries for performance
    const [orders, histories, wallets] = await Promise.all([
      OrderModel.find({ user: user._id })
        .populate("user", "account status inviter")
        .populate("wallet", "address")
        .lean(),
      ActivityModel.find({ user: user._id }).lean(),
      WalletModel.find({ user: user._id }, { encryptedWalletKey: 0 }).lean(),
    ]).catch((err) => {
      res.status(500).json({
        success: false,
        message: "SERVER_ERROR",
        type: 2,
      });
    });

    try {
      // Set secure cookie
      res.cookie("auth_token", encryptedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: DEFAULT_CONNECTION_EXPIRATION,
        domain: process.env.COOKIE_DOMAIN || undefined,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: "AUTHENTICATION_FAILED",
        type: 101,
      });
    }

    return res.status(200).json({
      connect: true,
      user: {
        userData: {
          ...user,
        },
        orders,
        histories,
        wallets,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const join = async (req, res) => {
  const { account, signUpMethod, invitationCode, encryptedToken } = req.body;

  // Validate required parameters
  const validationError = validateParams({ signUpMethod, encryptedToken }, [
    "signUpMethod",
    "encryptedToken",
  ]);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  // Verify token
  const verificationResult = verifyToken(encryptedToken, account);
  if (!verificationResult.verified) {
    return res.status(401).json({
      success: false,
      message: verificationResult.message,
      type: verificationResult.type || null,
    });
  }

  try {
    // Check if user already exists
    const existingUser = await UserModel.findOne({
      account: { $regex: new RegExp(`^${account}$`, "i") },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "USER_ALREADY_EXISTS",
      });
    }

    let user = new UserModel({
      account,
    });

    // Check join requirements
    const verifyAndUpdate = await checkRequirements({
      method: signUpMethod,
      user,
      option: { invitationCode },
    }).catch((err) => {
      return res.status(403).json({
        success: false,
        message: "UNAUTHORIZED_USER",
        type: 88,
      });
    });

    if (!verifyAndUpdate.success) {
      return res.status(403).json({
        success: false,
        message: "UNAUTHORIZED_USER",
        type: 89,
        //details: verifyAndUpdate.error,
      });
    }

    // Create new user
    user.status = verifyAndUpdate.update.status;
    user.inviter = verifyAndUpdate.update.inviter;
    await user.save();

    // Generate wallets (fire and forget for better response time)
    generateWallet({
      user,
      previousWallets: [],
      evmWalletCounts: 3,
      svmWalletCounts: 2,
    }).catch((err) => {
      logger.error(
        `NEW_USER_WALLET_GENERATE_FAILED%userId:${user._id}%error:${err.message || JSON.stringify(err)}`,
      );
    });
    // Get wallets without sensitive data
    const wallets = await WalletModel.find(
      { user: user._id },
      { encryptedWalletKey: 0 },
    ).lean();

    try {
      // Set secure cookie
      res.cookie("auth_token", encryptedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: DEFAULT_CONNECTION_EXPIRATION,
        domain: process.env.COOKIE_DOMAIN || undefined,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: "AUTHENTICATION_FAILED",
        type: 101,
      });
    }

    return res.status(201).json({
      connect: true,
      user: {
        userData: {
          ...user.toObject(),
          //sensitiveInfo: undefined
        },
        orders: [],
        histories: [],
        wallets,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const disconnectUser = async (req, res) => {
  let user = req.user;
  res.cookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
  return res.status(200).json({ message: "DISCONNECTED" });
};

export const getEncryptedPrivateKey = async (req, res) => {
  const user = req.user;
  const { walletAddress } = req.query;

  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      message: "MISSING_PARAMS",
    });
  }

  try {
    // Verify wallet belongs to user
    const wallet = await WalletModel.findOne({
      address: { $regex: new RegExp(`^${walletAddress}$`, "i") },
      user: user._id,
    });

    if (!wallet) {
      return res.status(403).json({
        success: false,
        message: "WALLET_NOT_FOUND_OR_UNAUTHORIZED",
      });
    }

    const key = await encryptPrivateKeyForFrontend(wallet.encryptedWalletKey);

    return res.status(200).json({
      success: true,
      data: { key },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const createInvitationCode = async (req, res) => {
  try {
    const user = req.user;
    const { invitedTo, expireAt, status = "silver", maxUses = 1 } = req.body;
    const validationError = validateParams({ invitedTo }, ["invitedTo"]);
    if (validationError) {
      return res.status(400).json(validationError);
    }

    if (!isEVMAddress(invitedTo)) {
      return res.status(400).json({
        success: false,
        message: "INVALID_INVITATION_SENDER_ADDRESS",
        validStatuses,
      });
    }

    // Validate status
    const validStatuses = ["silver", "gold", "platinum"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "INVALID_STATUS",
      });
    }

    let invitedUser = await UserModel.findOne({
      account: { $regex: new RegExp(`^${invitedTo}$`, "i") },
    }).lean();

    if (invitedUser) {
      return res.status(500).json({
        success: false,
        message: "ALREADY_USER",
      });
    }
    // Set expiration date
    const expirationDate = expireAt
      ? expireAt
      : Date.now() + DEFAULT_INVITATION_EXPIRY;

    // Validate expiration is in the future
    if (typeof expirationDate != "number" || expirationDate <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "EXPIRATION_MUST_BE_FUTURE",
      });
    }

    const invitationCodeDetails = encodeInvitationCode({
      expireAt: expirationDate,
      metadata: {
        status,
        createdBy: user._id,
        to: invitedTo,
      },
    });

    let updatedUser = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $addToSet: { invitationCodes: invitationCodeDetails.invitationCode } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      data: {
        code: invitationCodeDetails.invitationCode,
        user: updatedUser,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const deleteInvitationCode = async (req, res) => {
  try {
    const user = req.user;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "MISSING_PARAMS",
      });
    }

    // Check if code exists
    const codeExists = user.invitationCodes?.some(
      (invCode) => invCode === code,
    );

    if (!codeExists) {
      return res.status(404).json({
        success: false,
        message: "CODE_NOT_FOUND",
      });
    }

    // Remove code
    const result = await UserModel.updateOne(
      { _id: user._id },
      { $pull: { invitationCodes: code } },
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({
        success: false,
        message: "REMOVE_FAILED",
      });
    }

    // logger.info("Invitation code deleted", { userId: user._id, code });

    return res.status(200).json({
      success: true,
      message: "INVITATION_CODE_DELETED",
    });
  } catch (err) {
    //console.log(err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const withdrawBalance = async (req, res) => {
  const user = req.user;
  const {
    receiver,
    tokenAddress,
    chainId,
    value,
    walletAddress,
    tokenDecimals,
    tokenSymbol,
  } = req.body;

  // Validate all required parameters
  const requiredParams = [
    "receiver",
    "tokenAddress",
    "chainId",
    "value",
    "walletAddress",
    "tokenDecimals",
    "tokenSymbol",
  ];

  const validationError = validateParams(req.body, requiredParams);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  // Validate value
  const numericValue = Number(value);
  if (isNaN(numericValue) || numericValue <= 0) {
    return res.status(400).json({
      success: false,
      message: "INVALID_AMOUNT",
    });
  }

  try {
    // Verify wallet belongs to user
    const walletData = await WalletModel.findOne({
      address: { $regex: new RegExp(`^${walletAddress}$`, "i") },
      user: user._id,
    });

    if (!walletData) {
      return res.status(403).json({
        success: false,
        message: "WALLET_NOT_FOUND_OR_UNAUTHORIZED",
      });
    }

    // Execute withdrawal
    const withdrawalResult = await withdraw({
      walletData,
      chainId,
      receiver,
      value: numericValue,
      tokenAddress,
      tokenSymbol,
      tokenDecimals,
      user,
    }).catch((err) => {
      return res.status(500).json({
        success: false,
        message: err.message.toLowerCase().includes("insufficient")
          ? "INSUFFICIENT_BALANCE"
          : "TRANSFER_FAILED",
        type: 1,
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        transactionHash: withdrawalResult.signature,
        message: "SUCESS",
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

export const createNewWallet = async (req, res) => {
  const user = req.user;
  const { evmWallets = 0, svmWallets = 0 } = req.body;

  // Validate input
  if (
    (evmWallets <= 0 && svmWallets <= 0) ||
    evmWallets < 0 ||
    svmWallets < 0
  ) {
    return res.status(400).json({
      success: false,
      message: "INVALID_WALLET_COUNT",
    });
  }
  // Get existing wallets
  const previousWallets = await WalletModel.find({ user: user._id }).catch(
    (err) => {
      return res.status(500).json({
        success: false,
        message: "SERVER_ERROR",
        type: 2,
      });
    },
  );

  try {
    // Generate new wallets
    generateWallet({
      user,
      previousWallets,
      evmWalletCounts: evmWallets,
      svmWalletCounts: svmWallets,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "WALLET_GENERATE_FAILED",
    });
  }

  let wallets = [];
  wallets = await WalletModel.find(
    { user: user._id },
    { encryptedWalletKey: 0 },
  )
    .lean()
    .catch((err) => {});

  return res.status(201).json({
    success: true,
    data: { wallets },
  });
};

export const addToken = async (req, res) => {
  const user = req.user;
  const { tokenAddress, chainId } = req.body;
  
  const validationError = validateParams({ tokenAddress, chainId }, [
    "tokenAddress",
    "chainId",
  ]);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  try {
    const tokenKey = `${tokenAddress}:${chainId}`;
    // Check if token already exists in user's asset list
    const isIncluded = user.assetes?.some(
      (asset) => asset.toLowerCase() === tokenKey.toLowerCase(),
    );

    if (isIncluded) {
      return res.status(200).json({
        success: false,
        message: "TOKEN_ALREADY_ADDED",
      });
    }

    if(user.status != 'admin'){
      let userStatusMaxAccessAsset = USER_LEVEL[user.status.toUpperCase()]?.benefits?.maxAccessAsset || 5;
      let totalAdded = user.assetes.length;
      if(totalAdded+1 > userStatusMaxAccessAsset){
        return res.status(200).json({
        success: false,
        message: "MAX_ACCED_ASSET_ACCESS",
      });
      }
    }

    // Add token to user's assets
    let updatedUser = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $addToSet: { assetes: tokenKey } },
      { new: true },
    );

    

    //logger.info("Token added to user assets", { userId: user._id, tokenKey });

    return res.status(200).json({
      success: true,
      message: "TOKEN_ADDED_SUCCESSFULLY",
      user: updatedUser
    });
  } catch (err) {
    //logger.error("Add token error", { error: err.message, userId: user._id, tokenAddress, chainId });
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};

// Optional: Add pagination for large datasets
export const getUserHistory = async (req, res) => {
  try {
    const user = req.user;
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const [histories, total] = await Promise.all([
      ActivityModel.find({ user: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityModel.countDocuments({ user: user._id }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        histories,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    //logger.error("Get user history error", { error: err.message, userId: req.user?._id });
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
      type: 1,
    });
  }
};
