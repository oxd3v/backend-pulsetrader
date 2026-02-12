import { chains } from "./chain.js";

export const PRECISION_DECIMALS = 30;
export const BASIS_POINT_DIVISOR = 10000;
export const BASIS_POINT_DIVISOR_BIGINT = 10000n;
export const TOKEN_LISTENING_INTERVAL = 300000; // 5 min

export const ACCUMULATE_STRATEGY = ['grid', 'dca'];
export const DEFAULT_TAKE_PROFIT_PERCENTAGE = 1000;
export const DEFAULT_STOP_LOSS_PERCENTAGE = 3000;
export const MINIMUM_CANDLE_DATA_FOR_ANALYZING = 30;
export const TECHNICAL_ANALYSIS_RESOLUTION_CONFIG = {
    // Direct access - no conversion needed
    '1': { base: '1', multiplier: 1 },
    '60': { base: '60', multiplier: 1 },
    
    // Short timeframes - convert from 1-minute
    '5': { base: '1', multiplier: 5 },
    '15': { base: '1', multiplier: 15 },
    '30': { base: '1', multiplier: 30 },
    
    // Medium timeframes - convert from 60-minute
    '120': { base: '60', multiplier: 2 },   // 2 hours
    '240': { base: '60', multiplier: 4 },   // 4 hours
    '360': { base: '60', multiplier: 6 },   // 6 hours
    '480': { base: '60', multiplier: 8 },   // 8 hours
    '720': { base: '60', multiplier: 12 },  // 12 hours
    
    // Daily and above - convert from 60-minute
    '1440': { base: '60', multiplier: 24 }, // 1 day
};

export const INDICATORS_KEY = [
  { id: "RSI", name: "RSI", indicatorName: 'Relative Strength Index', type: "Momentum", defaultPeriod: 14 },
  { id: "WilliamsR", name: "WilliamsR", indicatorName: 'Williams %R', type: "Momentum", defaultPeriod: 14 },
  { id: "CCI", name: "CCI", indicatorName: 'Commodity Channel Index', type: "Momentum", defaultPeriod: 20 },
  { id: "MFI", name: "MFI", indicatorName: 'Money Flow Index', type: "Momentum", defaultPeriod: 14 },
  { id: "MACD", name: "MACD", indicatorName: 'Moving Average Convergence Divergence', type: "Trend" },
  { id: "SMA", name: "SMA", indicatorName: 'Moving Average', type: "Trend", defaultPeriod: 9 },
  { id: "EMA", name: "EMA", indicatorName: 'Moving Average Exponential', type: "Trend", defaultPeriod: 9 },
  { id: "BollingerBands.Upper", name: "BollingerBands-Upper", indicatorName: "Bollinger Bands", type: "Volatility", defaultPeriod: 20 },
  { id: "Volume.Signal", name: "Volume-Signal", indicatorName: "Volume", type: "Volume" },
  { id: "Price", name: "Price", type: "Price" },
  { id: "Liquidity", name: "Liquidity", type: "Market" },
  { id: "Holders", name: "Holders", type: "Market" }
];

export const  DEFAULT_GAS_PRICE = {
  [chains.Avalanche]: BigInt(2000000000),
  [chains.Ethereum]: BigInt(1000000000),
  [chains.Solana]: BigInt(10000000),
  [chains.Arbitrum]: BigInt(90000000),
}

export const GAS_LIMIT = {
  ["PERPETUAL"]: {
    ["GMX"]: {
      increaseOrderGasLimit: BigInt(6000000),
      decreaseOrderGasLimit: BigInt(7000000),
    },
  },  
  ["SPOT"]: {
    [chains.Avalanche]: BigInt(5500000), // with transfer gas limit
    [chains.Solana]: BigInt(350000), // with transfer gas limit
    [chains.Ethereum]: BigInt(1500000), // with transfer gas limit
    [chains.Arbitrum]: BigInt(2500000), // with transfer gas limit
  },
};

export const GAS_BUFFER = {
  [chains.Avalanche]: 50000,
  [chains.Ethereum]: 20000,
  [chains.Solana]: 50000,
  [chains.Arbitrum]: 40000,
};

export const ORDER_TRADE_FEE_EXEMPT_STATUS = Object.freeze(['admin'])

export const EVM_AGGREGATORS = Object.freeze([
  "okx",
  "joe",
  "flytrade",
  "odos",
  "kyber",
]);
export const SOLANA_AGGREGATORS = Object.freeze(["okx", "jupiter"]);
export const SOLANA_BASE_FEE = 5000n;
export const DEFAULT_SOLANA_PRIORITY_FEE = 50_000n
export const ORDER_TRADE_FEE = 10n; // 0.1%
export const ORDER_PRIORITY_FEE = 10n; // 0.1%
export const SOLANA_ORDER_TRADE_FEE_COLLECTOR = 'BLvk55ch6uWM2j9YUX9pUfmfbuA8CWdXuDMZ3og3J4RN';
export const EVM_ORDER_TRADE_FEE_COLLECTOR = '0xfe7AB0137C85c9f05d03d69a35865277EA64DEba';
export const ORDER_GAS_BUFFER = 15000n;
export const ORDER_AGGREGATOR_SWAP_RESULT_FETCHING_TIMEOUT = 10000;
export const MINIMUM_COLLATERAL_USD = 10n**BigInt(PRECISION_DECIMALS);

