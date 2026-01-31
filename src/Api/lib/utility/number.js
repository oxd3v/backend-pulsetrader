import { parseUnits } from "ethers";
export const bigMath = {
    abs(x) {
        return x < BigInt(0) ? -x : x;
    },
    mulDiv(x, y, z) {
        return (x * y) / z;
    },
    max(max, ...rest) {
        return rest.reduce((currentMax, val) => (currentMax < val ? val : currentMax), max);
    },
    min(min, ...rest) {
        return rest.reduce((currentMin, val) => (currentMin > val ? val : currentMin), min);
    },
    avg(...values) {
        let sum = BigInt(0);
        let count = BigInt(0);
        for (const value of values) {
            if (value !== undefined) {
                sum += value;
                count += BigInt(1);
            }
        }
        if (count === BigInt(0)) {
            return undefined;
        }
        return sum / count;
    },
    divRound(x, y) {
        return x / y + ((x % y) * BigInt(2) > y ? BigInt(1) : BigInt(0));
    },
    divRoundUp(x, y) {
        return (x + y - BigInt(1)) / y;
    },
};

export function expandDecimals(n, decimals) {
    return BigInt(n) * BigInt(10) ** BigInt(decimals);
}

export function convertToUsd(tokenAmount, tokenDecimals, price) {
    return (tokenAmount * price) / expandDecimals(1, tokenDecimals);
}

export function convertToTokenAmount(usd, tokenDecimals, price) {
    return (usd * expandDecimals(1, tokenDecimals)) / price;
}

export const safeParseUnits = (valueInput, decimals) => {
    // Convert to string and trim
    let value = String(valueInput).trim();

    // Basic validation: check if it's a valid number (optionally scientific)
    if (!/^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(value)) {
        throw new Error(`Invalid number format: ${value}`);
    }

    // Handle scientific notation by normalizing to standard decimal (simple case; for complex, use library)
    if (value.toLowerCase().includes('e')) {
        value = parseFloat(value).toFixed(decimals + 1); // Use toFixed for approx, then round below; note: limited precision for huge nums
    }

    // Handle sign
    let sign = '';
    if (value.startsWith('-')) {
        sign = '-';
        value = value.slice(1);
    }

    // Split into integer and fractional parts
    let [intPart, fracPart = ''] = value.split('.');
    intPart = intPart || '0';

    // If no need for rounding, proceed
    if (fracPart.length <= decimals) {
        let safeStr = sign + intPart + (fracPart ? '.' + fracPart : '');
        if (safeStr.startsWith('.')) safeStr = sign + '0' + safeStr;
        return parseUnits(safeStr, decimals);
    }

    // Rounding needed: take up to decimals + 1 for round digit
    const keepFrac = fracPart.slice(0, decimals);
    const roundDigit = parseInt(fracPart[decimals] || '0', 10);
    let newFrac = keepFrac;

    if (roundDigit >= 5) {
        // Round up: increment the fractional part (handle carry)
        let fracArr = newFrac.split('').map(Number);
        let carry = 1;
        for (let i = fracArr.length - 1; i >= 0; i--) {
            const sum = fracArr[i] + carry;
            fracArr[i] = sum % 10;
            carry = Math.floor(sum / 10);
            if (carry === 0) break;
        }
        newFrac = fracArr.join('');
        if (carry > 0) {
            // Carry over to integer part
            let intArr = intPart.split('').map(Number);
            for (let i = intArr.length - 1; i >= 0; i--) {
                const sum = intArr[i] + carry;
                intArr[i] = sum % 10;
                carry = Math.floor(sum / 10);
                if (carry === 0) break;
            }
            if (carry > 0) {
                intArr.unshift(carry); // Add new digit if carry remains
            }
            intPart = intArr.join('');
        }
        console.warn(`Value ${valueInput} rounded up due to excess decimals.`);
    } else {
        console.warn(`Value ${valueInput} truncated due to excess decimals.`);
    }

    // Reconstruct
    let safeStr = sign + intPart + (newFrac ? '.' + newFrac : '');
    if (safeStr.startsWith('.')) safeStr = sign + '0' + safeStr;

    // Parse
    try {
        return parseUnits(safeStr, decimals);
    } catch (error) {
        throw new Error(`Failed to parse units for value: ${safeStr} - ${error.message}`);
    }
};