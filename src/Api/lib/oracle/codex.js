import { axiosRequest } from "./axios.js";

const handleCodexUrlParams = [
  {
    url: "https://api-cdx.lfj.gg/",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://lfj.gg",
      Referer: "https://lfj.gg/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
    },
  },
  {
    url: "https://graph.defined.fi/graphql",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://codex-marketing.vercel.app",
      Referer: "https://codex-marketing.vercel.app/",
      authorization: "46d7bcd079676023618ad2fa4239cdeb0c5594ab",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
    },
  },
  //   {
  //     url: "https://graph.codex.io/graphql",
  //     headers: {
  //       "Authorization": "0f706bba45133e4460fe19529b1b1902914b155d",
  //     },
  //   },
];

const CODEX_CANDLE_BAR_QUERY = `query GetBars(
  $symbol: String!
  $countback: Int
  $from: Int!
  $to: Int!
  $resolution: String!
  $currencyCode: String
  $quoteToken: QuoteToken
  $statsType: TokenPairStatisticsType
  $removeLeadingNullValues: Boolean
  $removeEmptyBars: Boolean
) {
  getBars(
    symbol: $symbol
    countback: $countback
    from: $from
    to: $to
    resolution: $resolution
    currencyCode: $currencyCode
    quoteToken: $quoteToken
    statsType: $statsType
    removeLeadingNullValues: $removeLeadingNullValues
    removeEmptyBars: $removeEmptyBars
  ) {
    s # Status/Success? (Likely string or bool)
    o # Open price
    h # High price
    l # Low price
    c # Close price
    t # Timestamp
    volume
    volumeNativeToken
    buys
    buyers
    buyVolume
    sells
    sellers
    sellVolume
    liquidity
    traders
    transactions
    __typename
  }
}`;

const CODEX_FILTER_TOKENS = `query FilterTokens(
  $filters: TokenFilters
  $statsType: TokenPairStatisticsType
  $excludeTokens: [String]
  $phrase: String
  $tokens: [String]
  $rankings: [TokenRanking]
  $limit: Int
  $offset: Int
) {
  filterTokens(
    filters: $filters
    statsType: $statsType
    excludeTokens: $excludeTokens
    phrase: $phrase
    tokens: $tokens
    rankings: $rankings
    limit: $limit
    offset: $offset
  ) {
    results {
      buyCount5m
      buyCount1
      buyCount12
      buyCount24
      buyCount4
      uniqueBuys5m
      uniqueBuys1
      uniqueBuys12
      uniqueBuys24
      uniqueBuys4
      change5m
      change1
      change12
      change24
      change4
      createdAt
      exchanges {
        ...ExchangeModel
        __typename
      }
      fdv
      high5m
      high1
      high12
      high24
      high4
      holders
      lastTransaction
      liquidity
      low5m
      low1
      low12
      low24
      low4
      marketCap
      pair {
        ...PairModel
        __typename
      }
      priceUSD
      quoteToken
      sellCount5m
      sellCount1
      sellCount12
      sellCount24
      sellCount4
      uniqueSells5m
      uniqueSells1
      uniqueSells12
      uniqueSells24
      uniqueSells4
      token {
        address
        decimals
        id
        name
        networkId
        symbol
        isScam
        socialLinks {
          discord
          telegram
          twitter
          website
          __typename
        }
        imageThumbUrl
        imageSmallUrl
        imageLargeUrl
        info {
          ...BaseTokenInfo
          __typename
        }
        __typename
      }
      txnCount5m
      txnCount1
      txnCount12
      txnCount24
      txnCount4
      uniqueTransactions5m
      uniqueTransactions1
      uniqueTransactions12
      uniqueTransactions24
      uniqueTransactions4
      volume5m
      volume1
      volume12
      volume24
      volume4
      swapPct7dOldWallet
      swapPct1dOldWallet
      walletAgeAvg
      walletAgeStd
      __typename
    }
    count
    page
    __typename
  }
}

fragment ExchangeModel on Exchange {
  address
  color
  exchangeVersion
  id
  name
  networkId
  tradeUrl
  iconUrl
  enabled
  __typename
}

fragment PairModel on Pair {
  address
  exchangeHash
  fee
  id
  networkId
  tickSpacing
  token0
  token1
  __typename
}

fragment BaseTokenInfo on TokenInfo {
  address
  circulatingSupply
  description
  id
  imageBannerUrl
  imageLargeUrl
  imageSmallUrl
  imageThumbUrl
  isScam
  name
  networkId
  symbol
  totalSupply
  __typename
}`;

const CODEX_TOKEN_PRICE_QUERY = `query GetTokenPrice($inputs: [GetPriceInput]) {
  getTokenPrices(inputs: $inputs) {
    priceUsd
    address
    networkId
    poolAddress
    timestamp
    __typename
  }
}`;

let getUrlConfigurration = () => {
 let randomIndex = Math.floor(Math.random() * handleCodexUrlParams.length);
  return handleCodexUrlParams[randomIndex];
};

export const fetchCodexCandleBar = async ({
  pairAddress,
  quoteToken,
  chainId,
  resolution = "1",
  from,
  to,
  createdAt = 1700000000,
  limit = 330,
}) => {
  let urlConfigurration = getUrlConfigurration();
  // Use passed 'to' or fallback to current time
  const requestTo = to || Math.floor(Date.now() / 1000);
  
  // Use passed 'from' or fallback to a default (limit * resolution in seconds)
  // Ensure we never request data older than the token's 'createdAt'
  const requestFrom = from 
    ? Math.max(from, createdAt) 
    : Math.max((requestTo - 28512000), createdAt);
  //const to = Math.floor(Date.now() / 1000);
  //let from = Math.max((to - 28512000), createdAt); // 330 days earlier
  let response = await axiosRequest({
    ...urlConfigurration,
    method: "POST",
    data: {
      query: CODEX_CANDLE_BAR_QUERY,
      variables: {
        symbol: `${pairAddress}:${chainId}`,
        countback: limit,
        from: requestFrom,
        to:requestTo,
        resolution,
        currencyCode: "USD",
        quoteToken,
        statsType: "FILTERED",
      },
    },
  });
  //console.log(response);
  let bars = response.data.getBars;
  const sanitizeBars = bars.t.map((time, i) => ({
    time: time * 1000,
    high: parseFloat(bars.h[i]),
    low: parseFloat(bars.l[i]),
    close: parseFloat(bars.c[i]),
    open: parseFloat(bars.o[i]),
    volume: parseFloat(bars.volume[i] || 0),
  }));
  return {
    candles: sanitizeBars,
  };
};

export const fetchCodexFilterTokens = async ({
  variables,
}) => {
  let urlConfigurration = getUrlConfigurration();
  let response = await axiosRequest({
    ...urlConfigurration,
    method: "POST",
    data: {
      query: CODEX_FILTER_TOKENS,
      variables,
    },
  });
  //console.log(response)
  let tokens = response.data.filterTokens.results;
  return tokens;
};

export const fetchCodexTokenPrice = async ({
  tokenAddress,
  chainId,
}) => {
  let urlConfigurration = getUrlConfigurration();
  let response = await axiosRequest({
    ...urlConfigurration,
    method: "POST",
    data: {
      query: CODEX_TOKEN_PRICE_QUERY,
      variables: {
        inputs: [{ address: tokenAddress, networkId: chainId }],
      },
    },
  });
  //console.log(response)
  let tokenPrices = response.data.getTokenPrices[0];
  return tokenPrices.priceUsd;
};

export const fetchCodexTokenPrices = async (
  tokens
) => {
  let urlConfigurration = getUrlConfigurration();
  let response = await axiosRequest({
    ...urlConfigurration,
    method: "POST",
    data: {
      query: CODEX_TOKEN_PRICE_QUERY,
      variables: {
        inputs: tokens,
      },
    },
  });
  //console.log(response)
  let tokenPrices = response.data.getTokenPrices;
  return tokenPrices;
};

export const fetchMultiTimeFrameCandleData = async ({
  pairAddress,
  chainId,
  quoteToken,
  resolutions = ["1", "60"], 
  createdAt = 1700000000,
  limit = 330,
}) => {
  let urlConfigurration = getUrlConfigurration();
  try {
    // 1. Validation
    if (!pairAddress || !chainId || !quoteToken || !resolutions.length) {
      throw new Error("Missing required parameters for multi-timeframe fetch");
    }

    // 2. Prepare Global Constants & Variables
    const to = Math.floor(Date.now() / 1000);
    // Calculate 'from' based on the longest likely window needed, or use createdAt
    // We default to 365 days ago to ensure we cover higher timeframes like 1D/1W
    let globalFrom = to - 31536000;
    globalFrom = Math.max(globalFrom, createdAt);

    const symbol = `${pairAddress}:${chainId}`;

    // Initialize Query Construction Parts
    let queryBody = "";
    let variableDefinitions = [
      "$symbol: String!",
      "$to: Int!",
      "$from: Int!",
      "$countback: Int",
      "$currencyCode: String",
      "$quoteToken: QuoteToken",
      "$statsType: TokenPairStatisticsType",
      "$removeLeadingNullValues: Boolean",
      "$removeEmptyBars: Boolean",
    ];

    const queryVariables = {
      symbol,
      to,
      from: globalFrom,
      countback: Number(limit),
      currencyCode: "USD",
      quoteToken,
      statsType: "FILTERED",
      removeLeadingNullValues: true,
      removeEmptyBars: true,
    };

    // 3. Build Dynamic Query Loop
    resolutions.forEach((resolution, index) => {
      // Create a safe alias (GraphQL doesn't like numbers at start of alias)
      // We use index to map it back later easily
      const alias = `res_${index}`;

      // Create a unique variable name for this resolution
      const varResName = `resolution_${index}`;

      // Add to definitions: "$resolution_0: String!"
      variableDefinitions.push(`$${varResName}: String!`);

      // Add to variables object
      queryVariables[varResName] = resolution;

      // Append the aliased query block
      queryBody += `
            ${alias}: getBars(
                symbol: $symbol
                countback: $countback
                from: $from
                to: $to
                resolution: $${varResName}
                currencyCode: $currencyCode
                quoteToken: $quoteToken
                statsType: $statsType
                removeLeadingNullValues: $removeLeadingNullValues
                removeEmptyBars: $removeEmptyBars
            ) {
                s
                o
                h
                l
                c
                t
                volume
                buyVolume
                sellVolume
                transactions
                traders
            }
        `;
    });

    // 4. Construct Final Query
    const MULTI_TIMEFRAME_QUERY = `
        query GetMultiTimeframeBars(${variableDefinitions.join(", ")}) {
            ${queryBody}
        }
    `;
    // 5. Execute Request
    const response = await axiosRequest({
      ...urlConfigurration,
      method: "POST",
      data: {
        query: MULTI_TIMEFRAME_QUERY,
        variables: queryVariables,
      },
    });

    if (!response?.data) {
      throw new Error("Invalid response from LFJ multi-timeframe API");
    }

    // 6. Parse and Map Results
    const result = {};

    resolutions.forEach((resolution, index) => {
      const alias = `res_${index}`;
      const bars = response.data[alias];

      if (!bars || !bars.t || !bars.t.length) {
        // Return empty structure if no data found for this resolution
        result[resolution] = {
          success: false,
          highs: [],
          lows: [],
          opens: [],
          closes: [],
          volumes: [],
          times: [],
        };
      } else {
        result[resolution] = {
          success: true,
          highs: bars.h,
          lows: bars.l,
          opens: bars.o,
          closes: bars.c,
          volumes: bars.volume.map((v) => parseFloat(v)),
          times: bars.t.map((t) => t * 1000), // Convert to ms
          buyVolumes: bars.buyVolume.map((b) => parseFloat(b)),
          sellVolumes: bars.sellVolume.map((s) => parseFloat(s)),
          transactions: bars.transactions.map((t) => parseFloat(t)),
          traders: bars.traders.map((t) => parseFloat(t)),
        };
      }
    });

    return result;
  } catch (err) {
    const { message } = handleAxiosError(err);
    throw new Error(`LFJ multi-timeframe fetch failed: ${message}`);
  }
};
