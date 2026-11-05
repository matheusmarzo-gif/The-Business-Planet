import { isWithinWorkerSearchRadius, type ResidenceType } from './residence.js';

export const DEFAULT_SHOP_PRICE = 10;
export const MIN_SHOP_PRICE = 1;
export const MAX_SHOP_PRICE = 100000;
// A cada 100 Work Points gerados no dia, a loja ganha 5 unidades de capacidade de venda.
export const SALES_PER_100_WORK_POINTS = 5;
export const PURCHASE_RATE = 0.03;
export const PURCHASE_MIN_RATIO = 4;

export interface SalesShop {
  id: string;
  type: ResidenceType;
  x: number;
  y: number;
  price: number;
  stock: number;
  capacity: number;
}

export interface SalesResidence {
  id: string;
  type: ResidenceType;
  x: number;
  y: number;
  occupants: number;
  averageIncome: number;
}

export interface RicePurchase {
  shopId: string;
  residenceId: string;
  quantity: number;
}

export function parsePrice(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const { price } = value as Record<string, unknown>;
  if (
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < MIN_SHOP_PRICE ||
    price > MAX_SHOP_PRICE
  ) {
    return null;
  }
  return price;
}

export function getShopSalesCapacity(dailyWorkPoints: number): number {
  return Math.floor(dailyWorkPoints / 100) * SALES_PER_100_WORK_POINTS;
}

// Bonificação = ((Sm - Vma) / Vlocal)^3
export function getPurchaseBenefit(income: number, areaAveragePrice: number, price: number): number {
  return ((income - areaAveragePrice) / price) ** 3;
}

// Pessoas * 1 * 0,03 * max(4, Vma / Vlocal); a parte fracionária é a chance de comprar +1 unidade.
export function getPurchaseQuantity(
  occupants: number,
  areaAveragePrice: number,
  price: number,
  random: () => number,
): number {
  const expected =
    occupants * 1 * PURCHASE_RATE * Math.max(PURCHASE_MIN_RATIO, areaAveragePrice / price);
  const whole = Math.floor(expected);
  return whole + (random() < expected - whole ? 1 : 0);
}

/**
 * Cada residência (por id) compra das lojas em 60 tiles, do maior benefício para
 * o menor, limitada pela capacidade de venda do dia e pelo estoque de cada loja.
 */
export function planRiceSales(
  residences: SalesResidence[],
  shops: SalesShop[],
  random: () => number = Math.random,
): RicePurchase[] {
  const remaining = new Map(shops.map((shop) => [shop.id, Math.min(shop.capacity, shop.stock)]));
  const purchases: RicePurchase[] = [];
  const sorted = [...residences].sort((a, b) => a.id.localeCompare(b.id));

  for (const residence of sorted) {
    const nearby = shops.filter((shop) => isWithinWorkerSearchRadius(shop, residence));
    if (nearby.length === 0 || residence.occupants <= 0) continue;
    const average = nearby.reduce((sum, shop) => sum + shop.price, 0) / nearby.length;
    const ranked = nearby
      .map((shop) => ({
        shop,
        benefit: getPurchaseBenefit(residence.averageIncome, average, shop.price),
      }))
      .sort((a, b) => b.benefit - a.benefit || a.shop.id.localeCompare(b.shop.id));

    // A quantidade desejada depende do preço da loja analisada; consome-se da melhor para a pior.
    let wanted = getPurchaseQuantity(residence.occupants, average, ranked[0].shop.price, random);
    for (const { shop } of ranked) {
      if (wanted <= 0) break;
      const available = remaining.get(shop.id) ?? 0;
      const quantity = Math.min(wanted, available);
      if (quantity <= 0) continue;
      remaining.set(shop.id, available - quantity);
      wanted -= quantity;
      purchases.push({ shopId: shop.id, residenceId: residence.id, quantity });
    }
  }
  return purchases;
}
