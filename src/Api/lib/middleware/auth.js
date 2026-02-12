import UserModel from "../../model/user.js";
import { decodeText, decryptAuthToken } from "../crypto/encryption.js";
import { verifyMessage } from "ethers";
import { SIGN_MESSAGE } from "../../constant/common/user.js";
import "dotenv/config";
import logger from "../../logger.js"; // Assuming you have a logger utility

const FRONTEND_AUTH_SECURITY = process.env.FRONT_END_AUTH_TOKEN_SECURITY_PASSWORD;

// Validate environment variable on startup
if (!FRONTEND_AUTH_SECURITY) {
  logger.error("FRONT_END_AUTH_TOKEN_SECURITY_PASSWORD environment variable is not set");
  // In production, you might want to throw an error or exit
}

/**
 * Extracts and verifies address from auth token
 * @param {string} authToken - Encrypted authentication token
 * @returns {Object} - {address: string|null, error: string|null, type: number|null}
 */
export const extractAddressFromToken = (authToken) => {
  if (!FRONTEND_AUTH_SECURITY) {
    logger.error("Authentication security password not configured");
    return { address: null, message: "SERVER_ERROR", type: 99 };
  }

  try {
    const decryptedText = decryptAuthToken(authToken, FRONTEND_AUTH_SECURITY);
    // const decoded = JSON.parse(decodeText(decryptedText));
    // console.log(decoded)
    // // Validate token expiration
    // if (decoded.expireAt <= Date.now()) {
    //   return { address: null, error: "TOKEN_EXPIRED", type: null };
    // }
    
    // Verify signature
    const address = verifyMessage(SIGN_MESSAGE, decryptedText);
    if (!address) {
      return { address: null, message: "INVALID_SIGNATURE", type: 2 };
    }
    
    return { address: address.toLowerCase(), message: null, type: null };
  } catch (error) {
    return { address: null, message: "INVALID_TOKEN", type: 3 };
  }
};

export const verifyToken = (authToken, account) => {
  if (!authToken || !account) {
    return { verified: false, message: "MISSING_PARAMS", type: 1 };
  }

  const { address, message, type } = extractAddressFromToken(authToken);
  
  if (message) {
    return { verified: false, message, type };
  }
  
  if (address !== account.toLowerCase()) {
    return { verified: false, message: "INVALID_ACCOUNT", type: 4 };
  }
  
  return { verified: true, address };
};

export const getUser = async (req, res, next) => {
  try {
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(401).json({ message: "TOKEN_NOT_FOUND" });
    }

    const { address, message, type } = extractAddressFromToken(token);
    
    if (message) {
      const statusMap = {
        "TOKEN_EXPIRED": 401,
        "INVALID_TOKEN": 401,
        "INVALID_SIGNATURE": 401,
        "SERVER_ERROR": 500
      };
      
      return res.status(statusMap[message] || 401).json({ 
        message: message || "AUTHENTICATION_ERROR", 
        type: type || 0
      });
    }

    // Find user with case-insensitive match
    const user = await UserModel.findOne({
      account: { $regex: new RegExp(`^${address}$`, 'i') }
    }).lean();

    if (!user) {
      return res.status(401).json({ message: "USER_NOT_FOUND" });
    }

    // Attach user to request
    req.user = user;
    req.user.account = address; // Ensure consistent casing
    next();
  } catch (error) {
    return res.status(500).json({ message: "SERVER_ERROR", type: 5 });
  }
};

export const joinUser = async (req, res, next) => {
  try {
    const token = req.cookies?.auth_token;
    if (!token) {
      return res.status(401).json({ message: "TOKEN_NOT_FOUND" });
    }
    console.log(token)

    const { address, error, type } = extractAddressFromToken(token);
    
    if (error) {
      const statusMap = {
        "TOKEN_EXPIRED": 401,
        "INVALID_TOKEN": 401,
        "INVALID_SIGNATURE": 401,
        "SERVER_ERROR": 500
      };
      
      return res.status(statusMap[error] || 401).json({ 
        message: "AUTHENTICATION_ERROR", 
        error: error,
        type: type 
      });
    }

    req.account = address;
    next();
  } catch (error) {
    logger.error("Join user middleware error", { error: error.message, stack: error.stack });
    return res.status(500).json({ message: "SERVER_ERROR", type: 4 });
  }
};

