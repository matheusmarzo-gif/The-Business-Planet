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
  type: ResidenceType;
  x: number;
  y: number;
  price: number;
  unitsSoldLastDay: number;
  lastDaySalePrice: number;
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

export interface ShopTransactionCandidate {
  shopId: string;
  price: number;
  distance: number;
  desiredQuantity: number;
  benefit: number;
  rank: number;
  stockAvailable: number;
  capacityAvailable: number;
  available: number;
  demandBefore: number;
  purchased: number;
  demandAfter: number;
  outcome:
    | 'purchased'
    | 'negative_benefit'
    | 'no_stock'
    | 'no_capacity'
    | 'no_stock_or_capacity'
    | 'demand_fulfilled';
}

export interface ShopResidenceTransaction {
  residenceId: string;
  occupants: number;
  averageIncome: number;
  areaAveragePrice: number;
  expectedDemand: number;
  desiredQuantity: number;
  candidate: ShopTransactionCandidate;
}

export interface RiceSalesPlan {
  purchases: RicePurchase[];
  transactionsByShop: Map<string, ShopResidenceTransaction[]>;
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

// Benefício = ((Sm - preço local * (quantidade desejada / moradores)) / preço local)^3
//            * (60 / (distância + 60))^2.
export function getPurchaseBenefit(
  income: number,
  price: number,
  distance = 0,
  desiredQuantityPerResident = 0,
): number {
  return (
    ((income - price * desiredQuantityPerResident) / price) ** 3 *
    (60 / (distance + 60)) ** 2
  );
}

// Pessoas * 0,03 * max(0,125, min(4, preço médio efetivo da área / preço local)).
function getExpectedPurchaseQuantity(
  occupants: number,
  areaAveragePrice: number,
  price: number,
): number {
  return (
    occupants *
    PURCHASE_RATE *
    Math.max(PURCHASE_MIN_RATIO, Math.min(PURCHASE_MAX_RATIO, areaAveragePrice / price))
  );
}

export function getPurchaseQuantity(
  occupants: number,
  areaAveragePrice: number,
  price: number,
  random: () => number,
): number {
  const expected = getExpectedPurchaseQuantity(occupants, areaAveragePrice, price);
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
  return planRiceSalesDetailed(residences, shops, random).purchases;
}

export function planRiceSalesDetailed(
  residences: SalesResidence[],
  shops: SalesShop[],
  random: () => number = Math.random,
): RiceSalesPlan {
  const remainingStock = new Map(shops.map((shop) => [shop.id, shop.stock]));
  const remainingCapacity = new Map(shops.map((shop) => [shop.id, shop.capacity]));
  const purchases: RicePurchase[] = [];
  const transactionsByShop = new Map<string, ShopResidenceTransaction[]>(
    shops.map((shop) => [shop.id, []]),
  );
  const sorted = [...residences].sort((a, b) => a.id.localeCompare(b.id));

  for (const residence of sorted) {
    const nearby = shops.filter((shop) => isWithinWorkerSearchRadius(shop, residence));
    if (nearby.length === 0 || residence.occupants <= 0) continue;
    const soldUnits = nearby.reduce((sum, shop) => sum + shop.unitsSoldLastDay, 0);
    const average =
      soldUnits > 0
        ? nearby.reduce((sum, shop) => sum + shop.unitsSoldLastDay * shop.lastDaySalePrice, 0) /
          soldUnits
        : nearby.reduce((sum, shop) => sum + shop.price, 0) / nearby.length;
    const ranked = nearby
      .map((shop) => {
        const desiredQuantity = getExpectedPurchaseQuantity(residence.occupants, average, shop.price);
        const distance = getDistanceBetweenBuildings(shop, residence);
        return {
          shop,
          distance,
          desiredQuantity,
          benefit: getPurchaseBenefit(
            residence.averageIncome,
            shop.price,
            distance,
            desiredQuantity / residence.occupants,
          ),
        };
      })
      .sort((a, b) => b.benefit - a.benefit || a.shop.id.localeCompare(b.shop.id));

    const expectedDemand = getExpectedPurchaseQuantity(
      residence.occupants,
      average,
      ranked[0].shop.price,
    );
    const desiredQuantity = getPurchaseQuantity(
      residence.occupants,
      average,
      ranked[0].shop.price,
      random,
    );
    let wanted = desiredQuantity;
    const candidates: ShopTransactionCandidate[] = [];
    for (const [index, { shop, distance, desiredQuantity: candidateDemand, benefit }] of ranked.entries()) {
      const stockAvailable = remainingStock.get(shop.id) ?? 0;
      const capacityAvailable = remainingCapacity.get(shop.id) ?? 0;
      const available = Math.min(stockAvailable, capacityAvailable);
      const demandBefore = wanted;
      const quantity = benefit < 0 ? 0 : Math.min(wanted, available);
      wanted -= quantity;
      if (quantity > 0) {
        remainingStock.set(shop.id, stockAvailable - quantity);
        remainingCapacity.set(shop.id, capacityAvailable - quantity);
        purchases.push({ shopId: shop.id, residenceId: residence.id, quantity });
      }
      candidates.push({
        shopId: shop.id,
        price: shop.price,
        distance,
        desiredQuantity: candidateDemand,
        benefit,
        rank: index + 1,
        stockAvailable,
        capacityAvailable,
        available,
        demandBefore,
        purchased: quantity,
        demandAfter: wanted,
        outcome:
          quantity > 0
            ? 'purchased'
            : benefit < 0
              ? 'negative_benefit'
            : demandBefore <= 0
              ? 'demand_fulfilled'
              : stockAvailable <= 0 && capacityAvailable <= 0
                ? 'no_stock_or_capacity'
                : stockAvailable <= 0
                  ? 'no_stock'
                  : 'no_capacity',
      });
    }

    for (const candidate of candidates) {
      const shopTransactions = transactionsByShop.get(candidate.shopId);
      if (!shopTransactions) {
        throw new Error(`Não foi possível associar o diagnóstico à loja ${candidate.shopId}.`);
      }
      shopTransactions.push({
        residenceId: residence.id,
        occupants: residence.occupants,
        averageIncome: residence.averageIncome,
        areaAveragePrice: average,
        expectedDemand,
        desiredQuantity,
        candidate,
      });
    }
  }
  return { purchases, transactionsByShop };
}
