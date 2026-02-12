import { getDefaultTokenPrices } from "./order/helper.js";
import { safeParseUnits } from "../../Api/lib/utility/number.js";
import { PRECISION_DECIMALS } from "../../Api/constant/common/order.js";

export const COLLATERAL_TOKEN_DATA_MAP = new Map();
const COLLATERAL_PRICE_UPDATE_THRESHOLD = 60000;
let TOKEN_LISTENING_INTERVAL_ID = null;
let TOKEN_LISTENING_INTERVAL = 5000; // 8 minutes
let LAST_PRICE_UPDATE = Date.now();

const updateCollateralPrice = async () => {
  let res = await getDefaultTokenPrices();
  let tokenPrices = res.tokenPrices;
  if (!tokenPrices || !Array.isArray(tokenPrices)) return;
  //let duration = Date.now() - LAST_PRICE_UPDATE;
  tokenPrices.forEach((td) => {
    let tokenKey = `${td.networkId}:${td.address.toLowerCase()}`;
    COLLATERAL_TOKEN_DATA_MAP.set(
      tokenKey,
      safeParseUnits(td.priceUsd, PRECISION_DECIMALS).toString(),
    );
  });
};

export const startTokenListening = () => {
  if (TOKEN_LISTENING_INTERVAL_ID) {
    clearInterval(TOKEN_LISTENING_INTERVAL_ID);
    COLLATERAL_TOKEN_DATA_MAP = new Map();
  }
  updateCollateralPrice();
  TOKEN_LISTENING_INTERVAL_ID = setInterval(
    updateCollateralPrice,
    TOKEN_LISTENING_INTERVAL,
  );
};

export const stopTokenListening = () => {
  if (TOKEN_LISTENING_INTERVAL_ID) {
    clearInterval(TOKEN_LISTENING_INTERVAL_ID);
    COLLATERAL_TOKEN_DATA_MAP = new Map();
  }
};
