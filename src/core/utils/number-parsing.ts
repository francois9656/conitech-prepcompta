export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }

  const normalized = raw
    .replace(/\$/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, "")
    .trim();

  if (!normalized) {
    return null;
  }

  const isNegative = normalized.startsWith("(") && normalized.endsWith(")");
  const unsigned = normalized.replace(/[()]/g, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");

  let numericText = unsigned;
  if (lastComma >= 0 || lastDot >= 0) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const decimalSeparator = unsigned[decimalIndex];
    const integerPart = unsigned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = unsigned.slice(decimalIndex + 1).replace(/[.,]/g, "");
    numericText =
      decimalPart.length > 0 && (decimalSeparator === "," || decimalPart.length <= 2)
        ? `${integerPart}.${decimalPart}`
        : unsigned.replace(/[.,]/g, "");
  }

  const amount = Number(numericText);

  if (Number.isNaN(amount)) {
    return null;
  }

  return isNegative ? -amount : amount;
}

export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
