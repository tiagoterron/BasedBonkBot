const { formatUnits } = require('ethers');

// Format address with middle truncation
function formatAddress(address, start = 6, end = 4) {
  try {
    if (!address) return '';
    if (address.length <= start + end) return address;
    return `${address.slice(0, start)}...${address.slice(-end)}`;
  } catch(err) {
    return `0x000...000`;
  }
}

// Format timestamp to readable date
function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

 function escapeMarkdownV2(text) {
      return text
        // Escape periods - this is what's causing your error
        .replace(/\./g, '\\.')
        // Escape other problematic characters
        .replace(/([[\]()\\])/g, '\\$1')
        // Remove emojis that can cause parsing issues
        .replace(/[\p{Emoji}\u200D\uFE0F]/gu, '');
  };

// Format large numbers with commas
function formatNumber(number) {
  try {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch(err) {
    return number;
  }
}

// Format ETH value
function formatEth(value, decimals = 18) {
  if (!value) return '0';
  return formatUnits(value.toString(), decimals);
}

// Format token value based on decimals
function formatTokenValue(value, decimals = 18) {
  if (!value) return '0';
  return formatUnits(value.toString(), decimals);
}

// Format gas price to Gwei
function formatGasPrice(gasPrice) {
  if (!gasPrice) return '0';
  return `${formatUnits(gasPrice, 9)} Gwei`;
}

function formatHex(hex, length = 66) {
  if (!hex) return '0x';
  
  let formattedHex = hex.toLowerCase();
  
  // Ensure it starts with '0x'
  if (!formattedHex.startsWith('0x')) {
    formattedHex = '0x' + formattedHex;
  }

  // Pad or trim to expected length
  if (formattedHex.length < length) {
    formattedHex = formattedHex.padEnd(length, '0'); // Pads with trailing zeros
  } else if (formattedHex.length > length) {
    formattedHex = formattedHex.slice(0, length);
  }

  return formattedHex;
}

function formatStatus(status) {
  if (status === 1) return 'Success';
  if (status === -1) return 'Pending';
  if (status === 0) return 'Failed';
}

function formatBigInt(bigIntValue, decimals = 18, precision = 4) {
  if (!bigIntValue) return '0';

  // Convert BigInt to a string representation of a floating point number
  const formatted = formatUnits(bigIntValue, decimals);

  // Limit decimal places
  return parseFloat(formatted).toFixed(precision);
}

const Number_Format = new Intl.NumberFormat('en-US');
const Number_Format_USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2
});
const Number_Format_Compact = new Intl.NumberFormat('en-US', { 
  notation: "compact"
});

function calculatePercentChange(basePrice, currentPrice) {
  // Formula: ((currentPrice - basePrice) / basePrice) * 100
  const percentChange = ((currentPrice - basePrice) / basePrice) * 100;
  return percentChange;
}

function parseBigNumber(input) {
  // If already a number, return as is
  if (typeof input === 'number') return input;
  
  // If null, undefined or empty string, return 0
  if (!input) return 0;

  const multipliers = {
    k: 1e3,  // thousand
    m: 1e6,  // million
    b: 1e9,  // billion
    t: 1e12  // trillion
  };

  try {
    // Normalize input: trim whitespace, remove commas, convert to lowercase
    const normalized = input.toString().trim().replace(/,/g, '').toLowerCase();
    
    // Extract number and suffix using regex
    // This regex matches: digit(s) followed by optional decimal point and more digits,
    // followed by optional whitespace and optional k, m, b, or t
    const match = normalized.match(/^([\d.]+)\s*([kmbt])?$/);
    
    if (!match) {
      console.warn(`parseBigNumber: Could not parse "${input}", returning 0`);
      return 0; // Return 0 for unparseable inputs instead of throwing
    }

    const [, numberPart, suffix = ''] = match;
    const multiplier = multipliers[suffix] || 1;
    
    return parseFloat(numberPart) * multiplier;
  } catch (error) {
    console.error(`Error parsing "${input}":`, error);
    return 0; // Return 0 on error instead of throwing
  }
}

function getRandomArray(tokens, count) {
  const shuffled = [...tokens].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function formatBigNumber(number, precision = 1) {
  if (number === null || number === undefined || isNaN(number)) return '0';
  
  const absNumber = Math.abs(number);
  const sign = number < 0 ? '-' : '';
  
  if (absNumber >= 1e12) {
    return sign + (absNumber / 1e12).toFixed(precision) + 'T';
  } else if (absNumber >= 1e9) {
    return sign + (absNumber / 1e9).toFixed(precision) + 'B';
  } else if (absNumber >= 1e6) {
    return sign + (absNumber / 1e6).toFixed(precision) + 'M';
  } else if (absNumber >= 1e3) {
    return sign + (absNumber / 1e3).toFixed(precision) + 'k';
  } else {
    return sign + absNumber.toFixed(precision);
  }
}

// Format as regular number with commas
function FormatNumber(v = 0, d = 2, s = true) {
  try {
    if (v === null || v === undefined) return '0.00';
    
    // For small numbers, we may need more decimal places
    const absValue = Math.abs(Number(v));
    if (absValue > 0 && absValue < 0.01) d = 4;
    
    // If we need currency formatting
    if (s) {
      return Number_Format.format(parseFloat(v.toString()).toFixed(d));
    } else {
      return parseFloat(v.toString()).toFixed(d);
    }
  } catch(err) {
    return v.toString();
  }
}

// Format as currency (separate from FormatNumber)
function CurrencyFormat(amount) {
  try {
    if (amount === null || amount === undefined) return '$0.00';
    
    // Using the USD formatter directly
    return Number_Format_USD.format(Number(amount));
  } catch(err) {
    return '$' + amount;
  }
}

// If you just want to format a number with commas and two decimal places
function FormatWithCommas(value) {
  try {
    return Number(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch(err) {
    return value;
  }
}

// Format number in compact form (K, M, B)
function formatCompact(value) {
  try {
    return Number_Format_Compact.format(Number(value));
  } catch(err) {
    return value;
  }
}

module.exports = {
  formatAddress,
  formatDate,
  formatNumber,
  formatEth,
  formatTokenValue,
  formatGasPrice,
  formatHex,
  formatStatus,
  formatBigInt,
  calculatePercentChange,
  parseBigNumber,
  getRandomArray,
  formatBigNumber,
  FormatNumber,
  escapeMarkdownV2,
  CurrencyFormat,
  FormatWithCommas,
  formatCompact
};