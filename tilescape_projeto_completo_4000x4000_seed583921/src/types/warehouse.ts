import { PRODUCTS } from './product.js';

export type WarehouseTradeMode = 'sell' | 'buy';

export interface WarehouseProductSetting {
  productId: string;
  desiredStock: number;
  price: number;
  mode: WarehouseTradeMode;
}

export const MAX_WAREHOUSE_DESIRED_STOCK = 1000000;
export const MAX_WAREHOUSE_PRICE = 1000000;

export const DEFAULT_WAREHOUSE_SETTING = { desiredStock: 0, price: 0, mode: 'sell' } as const;

const PRODUCT_IDS = new Set(PRODUCTS.map((product) => product.id));

export function parseWarehouseSetting(value: unknown): WarehouseProductSetting | null {
  if (typeof value !== 'object' || value === null) return null;
  const { productId, desiredStock, price, mode } = value as Record<string, unknown>;
  if (
    typeof productId !== 'string' ||
    !PRODUCT_IDS.has(productId) ||
    typeof desiredStock !== 'number' ||
    !Number.isInteger(desiredStock) ||
    desiredStock < 0 ||
    desiredStock > MAX_WAREHOUSE_DESIRED_STOCK ||
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < 0 ||
    price > MAX_WAREHOUSE_PRICE ||
    (mode !== 'sell' && mode !== 'buy')
  ) {
    return null;
  }
  return { productId, desiredStock, price, mode };
}

export function isWarehouseSetting(value: unknown): value is WarehouseProductSetting {
  return parseWarehouseSetting(value) !== null;
}
