import { chains } from "./chain.js";
import { ZeroAddress } from "ethers";


export const CollateralTokens = {
  [chains.Ethereum]:{
    [ZeroAddress]: {
      address: ZeroAddress,
      name: "ETHERIUM",
      symbol: "ETH",
      decimals: 18,
      isNative:true,
      chainId: chains.Ethereum
    },
    ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"]:{
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      name: "WRAPPED ETHERIUM",
      symbol: "WETH",
      decimals: 18,
      isWrappedNative: true,
      chainId: chains.Ethereum
    },
    ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48']:{
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      name: "USDc",
      symbol: "USDc",
      decimals: 6,
      isStable: true,
      chainId: chains.Ethereum
    }
  },
  [chains.Solana]:{
    [ZeroAddress]: {
      address: ZeroAddress,
      name: "SOLANA",
      symbol: "SOL",
      decimals: 9,
      isNative: true,
      chainId: chains.Solana
    },
    ['so11111111111111111111111111111111111111112']: {
      address: 'So11111111111111111111111111111111111111112',
      name: "WRAPPED SOLANA",
      symbol: "WSOL",
      decimals: 9,
      isWrappedNative: true,
      chainId: chains.Solana
    },
    ['epjfWdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v']:{
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: "USDc",
      symbol: "USDc",
      decimals: 6,
      isStable: true,
      chainId: chains.Solana
    }
  },
  [chains.Arbitrum]:{
    [ZeroAddress]: {
      address: ZeroAddress,
      name: "AVALANCHE",
      symbol: "AVAX",
      decimals: 18,
      isNative:true,
      chainId: chains.Arbitrum
    },
    ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1']:{
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      name: "WRAPPED ETHERIUM",
      symbol: "WETH",
      decimals: 18,
      isWrappedNative: true,
      chainId: chains.Arbitrum
    },
    ['0xaf88d065e77c8cc2239327C5edb3a432268e5831']:{
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      name: "USDc",
      symbol: "USDc",
      decimals: 6,
      isStable: true,
      chainId: chains.Arbitrum
    }
  },
  [chains.Avalanche]:{
    [ZeroAddress]: {
      address: ZeroAddress,
      name: "AVALANCHE",
      symbol: "AVAX",
      decimals: 18,
      isNative: true,
      chainId: chains.Avalanche
    },
    ['0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7']: {
      address: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
      name: "Wrapped AVAX",
      symbol: "WAVAX",
      decimals: 18,
      isWrappedNative: true,
      chainId: chains.Avalanche
    },
    ["0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e"]: {
      name: "USD Coin",
      symbol: "USDC",
      address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      decimals: 6,
      isStable: true,
      chainId: chains.Avalanche
    },
  }
}

 