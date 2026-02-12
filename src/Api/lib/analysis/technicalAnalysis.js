import { RSI, Stochastic, WilliamsR, BollingerBands, CCI, MFI, MACD, ADX, SMA, EMA, ATR, OBV } from "technicalindicators";
import { convertCandlesResolution } from "./candleConverter.js";
import {
  TECHNICAL_ANALYSIS_RESOLUTION_CONFIG,
  MINIMUM_CANDLE_DATA_FOR_ANALYZING,
  INDICATORS_KEY
} from "../../../Api/constant/common/order.js";


// Helper to find default periods
const getIndicatorMeta = (id) => INDICATORS_KEY.find(k => k.id === id || id.startsWith(k.id));

class LRUCache {
  constructor(limit = 100) {
    this.limit = limit;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.limit) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() { this.cache.clear(); }
  get size() { return this.cache.size; }
}

const resolutionCache = new LRUCache(100);
const indicatorCache = new LRUCache(500); // Increased limit for complex strategies


function convertResolution(sourceCandles, multiplier) {
  if (multiplier === 1) return sourceCandles;

  const lastTime = sourceCandles.times[sourceCandles.times.length - 1];
  const cacheKey = `${sourceCandles.times[0]}-${lastTime}-${multiplier}`;

  const cached = resolutionCache.get(cacheKey);
  if (cached) return cached;

  const aggregated = convertCandlesResolution(sourceCandles, multiplier);
  resolutionCache.set(cacheKey, aggregated);
  return aggregated;
}

function calculateIndicator(indicatorName, candles, period, tokenData = null) {
  if (!candles || !candles.closes || candles.closes.length === 0) return null;

  // Use provided period or fallback to metadata default
  const meta = getIndicatorMeta(indicatorName);
  const finalPeriod = period || (meta ? meta.defaultPeriod : 14);

  const minDataPoints = Math.max(finalPeriod + 2, MINIMUM_CANDLE_DATA_FOR_ANALYZING);
  if (candles.closes.length < minDataPoints) return null;

  const lastTime = candles.times[candles.times.length - 1];
  const cacheKey = `${indicatorName}-${finalPeriod}-${lastTime}-${candles.closes.length}`;

  const cached = indicatorCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result = null;
  const input = {
    values: candles.closes,
    high: candles.highs,
    low: candles.lows,
    close: candles.closes,
    volume: candles.volumes,
    period: finalPeriod
  };

  try {
    switch (indicatorName) {
      case "RSI": result = RSI.calculate(input).pop(); break;
      case "WilliamsR": result = WilliamsR.calculate(input).pop(); break;
      case "CCI": result = CCI.calculate(input).pop(); break;
      case "MFI": result = MFI.calculate(input).pop(); break;
      case "SMA": result = SMA.calculate(input).pop(); break;
      case "EMA": result = EMA.calculate(input).pop(); break;
      
      case "MACD":
      case "MACD.Line": {
        const res = MACD.calculate({...input, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9}).pop();
        result = indicatorName === "MACD.Line" ? res?.MACD : res?.MACD; // Default to line
        break;
      }
      case "MACD.Signal": result = MACD.calculate({...input, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9}).pop()?.signal; break;
      case "MACD.Histogram": result = MACD.calculate({...input, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9}).pop()?.histogram; break;

      case "BollingerBands.Upper": result = BollingerBands.calculate({...input, stdDev: 2}).pop()?.upper; break;
      case "BollingerBands.Middle": result = BollingerBands.calculate({...input, stdDev: 2}).pop()?.middle; break;
      case "BollingerBands.Lower": result = BollingerBands.calculate({...input, stdDev: 2}).pop()?.lower; break;

      case "Volume.Signal": {
        const endIdx = candles.volumes.length - 1;
        const avgVolume = candles.volumes.slice(endIdx - finalPeriod, endIdx).reduce((a, b) => a + b, 0) / finalPeriod;
        const currentVolume = candles.volumes[endIdx];
        if (currentVolume > avgVolume * 1.5) result = "UP";
        else if (currentVolume < avgVolume * 0.67) result = "DOWN";
        else result = "NEUTRAL";
        break;
      }

      case "Price": result = tokenData ? parseFloat(tokenData.priceUSD) : candles.closes.pop(); break;
      case "Liquidity": result = tokenData ? parseFloat(tokenData.liquidity) : null; break;
      case "Holders": result = tokenData ? parseInt(tokenData.holders) : null; break;
      
      default: return null;
    }

    if (result !== null) indicatorCache.set(cacheKey, result);
  } catch (e) { result = null; }

  return result;
}

function compareValues(actual, operator, expected) {
  if (actual == null) return false;

  // Handle String Logic (e.g., Volume.Signal)
  if (typeof actual === "string") {
    const act = actual.toUpperCase();
    const exp = String(expected).toUpperCase();
    return operator === "EQUAL" ? act === exp : act !== exp;
  }

  const a = Number(actual);
  const e = Number(expected);
  if (isNaN(a) || isNaN(e)) return false;

  switch (operator) {
    case "GREATER_THAN": return a > e;
    case "LESS_THAN": return a < e;
    case "GREATER_THAN_OR_EQUAL": return a >= e;
    case "LESS_THAN_OR_EQUAL": return a <= e;
    case "EQUAL": return Math.abs(a - e) < 0.00001;
    case "NOT_EQUAL": return Math.abs(a - e) >= 0.00001;
    default: return false;
  }
}

function evaluateTechnicalLogic(logic, candleData, tokenData) {
  if (!logic) return false;
  
  // Group Node (AND/OR)
  if (logic.operator === "AND" || logic.operator === "OR") {
    const isAnd = logic.operator === "AND";
    for (const subLogic of logic.logics) {
      const res = evaluateTechnicalLogic(subLogic, candleData, tokenData);
      if (isAnd && !res) return false; // Fail fast
      if (!isAnd && res) return true;  // Succeed fast
    }
    return isAnd; // AND returns true if none failed, OR returns false if none succeeded
  }

  // Condition Node
  const {operator, id, type, period, threshold} = logic;
  const resolution = logic.resolution || "1";
  
  try {
    const config = TECHNICAL_ANALYSIS_RESOLUTION_CONFIG[resolution] || { base: "1", multiplier: parseInt(resolution) };
    const source = candleData[config.base];
    if (!source || !source.success) return false;
    
    const candles = convertResolution(source, config.multiplier);
    const actualValue = calculateIndicator(id, candles, period, tokenData);
    console.log(id, actualValue)
    return compareValues(actualValue, operator, threshold);
  } catch (e) {
    return false;
  }
}

export function technicalAnalysisOrder({ technicalLogics, tokenData, candleData }) {
  let results = false;
  results = evaluateTechnicalLogic(technicalLogics, candleData, tokenData);
  return results;
}

export const clearAllCaches = () => { resolutionCache.clear(); indicatorCache.clear(); };