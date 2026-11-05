import { getResidenceDefinition, isWithinWorkerSearchRadius, type ResidenceType } from './residence.js';

export const DEFAULT_SHOP_PRICE = 10;
export const MIN_SHOP_PRICE = 1;
export const MAX_SHOP_PRICE = 100000;
// A cada 100 Work Points gerados no dia, a loja ganha 5 unidades de capacidade de venda.
export const SALES_PER_100_WORK_POINTS = 5;
export const PURCHASE_RATE = 0.03;
export const PURCHASE_MIN_RATIO = 0.125;
export const PURCHASE_MAX_RATIO = 4;

export interface SalesShop {
  id: string;
  cityId: string;
  type: ResidenceType;
  x: number;
  y: number;
  price: number;
  stock: number;
  capacity: number;
}

export interface SalesResidence {
  id: string;
  cityId: string;
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

export interface ShopDailyFinancials {
  employeeExpense: number;
  productExpense: number;
  unitsSold: number;
  salePrice: number;
  revenue: number;
  profitLoss: number;
}

export function getShopProfitLoss(
  unitsSold: number,
  salePrice: number,
  employeeExpense: number,
  productExpense: number,
): { revenue: number; profitLoss: number } {
  if (
    !Number.isInteger(unitsSold) ||
    unitsSold < 0 ||
    !Number.isInteger(salePrice) ||
    salePrice < MIN_SHOP_PRICE ||
    !Number.isInteger(employeeExpense) ||
    employeeExpense < 0 ||
    !Number.isInteger(productExpense) ||
    productExpense < 0
  ) {
    throw new RangeError('Os valores financeiros diários do comércio são inválidos.');
  }
  const revenue = unitsSold * salePrice;
  return { revenue, profitLoss: revenue - employeeExpense - productExpense };
}

export function getShopDailyFinancials(
  wage: number,
  workers: number,
  unitsSold: number,
  salePrice: number,
): ShopDailyFinancials {
  if (
    !Number.isInteger(wage) ||
    wage < 0 ||
    !Number.isInteger(workers) ||
    workers < 0 ||
    !Number.isInteger(unitsSold) ||
    unitsSold < 0 ||
    !Number.isInteger(salePrice) ||
    salePrice < MIN_SHOP_PRICE
  ) {
    throw new RangeError('Os valores financeiros diários do comércio são inválidos.');
  }
  const employeeExpense = wage * workers;
  // Reposição pelo armazém ligado é uma transferência interna sem cobrança.
  const productExpense = 0;
  const { revenue, profitLoss } = getShopProfitLoss(
    unitsSold,
    salePrice,
    employeeExpense,
    productExpense,
  );
  return {
    employeeExpense,
    productExpense,
    unitsSold,
    salePrice,
    revenue,
    profitLoss,
  };
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

// Benefício = ((Sm - Vma) / Vlocal)^3 * (60 / (distância + 60)).
export function getPurchaseBenefit(
  income: number,
  areaAveragePrice: number,
  price: number,
  distance = 0,
): number {
  return ((income - areaAveragePrice) / price) ** 3 * (60 / (distance + 60));
}

// Pessoas * 0,03 * max(0,125, min(4, preço médio da cidade / preço local)).
export function getPurchaseQuantity(
  occupants: number,
  cityAveragePrice: number,
  price: number,
  random: () => number,
): number {
  const expected =
    occupants *
    PURCHASE_RATE *
    Math.max(PURCHASE_MIN_RATIO, Math.min(PURCHASE_MAX_RATIO, cityAveragePrice / price));
  const whole = Math.floor(expected);
  return whole + (random() < expected - whole ? 1 : 0);
}

function getDistanceBetweenBuildings(
  first: Pick<SalesShop, 'type' | 'x' | 'y'>,
  second: Pick<SalesResidence, 'type' | 'x' | 'y'>,
): number {
  const firstDefinition = getResidenceDefinition(first.type);
  const secondDefinition = getResidenceDefinition(second.type);
  if (!firstDefinition || !secondDefinition) {
    throw new RangeError('Tipo de construção inválido ao calcular a distância de compra.');
  }
  const dx =
    first.x +
    firstDefinition.width / 2 -
    (second.x + secondDefinition.width / 2);
  const dy =
    first.y +
    firstDefinition.height / 2 -
    (second.y + secondDefinition.height / 2);
  return Math.hypot(dx, dy);
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
  const cityAveragePrices = new Map<string, { total: number; count: number }>();
  for (const shop of shops) {
    const cityPrices = cityAveragePrices.get(shop.cityId) ?? { total: 0, count: 0 };
    cityPrices.total += shop.price;
    cityPrices.count += 1;
    cityAveragePrices.set(shop.cityId, cityPrices);
  }
  const purchases: RicePurchase[] = [];
  const sorted = [...residences].sort((a, b) => a.id.localeCompare(b.id));

  for (const residence of sorted) {
    const nearby = shops.filter((shop) => isWithinWorkerSearchRadius(shop, residence));
    if (nearby.length === 0 || residence.occupants <= 0) continue;
    const average = nearby.reduce((sum, shop) => sum + shop.price, 0) / nearby.length;
    const ranked = nearby
      .map((shop) => ({
        shop,
        benefit: getPurchaseBenefit(
          residence.averageIncome,
          average,
          shop.price,
          getDistanceBetweenBuildings(shop, residence),
        ),
      }))
      .sort((a, b) => b.benefit - a.benefit || a.shop.id.localeCompare(b.shop.id));

    const cityPrices = cityAveragePrices.get(residence.cityId);
    const cityAverage =
      cityPrices && cityPrices.count > 0 ? cityPrices.total / cityPrices.count : average;
    // A demanda é calculada pelo preço da loja melhor classificada; o restante tenta outras lojas.
    let wanted = getPurchaseQuantity(residence.occupants, cityAverage, ranked[0].shop.price, random);
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
