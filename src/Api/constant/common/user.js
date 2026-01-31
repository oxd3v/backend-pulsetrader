export const USER_LEVEL = {
  ['SILVER']: {
    id: "silver",
    benefits: {
      maxOrder: 20,
      maxWallets: 5,
      maxEVMWallets: 3,
      maxSVMWallets:2,
      maxAccessAsset: 5,
      supportTrading: ["spot"],
      supportStrategy: ["limit", "scalp"],
    },
    requireMents: {
      ['GLADIATOR_STAKE_43114']: {
        quantity: "10000000",
      }
    }
  },
  ['GOLD']: {
    id: "gold",
    benefits: {
      maxOrder: 50,
      maxWallets: 7,
      maxEVMWallets: 4,
      maxSVMWallets:3,
      maxAccessAsset: 10,
      supportTrading: ["spot", "perpetual"],
      supportStrategy: ["limit", "scalp", "grid", "dca"],
    },
    requireMents: {
      ['GLADIATOR_STAKE_43114']: {
        quantity: "50000000",
      }
    }
  },
  ['PLATINUM']: {
    id: "platinum",
    benefits: {
      maxOrder: 100,
      maxWallets: 10,
      maxEVMWallets: 6,
      maxSVMWallets:4,
      maxAccessAsset: 50,
      supportTrading: ["spot", "perpetual"],
      supportStrategy: ["limit", "scalp", "grid", "dca", "sellToken"],
    },
    requireMents: {
      ['GLADIATOR_STAKE_43114']: {
        quantity: "100000000",
      }
    }
  },
  ['DIAMOND']: {
    id: "diamond",
    benefits: {
      maxOrder: "Unlimited",
      maxWallets: 20,
      maxEVMWallets: 12,
      maxSVMWallets: 8,
      maxAccessAsset: 100,
      supportTrading: ["spot", "perpetual"],
      supportStrategy: ["limit", "scalp", "grid", "dca", "sellToken", "algo"],
    },
    requireMents: {
      ['GLADIATOR_STAKE_43114']: {
        quantity: "500000000",
      }
    }
  },
};

export const userDeafultTokens = [
  '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7:43114','0x152b9d0fdc40c096757f570a51e494bd4b943e50:43114', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2:1', 'So11111111111111111111111111111111111111112:1399811149', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1:42161'
]

export const DEFAULT_INVITATION_EXPIRY = 604800000;

export const PULSETRADER_URL = "pulsetrader.net";

export const SIGN_MESSAGE = `${PULSETRADER_URL} wants you to sign in. 
Connect your wallet to PulseTrader and start trading.

URI: https://${PULSETRADER_URL}
Version: 1`;

export const DEFAULT_INVITER_ID = ''