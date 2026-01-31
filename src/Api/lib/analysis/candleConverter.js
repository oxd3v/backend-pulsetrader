export function convertCandlesResolution(sourceData, targetResolution) {
    // 1. Validation
    if (!sourceData || !sourceData.success || sourceData.times.length === 0) {
        return { success: false, times: [] };
    }

    const len = sourceData.times.length;
    const resolutionMs = targetResolution * 60 * 1000;

    // 2. Initialize Result Containers
    const result = {
        success: true,
        highs: [],
        lows: [],
        opens: [],
        closes: [],
        volumes: [],
        times: [],
        buyVolumes: [],
        sellVolumes: [],
        transactions: [],
        traders: []
    };

    // 3. Iteration Variables
    let currentBucketStart = null;
    let bucket = {
        open: null,
        close: null,
        high: -Infinity,
        low: Infinity,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        transactions: 0,
        traders: 0
    };

    for (let i = 0; i < len; i++) {
        const timestamp = sourceData.times[i];
        
        // Calculate which "5-minute bucket" this candle belongs to
        // e.g., 12:02 becomes 12:00
        const bucketStart = Math.floor(timestamp / resolutionMs) * resolutionMs;

        // If we moved to a NEW bucket, push the OLD one to results
        if (currentBucketStart !== null && bucketStart !== currentBucketStart) {
            pushBucketToResult(result, bucket, currentBucketStart);
            resetBucket(bucket);
        }

        // Initialize bucket if new
        if (bucket.open === null) {
            currentBucketStart = bucketStart;
            bucket.open = sourceData.opens[i]; // Open is the FIRST open of the bucket
        }

        // Aggregation Logic
        bucket.close = sourceData.closes[i]; // Close is always the LATEST close seen so far
        bucket.high = Math.max(bucket.high, sourceData.highs[i]);
        bucket.low = Math.min(bucket.low, sourceData.lows[i]);
        
        // Summation Fields
        bucket.volume += sourceData.volumes[i];
        bucket.buyVolume += sourceData.buyVolumes[i];
        bucket.sellVolume += sourceData.sellVolumes[i];
        bucket.transactions += sourceData.transactions[i];
        bucket.traders += sourceData.traders[i]; // Fixed: Sum, not Max
    }

    // 4. Push the final bucket
    if (currentBucketStart !== null) {
        pushBucketToResult(result, bucket, currentBucketStart);
    }

    return result;
}

// Helper to push data to arrays
function pushBucketToResult(result, bucket, time) {
    result.times.push(time);
    result.opens.push(bucket.open);
    result.closes.push(bucket.close);
    result.highs.push(bucket.high);
    result.lows.push(bucket.low);
    result.volumes.push(bucket.volume);
    result.buyVolumes.push(bucket.buyVolume);
    result.sellVolumes.push(bucket.sellVolume);
    result.transactions.push(bucket.transactions);
    result.traders.push(bucket.traders);
}

// Helper to reset bucket state
function resetBucket(bucket) {
    bucket.open = null;
    bucket.close = null;
    bucket.high = -Infinity;
    bucket.low = Infinity;
    bucket.volume = 0;
    bucket.buyVolume = 0;
    bucket.sellVolume = 0;
    bucket.transactions = 0;
    bucket.traders = 0;
}