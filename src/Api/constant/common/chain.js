import { ethers } from "ethers";
import { Connection } from "@solana/web3.js";

export const chains = {
  Avalanche: 43114,
  Arbitrum: 42161,
  Ethereum: 1,
  Solana: 1399811149,
};

export const chainConfig = {
  [chains.Ethereum]: {
    rpcUrls: ["https://ethereum-rpc.publicnode.com"],
    explorerUrl: "https://etherscan.io",
    chainId: 1,
    name: "ETHEREUM",
    symbol: "ETH",
    nativeToken: {
      name: "WETH",
      decimals: 18,
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
    isPerpetual: true,
    isActive: true,
  },
  [chains.Avalanche]: {
    rpcUrls: [
      "https://api.avax.network/ext/bc/C/rpc",
      "https://avalanche-c-chain-rpc.publicnode.com",
    ],
    explorerUrl: "https://snowscan.xyz",
    chainId: 43114,
    name: "AVALANCHE",
    symbol: "AVAX",
    nativeToken: {
      name: "WAVAX",
      decimals: 18,
      address: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
    },
    isPerpetual: false,
    isActive: true,
  },
  [chains.Arbitrum]: {
    rpcUrls: [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one-rpc.publicnode.com",
    ],
    explorerUrl: "https://arbiscan.io/",
    chainId: 42161,
    name: "ARBITRUM",
    symbol: "ETH",
    nativeToken: {
      name: "WETH",
      decimals: 18,
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    },
    isPerpetual: false,
    isActive: true,
  },
  [chains.Solana]: {
    rpcUrls: [
      "https://solana.drpc.org",
      //"https://solana-rpc.publicnode.com",
      //"https://rpc.ankr.com/solana",
      //https://solana.api.pocket.network/,
      //https://solana.api.onfinality.io/public,
      //https://public.rpc.solanavibestation.com/,
      //https://solana-mainnet.gateway.tatum.io,
      //https://solana.lavenderfive.com
    ],
    explorerUrl: "https://explorer.solana.com/",
    chainId: 1399811149,
    name: "SOLANA",
    symbol: "SOL",
    nativeToken: {
      name: "WSOL",
      decimals: 9,
      address: "So11111111111111111111111111111111111111112",
    },
    isPerpetual: false,
    isActive: true,
  },
};

export const DEFAULT_GAS_RANGE = {
  [chains.Avalanche]: BigInt(2000000000000000),
  [chains.Ethereum]: BigInt(10000000000000),
  [chains.Solana]: BigInt(10000000),
  [chains.Arbitrum]: BigInt(40000000000000),
};

export const isValidChain = (chainId) => {
  return chainConfig[chainId].isActive === true;
};

export const gtValidNetworkIdentifiers = ["avax", "arbitrum", "eth", "solana"];

const connectionCache = new Map();

export const getConnectionProvider = (chainId) => {
  try {
    // Validate chain ID
    if (!Object.values(chains).includes(chainId)) {
      //console.error(`Invalid chain ID: ${chainId}`);
      throw new Error(`Invalid chain ID: ${chainId}`);
    }

    // Check cache first
    const cacheKey = `chain_${chainId}`;
    if (connectionCache.has(cacheKey)) {
      return connectionCache.get(cacheKey);
    }

    let connection;

    if (chainId === chains.Solana) {
      // Get Solana connection
      const rpcUrls = chainConfig[chainId].rpcUrls;
      if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error(`No RPC URLs available for chain ID: ${chainId}`);
      }

      // Try multiple RPC URLs if the first one fails
      let connectionError;
      for (let i = 0; i < rpcUrls.length; i++) {
        try {
          connection = new Connection(rpcUrls[i], "confirmed");
          // Test connection
          connection.getVersion().catch((e) => {
            throw e;
          });
          break;
        } catch (error) {
          connectionError = error;
          console.warn(
            `Failed to connect to Solana RPC ${rpcUrls[i]}: ${error.message}`,
          );
          continue;
        }
      }

      if (!connection) {
        throw (
          connectionError || new Error("Failed to connect to any Solana RPC")
        );
      }
    } else {
      // Get EVM connection
      const rpcUrls = chainConfig[chainId].rpcUrls;
      if (!rpcUrls || rpcUrls.length === 0) {
        throw new Error(`No RPC URLs available for chain ID: ${chainId}`);
      }

      // Shuffle RPC URLs for load balancing
      const shuffledUrls = [...rpcUrls].sort(() => 0.5 - Math.random());

      // Try multiple RPC URLs if the first one fails
      let connectionError;
      for (let i = 0; i < shuffledUrls.length; i++) {
        try {
          connection = new ethers.JsonRpcProvider(shuffledUrls[i]);
          // Test connection
          connection.getNetwork().catch((e) => {
            throw e;
          });
          break;
        } catch (error) {
          connectionError = error;
          console.warn(
            `Failed to connect to RPC ${shuffledUrls[i]}: ${error.message}`,
          );
          continue;
        }
      }

      if (!connection) {
        throw (
          connectionError ||
          new Error(`Failed to connect to any RPC for chain ID: ${chainId}`)
        );
      }
    }

    // Cache the connection
    connectionCache.set(cacheKey, connection);
    return connection;
  } catch (error) {
    console.error(
      `Error getting connection provider for chain ${chainId}:`,
      error,
    );
    throw error;
  }
};
