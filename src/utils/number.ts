/**
 * Rounds a number to the specified number of decimal places
 * @param {number} amount - The number to round
 * @param {number} decimals - Number of decimal places
 * @returns {number} The rounded number
 * @example
 * roundAmount(1.23456, 2) // returns 1.23
 */
export const roundAmount = (amount: number, decimals: number) => {
  return Number(amount.toFixed(decimals));
};

/**
 * Formats very small numbers using subscript notation for leading zeros
 * @param {number} value - The number to format
 * @param {number} threshold - Minimum number of consecutive zeros to use subscript notation (default: 5)
 * @param {number} minimumSignificantDigits - Minimum significant digits to show (default: 2)
 * @param {number} fractionDigits - Number of fraction digits for standard formatting (default: 2)
 * @returns {string} The formatted number string
 * @example
 * formatSmallNumber(0.0000123) // returns "0.0₅123"
 * formatSmallNumber(0) // returns "0"
 */
function formatSmallNumber(
  value: number,
  threshold = 5,
  minimumSignificantDigits = 2,
  fractionDigits = 2
): string {
  if (value === 0) return "0";
  if (!value) return "-";
  const subs = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
  const [left, right] = value.toFixed(String(value).length).split(".");
  const result = right.match(`^([0]{${threshold},})`);
  if (result) {
    const length = result[0].length;
    const subStr = length.toString().replace(/\d/g, (digit) => subs[+digit]);
    const end = right.slice(length);
    return (left + ".0" + subStr + end)
      .replace(/0+$/, "")
      .substring(0, 4 + minimumSignificantDigits);
  }

  if (typeof value === "string") value = Number(value);
  if (typeof value !== "number" || isNaN(value)) return "";
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    compactDisplay: "short",
  }).format(value);
}

/**
 * Formats large numbers in compact notation (K, M, B)
 * @param {number} number - The number to format
 * @param {number} maxDecimalCount - Maximum number of decimal places (default: 1)
 * @returns {string} The formatted number with suffix (K/M/B) or original number
 * @example
 * formatCompactNumber(1500) // returns "1.5K"
 * formatCompactNumber(2500000) // returns "3M"
 * formatCompactNumber(1500000000) // returns "2B"
 * formatCompactNumber(500) // returns "500"
 */
function formatCompactNumber(number: number, maxDecimalCount = 1): string {
  if (typeof number !== "number" || isNaN(number)) {
    return "0";
  }

  // Billions (B) - >= 1,000,000,000
  if (number >= 1_000_000_000) {
    const value = number / 1_000_000_000;
    return parseFloat(value.toFixed(maxDecimalCount)) + "B";
  }

  // Millions (M) - >= 1,000,000
  if (number >= 1_000_000) {
    const value = number / 1_000_000;
    return parseFloat(value.toFixed(maxDecimalCount)) + "M";
  }

  // Thousands (K) - >= 1,000
  if (number >= 1_000) {
    const value = number / 1_000;
    return parseFloat(value.toFixed(maxDecimalCount)) + "K";
  }

  // Numbers less than 1,000 - keep as is
  return parseFloat(number.toFixed(maxDecimalCount)).toString();
}

/**
 * Intelligently formats numbers based on their magnitude with appropriate precision
 * - Very small numbers (< 0.0001): Uses subscript notation for zeros
 * - Small numbers (0.0001 - 0.1): Shows dynamic decimal places based on leading zeros
 * - Medium numbers (0.1 - 10): Shows 2 decimal places
 * - Large numbers (10 - 1000): Shows 1 decimal place
 * - Very large numbers (>= 1000): Uses compact notation (K/M/B)
 * @param {number | string} number - The number to format
 * @param {number} maxDecimalCount - Maximum decimal places for certain ranges (default: 2)
 * @returns {string} The formatted number string, or "0" for invalid/too small values
 * @example
 * formatSmartNumberView(0.000012) // returns "0.0₅12"
 * formatSmartNumberView(0.05) // returns "0.05"
 * formatSmartNumberView(5.123) // returns "5.12"
 * formatSmartNumberView(50.123) // returns "50.1"
 * formatSmartNumberView(5000) // returns "5K"
 */
export const formatSmartNumberView = (
  number: number | string,
  maxDecimalCount = 2,
  isUseCompactNumber = true
) => {
  if (typeof number === "string") number = Number(number);

  if (typeof number !== "number" || isNaN(number) || number < 0.00000000001) {
    return "0";
  }

  const decimalPart = number.toString().split(".")[1] || "";

  let zeroCount = 0;

  for (let i = 0; i < decimalPart.length; i++) {
    if (decimalPart[i] !== "0") {
      zeroCount++;
    } else {
      break;
    }
  }

  if (number < 0.0001) return formatSmallNumber(number, 3);

  if (number >= 0.0001 && number < 0.1) {
    return parseFloat(number.toFixed(zeroCount + 2)).toString();
  }

  if (number >= 0.1 && number < 10) {
    return parseFloat(number.toFixed(maxDecimalCount)).toString();
  }

  if (number >= 10 && number < 1000) {
    return parseFloat(
      number.toFixed(zeroCount === 0 ? zeroCount : 1)
    ).toString();
  }

  if (number >= 1000) {
    if (isUseCompactNumber) {
      return formatCompactNumber(number, 1);
    } else {
      return parseFloat(number.toFixed(0)).toLocaleString("en-US");
    }
  }
};

/**
 * Formats a number with sign (+/-) and returns className for color styling
 * @param {number} value - The number to format
 * @param {string} prefix - Prefix to add before the number (default: "$")
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {object} Object containing formattedText and className
 * @example
 * formatSignedNumberWithColor(123.45) // returns { formattedText: "+$123.5", className: "text-success" }
 * formatSignedNumberWithColor(-50.2) // returns { formattedText: "-$50.2", className: "text-danger" }
 * formatSignedNumberWithColor(0) // returns { formattedText: "$0", className: "" }
 */
export const formatSignedNumberWithColor = (
  value: number,
  prefix: string = "$",
  decimals: number = 1
): { formattedText: string; className: string } => {
  if (typeof value !== "number" || isNaN(value)) {
    return { formattedText: `${prefix}0`, className: "" };
  }

  const absValue = Math.abs(value);
  const formattedValue = formatSmartNumberView(absValue.toFixed(decimals));

  if (value > 0) {
    return {
      formattedText: `+${prefix}${formattedValue}`,
      className: "text-success",
    };
  }

  if (value < 0) {
    return {
      formattedText: `-${prefix}${formattedValue}`,
      className: "text-danger",
    };
  }

  // value === 0
  return {
    formattedText: `${prefix}${formattedValue}`,
    className: "",
  };
};
