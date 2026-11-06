export const CURRENCY_DECIMAL_PLACES = 2;
const CURRENCY_SCALE = 10 ** CURRENCY_DECIMAL_PLACES;

export function isCurrencyAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return Number(value.toFixed(CURRENCY_DECIMAL_PLACES)) === value;
}

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('O valor monetário precisa ser finito.');
  }
  const scaled = value * CURRENCY_SCALE;
  return Math.round(scaled + Math.sign(scaled) * Number.EPSILON) / CURRENCY_SCALE;
}
