import { isAddress, isError } from "ethers";
import mongoose from "mongoose";
import axios from "axios";

export const ErrorTypes = {
  VALIDATION: "VALIDATION_ERROR:false",
  NETWORK: "NETWORK_ERROR:true",
  TRANSACTION: "TRANSACTION_ERROR:false",
  TIMEOUT: "TIMEOUT_ERROR:true",
  UNKNOWN: "UNKNOWN_ERROR:false",
  SYSTEM: "SYSTEM_ERROR:false",
  DATABASE: "DATABASE_ERROR:true",
  USER_REJECTION: "USER_REJECTION_ERROR:false",
};

class CustomError extends Error {
  constructor(message, type = ErrorTypes.UNKNOWN, shouldContinue = false) {
    super(
      JSON.stringify({
        message,
        type,
        shouldContinue,
      }),
    );
    this.name = "CustomError";
  }
}

export function throwError({
  message,
  shouldContinue = false,
  type = ErrorTypes.UNKNOWN,
}) {
  throw new CustomError(message, type, shouldContinue);
}


export function handleError(err) {
  let errorObj;

  if (typeof err === "string") {
    errorObj = { message: err };
  } else if (err instanceof Error) {
    try {
      errorObj = JSON.parse(err.message);
    } catch {
      errorObj = { message: err.message };
    }
  } else {
    errorObj = { message: String(err) };
  }

  // Ensure default values
  errorObj.type = errorObj.type || ErrorTypes.UNKNOWN;
  errorObj.shouldContinue =
    errorObj.shouldContinue || errorObj.type?.split(":")[1] == "true" || false;

  // Classify error if type is unknown
  if (errorObj.type === ErrorTypes.UNKNOWN) {
    const lowerMsg = errorObj.message.toLowerCase();
    if (
      lowerMsg.includes("network") ||
      lowerMsg.includes("connection") ||
      lowerMsg.includes("timeout")
    ) {
      errorObj.type = ErrorTypes.NETWORK;
    } else if (
      lowerMsg.includes("validation") ||
      lowerMsg.includes("invalid")
    ) {
      errorObj.type = ErrorTypes.VALIDATION;
    } else if (
      lowerMsg.includes("transaction") ||
      lowerMsg.includes("gas") ||
      lowerMsg.includes("fee")
    ) {
      errorObj.type = ErrorTypes.TRANSACTION;
    }
  }

  return errorObj;
}

export const handleMongoDBError = async (err) => {
  const RETRYABLE_CODES = new Set([
    6, 7, 89, 91, 9001, 10107, 13475, 11600, 11602,
  ]);

  const NON_RETRYABLE_CODES = new Set([
    11000, 11001, 121, 2, 8, 14, 20, 13, 211,
  ]);

  const CUSTOM_ERROR_MESSAGES = {
    11000: "Duplicate entry found. This record already exists.",
    11001: "Duplicate entry found. This record already exists.",
    VALIDATION_ERROR: "Invalid input data. Please check your submission.",
    CAST_ERROR: "Invalid data format provided.",
    DOCUMENT_NOT_FOUND: "Requested resource not found.",
    VERSION_ERROR: "Resource modified by another request. Please try again.",
  };

  const getErrorCode = (error) => error.code || error.error?.code || "N/A";

  if (err instanceof mongoose.Error) {
    switch (err.name) {
      case "ValidationError":
        return {
          message: CUSTOM_ERROR_MESSAGES.VALIDATION_ERROR,
          shouldContinue: false,
          type: ErrorTypes.VALIDATION,
          details: Object.values(err.errors).map((e) => ({
            field: e.path,
            message: e.message,
          })),
        };
      case "CastError":
        return {
          message: CUSTOM_ERROR_MESSAGES.CAST_ERROR,
          shouldContinue: false,
          type: ErrorTypes.VALIDATION,
          details: { field: err.path, value: err.value },
          isBaseError: true,
        };
      case "DocumentNotFoundError":
        return {
          message: CUSTOM_ERROR_MESSAGES.DOCUMENT_NOT_FOUND,
          shouldContinue: false,
          type: ErrorTypes.DATABASE,
          details: null,
          isBaseError: true,
        };
      case "VersionError":
        return {
          message: CUSTOM_ERROR_MESSAGES.VERSION_ERROR,
          shouldContinue: false,
          type: ErrorTypes.DATABASE,
          isBaseError: true,
        };
      default:
        return {
          message: "Unexpected MongoDB error occurred.",
          shouldContinue: false,
          type: ErrorTypes.DATABASE,
          code: getErrorCode(err),
          isBaseError: true,
        };
    }
  }

  const errorCode = getErrorCode(err);
  if (RETRYABLE_CODES.has(errorCode)) {
    return {
      message: "Temporary database issue. Retrying operation.",
      shouldContinue: true,
      type: ErrorTypes.NETWORK,
      code: errorCode,
      isBaseError: true,
    };
  }

  if (NON_RETRYABLE_CODES.has(errorCode)) {
    return {
      message: CUSTOM_ERROR_MESSAGES[errorCode] || err.message,
      shouldContinue: false,
      type: ErrorTypes.DATABASE,
      code: errorCode,
      isBaseError: true,
    };
  }

  let errData = handleError(err);
  if (errData.message && errData.shouldContinue) {
    return {
      ...errData,
      type: errData.type || ErrorTypes.DATABASE,
      isBaseError: false,
    };
  }

  return {
    message: "Unexpected MongoDB error occurred.",
    shouldContinue: false,
    type: ErrorTypes.UNKNOWN,
    details: { code: errorCode },
    isBaseError: false,
  };
};

export function handleEthersJsError(err) {
  const PERMANENT_ERRORS = new Set([
    "INSUFFICIENT_FUNDS",
    "NONCE_EXPIRED",
    "BAD_DATA",
    "INVALID_ARGUMENT",
    "UNCONFIGURED_NAME",
    "CALL_EXCEPTION",
    "TRANSACTION_REPLACED",
    "ACTION_REJECTED",
  ]);

  const RETRYABLE_ERRORS = new Set([
    "TIMEOUT",
    "NETWORK_ERROR",
    "SERVER_ERROR",
    "UNPREDICTABLE_GAS_LIMIT",
  ]);

  const CUSTOM_ERROR_MESSAGES = {
    INSUFFICIENT_FUNDS: "Insufficient funds for transaction.",
    ACTION_REJECTED: "Transaction rejected by user.",
    INVALID_ARGUMENT: "Invalid data provided.",
    NETWORK_ERROR: "Temporary network issue. Please try again.",
    TIMEOUT: "Request timed out. Please try again.",
    CALL_EXCEPTION: "Transaction reverted. Check contract inputs.",
    TRANSACTION_REPLACED: "Transaction replaced by another.",
    UNPREDICTABLE_GAS_LIMIT:
      "Gas limit estimation failed. Try setting manually.",
  };

  if (isError(err, err.code) && err?.code && typeof err === "object") {
    const code = err.code;
    const shouldContinue = RETRYABLE_ERRORS.has(code);
    const type = shouldContinue
      ? ErrorTypes.NETWORK
      : PERMANENT_ERRORS.has(code)
        ? ErrorTypes.TRANSACTION
        : code === "ACTION_REJECTED"
          ? ErrorTypes.USER_REJECTION
          : ErrorTypes.UNKNOWN;

    return {
      message: CUSTOM_ERROR_MESSAGES[code] || err.message,
      shouldContinue,
      type,
      code,
      isBaseError: true,
    };
  }

  let errData = handleError(err);
  if (errData.message && errData.shouldContinue) {
    return {
      ...errData,
      type: errData.type || ErrorTypes.UNKNOWN,
      isBaseError: false,
    };
  }
  return {
    message: err?.message || "Unexpected Ethers.js error.",
    shouldContinue: false,
    type: ErrorTypes.UNKNOWN,
    code: "UNKNOWN_ERROR",
    isBaseError: false,
  };
}

export function handleSolanaWeb3Error(err) {
    const RETRYABLE_ERRORS = new Set([
        'BlockhashNotFound',
        'Network request failed',
        'TimeoutError',
        'Server error',
        'Service unavailable'
    ]);

    // Known error codes from Solana RPC (Server-side)
    const RETRYABLE_CODES = new Set([
        500, 502, 503, 504, 429
    ]);

    const PERMANENT_ERRORS = new Set([
        'AccountNotFound',
        'SignatureVerificationError',
        'InstructionError',
        'InsufficientFunds',
        'AlreadyProcessed',
        'SlippageToleranceExceeded'
    ]);

    // Detect Simulation Errors (often hidden in logs)
    const isSimulationError = (msg) => msg && msg.includes('Transaction simulation failed');
    
    // Attempt to extract useful message
    let message = err?.message || 'Unknown Solana Error';
    let logs = err?.logs || [];
    let code = err?.code;

    // Handle "SendTransactionError" (Common in web3.js)
    if (err.name === 'SendTransactionError' || isSimulationError(message)) {
        // Try to find the specific instruction error in logs
        if (logs.length > 0) {
            // The last log usually contains the actual failure reason
            const failureLog = logs.find(l => l.includes('Error:') || l.includes('failed:'));
            message = failureLog ? `Simulation failed: ${failureLog}` : `Transaction simulation failed`;
            
            // Check specifically for Blockhash not found in logs (it happens)
            if (logs.some(l => l.includes('Blockhash not found'))) {
                return {
                    message: 'Blockhash expired or not found. Retrying...',
                    shouldContinue: true,
                    type: ErrorTypes.NETWORK,
                    code: 'BLOCKHASH_NOT_FOUND',
                    isBaseError: true
                };
            }
        } else if (message.includes('Blockhash not found')) {
             return {
                message: 'Blockhash expired. Retrying...',
                shouldContinue: true,
                type: ErrorTypes.NETWORK,
                code: 'BLOCKHASH_NOT_FOUND',
                isBaseError: true
            };
        }

        return {
            message: message,
            shouldContinue: false, // Simulation failures are usually permanent logic errors (slippage, funds)
            type: ErrorTypes.TRANSACTION,
            code: 'SIMULATION_FAILED',
            details: logs,
            isBaseError: true
        };
    }

    // Handle User Rejection
    if (err.name === 'WalletSignTransactionError' || message.includes('User rejected')) {
        return {
            message: 'User rejected the transaction.',
            shouldContinue: false,
            type: ErrorTypes.USER_REJECTION,
            code: 'ACTION_REJECTED',
            isBaseError: true
        };
    }

    // Handle Network/Retryable Errors
    if (RETRYABLE_ERRORS.has(err.name) || RETRYABLE_CODES.has(code) || message.includes('429')) {
        return {
            message: 'Solana network congestion or timeout. Retrying...',
            shouldContinue: true,
            type: ErrorTypes.NETWORK,
            code: 'NETWORK_ERROR',
            isBaseError: true
        };
    }

    // Standard Error Handling fallback
    let errData = handleError(err);
    if (errData.message && errData.shouldContinue) {
        return {
            ...errData,
            type: errData.type || ErrorTypes.UNKNOWN,
            isBaseError: false
        };
    }

    return {
        message: message,
        shouldContinue: false,
        type: ErrorTypes.UNKNOWN,
        code: 'UNKNOWN_SOLANA_ERROR',
        isBaseError: false
    };
}

export function handleAxiosError(err) {
  const PERMANENT_STATUS_CODES = new Set([
    400, 401, 403, 404, 405, 406, 409, 410, 415, 422,
  ]);
  const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

  const CUSTOM_ERROR_MESSAGES = {
    400: "Invalid request. Please check your data.",
    401: "Authentication failed. Please log in again.",
    403: "Permission denied.",
    404: "Resource not found.",
    409: "Data conflict detected.",
    429: "Too many requests. Please try again later.",
    500: "Server error occurred. Please try again.",
    503: "Service temporarily unavailable.",
    DEFAULT_NETWORK_ERROR:
      "Network connection issue. Please check your internet.",
    DEFAULT_CLIENT_ERROR: "Request error. Please check your input.",
  };

  if (axios.isAxiosError(err)) {
    if (err.response) {
      const statusCode = err.response.status;
      const shouldContinue = RETRYABLE_STATUS_CODES.has(statusCode);
      const type = shouldContinue
        ? ErrorTypes.NETWORK
        : PERMANENT_STATUS_CODES.has(statusCode)
          ? ErrorTypes.VALIDATION
          : ErrorTypes.UNKNOWN;

      return {
        message: CUSTOM_ERROR_MESSAGES[statusCode] || err.message,
        shouldContinue,
        type,
        code: statusCode,
        originalError: err,
        isBaseError: true,
      };
    }

    if (err.request) {
      return {
        message: CUSTOM_ERROR_MESSAGES.DEFAULT_NETWORK_ERROR,
        shouldContinue: true,
        type: ErrorTypes.NETWORK,
        code: "NETWORK_ERROR",
        isBaseError: true,
      };
    }
  }
  let errData = handleError(err);
  if (errData.message && errData.shouldContinue) {
    return {
      ...errData,
      type: errData.type || ErrorTypes.UNKNOWN,
      isBaseError: false,
    };
  }
  return {
    message: err?.message || "Unexpected Axios error.",
    shouldContinue: false,
    type: ErrorTypes.UNKNOWN,
    code: "UNKNOWN_ERROR",
    isBaseError: false,
  };
}

export const simpleRetryFn = async ({ fn, retry = 3 }) => {
  let initialDelay = 1000; // 1 second
  let factor = 2;
  let maxDelay = 3000; // 3 seconds
  let cycle = 0;

  while (cycle < retry) {
    try {
      cycle++;
      // IMPORTANT: must await the function so the catch block triggers on failure
      return await fn(); 
    } catch (err) {
      // If this was the last attempt, throw the error to the caller
      if (cycle >= retry) {
        throw err; 
      }

      // Calculate exponential delay: 1s, 2s, 4s, 8s...
      const delay = Math.min(
        initialDelay * Math.pow(factor, cycle - 1),
        maxDelay
      );
      
      // Add 20% random jitter
      const jitter = delay * 0.2 * Math.random();
      const totalWait = delay + jitter;

      await new Promise((resolve) => setTimeout(resolve, totalWait));
    }
  }
};
