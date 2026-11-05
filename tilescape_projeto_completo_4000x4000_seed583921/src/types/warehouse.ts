import { PRODUCTS } from './product.js';

export type WarehouseTradeMode = 'sell' | 'buy';

export interface WarehouseProductSetting {
  productId: string;
  minimumStock: number;
  maximumStock: number | null;
  price: number;
  mode: WarehouseTradeMode;
}

export interface WarehouseDemand {
  lastDay: string | null;
  last: number;
  monthAverage: number;
}

export const MAX_WAREHOUSE_STOCK = 1000000;
export const MAX_WAREHOUSE_PRICE = 1000000;

export const DEFAULT_WAREHOUSE_SETTING = {
  minimumStock: 0,
  maximumStock: null,
  price: 0,
  mode: 'sell',
} as const;

const PRODUCT_IDS = new Set(PRODUCTS.map((product) => product.id));

export function parseWarehouseSetting(value: unknown): WarehouseProductSetting | null {
  if (typeof value !== 'object' || value === null) return null;
  const { productId, minimumStock, price, mode } = value as Record<string, unknown>;
  const rawMaximumStock = (value as Record<string, unknown>).maximumStock;
  const maximumStock = rawMaximumStock === 'MAX' ? null : rawMaximumStock;
  if (
    typeof productId !== 'string' ||
    !PRODUCT_IDS.has(productId) ||
    typeof minimumStock !== 'number' ||
    !Number.isInteger(minimumStock) ||
    minimumStock < 0 ||
    minimumStock > MAX_WAREHOUSE_STOCK ||
    (maximumStock !== null &&
      (typeof maximumStock !== 'number' ||
        !Number.isInteger(maximumStock) ||
        maximumStock < 0 ||
        maximumStock > MAX_WAREHOUSE_STOCK)) ||
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < 0 ||
    price > MAX_WAREHOUSE_PRICE ||
    (mode !== 'sell' && mode !== 'buy')
  ) {
    return null;
  }
  if (maximumStock !== null && minimumStock > maximumStock) return null;
  return { productId, minimumStock, maximumStock, price, mode };
}

export function isWarehouseSetting(value: unknown): value is WarehouseProductSetting {
  return parseWarehouseSetting(value) !== null;
}
