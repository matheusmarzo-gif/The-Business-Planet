import { getResidenceDefinition, type ResidenceType } from './residence.js';
import {
  BASIC_BASKET_PRODUCT_IDS,
  CONSUMPTION_PRODUCT_IDS,
  ADVANCED_BASKET_PRODUCT_IDS,
  GOODS_BASKET_PRODUCT_IDS,
  INTERMEDIATE_BASKET_PRODUCT_IDS,
} from './commerceDemand.js';
import { isCurrencyAmount, roundCurrency } from './currency.js';
import { GAME_RULES } from '../generated/gameConfig.js';

export const DEFAULT_SHOP_PRICE = 10;
export const MIN_SHOP_PRICE = 0.01;
export const MAX_SHOP_PRICE = 100000;
export const SHOP_SALES_WORK_POINTS_PER_UNIT =
  GAME_RULES.consumption.salesCapacity.unitWorkPointsPerSale;
export const MILK_SALES_WORK_POINTS_PER_LITER =
  GAME_RULES.consumption.salesCapacity.literWorkPointsPerSale;
const MAX_DIAGNOSTIC_VALUE = Number.MAX_SAFE_INTEGER;
type BasketType = 'basic' | 'intermediate' | 'advanced' | 'goods';

export function getInitialShopPrice(
  ownerAverage: number | null,
  cityAverage: number | null,
): number {
  const referencePrice = ownerAverage ?? cityAverage ?? DEFAULT_SHOP_PRICE;
  if (!Number.isFinite(referencePrice) || referencePrice < MIN_SHOP_PRICE) {
    return DEFAULT_SHOP_PRICE;
  }
  return roundCurrency(referencePrice);
}

export interface SalesShop {
  id: string;
  cityId: string;
  productId: string;
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
  consumers: number;
  averageIncome: number;
  wellbeing: number;
}

export interface StorePurchase {
  shopId: string;
  residenceId: string;
  productId: string;
  quantity: number;
}

export interface CityProductSale {
  cityId: string;
  productId: string;
  unitsSold: number;
  price: number;
}

export interface ShopTransactionCandidate {
  shopId: string;
  price: number;
  distance: number;
  distanceFactor?: number;
  desiredQuantity: number;
  benefit: number;
  rank: number;
  stockAvailable: number;
  capacityAvailable: number;
  available: number;
  demandBefore: number;
  purchased: number;
  demandAfter: number;
  basicNeedPerPerson?: number;
  referenceBasketCost?: number;
  intermediateBasketCost?: number;
  advancedBasketCost?: number;
  calculationBasketCost?: number;
  productAveragePrice?: number;
  pf?: number;
  q?: number;
  w?: number;
  errorBenefit?: number;
  idealBenefit?: number;
  associatedBenefit?: number;
  resultShare?: number;
  allocatedResidents?: number;
  expectedQuantity?: number;
  valuesSaturated?: boolean;
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
  productId?: string;
  basketType?: BasketType;
  basicNeedPerPerson?: number;
  referenceBasketCost?: number;
  intermediateBasketCost?: number;
  advancedBasketCost?: number;
  calculationBasketCost?: number;
  basketBreakdown?: BasketProductBreakdown[];
  productAveragePrice?: number;
  candidate: ShopTransactionCandidate;
}

export interface BasketProductBreakdown {
  productId: string;
  dailyNeedPerPerson: number;
  averagePrice: number | null;
  priceSource: 'weighted_sales' | 'current_shop_prices' | 'unavailable';
  historicalUnitsSold: number;
  historicalRevenue: number;
  currentShopCount: number;
  basketContribution: number | null;
  basketType?: BasketType;
}

export interface CommerceDiagnosticsUpdate {
  type: 'commerce_diagnostics';
  buildingId: string;
  day: string;
  transactions: ShopResidenceTransaction[];
}

export interface ShopSalesSimulation {
  unitsSold: number;
  revenue: number;
  employeeExpense: number;
  profitLoss: number;
}

export function simulateShopSales(
  transactions: readonly ShopResidenceTransaction[],
  settings: {
    price: number;
    stock: number;
    dailyCapacity: number;
    wage: number;
    workers: number;
  },
): ShopSalesSimulation | null {
  if (transactions.length === 0) return null;
  if (
    !isCurrencyAmount(settings.price) ||
    settings.price < MIN_SHOP_PRICE ||
    !Number.isInteger(settings.stock) ||
    settings.stock < 0 ||
    !Number.isFinite(settings.dailyCapacity) ||
    settings.dailyCapacity < 0 ||
    !isCurrencyAmount(settings.wage) ||
    settings.wage < 0 ||
    !Number.isInteger(settings.workers) ||
    settings.workers < 0
  ) {
    throw new RangeError('As configurações atuais da loja são inválidas para simular vendas.');
  }

  const expectedQuantity = transactions.reduce((total, transaction) => {
    const candidate = transaction.candidate;
    const residents = candidate.allocatedResidents ?? 0;
    const need = candidate.basicNeedPerPerson ?? transaction.basicNeedPerPerson ?? 0;
    const calculation = getPurchaseBenefitCalculation(
      transaction.averageIncome,
      settings.price,
      need,
      candidate.referenceBasketCost ?? transaction.referenceBasketCost ?? 0,
      candidate.distance,
      {
        basketType: transaction.basketType,
        intermediateBasketCost:
          candidate.intermediateBasketCost ?? transaction.intermediateBasketCost,
        advancedBasketCost: candidate.advancedBasketCost ?? transaction.advancedBasketCost,
      },
    );
    return total + getExpectedStoreDemand(residents, need, calculation.logAssociatedBenefit);
  }, 0);
  const unitsSold = Math.floor(Math.min(settings.stock, settings.dailyCapacity, expectedQuantity));
  const revenue = roundCurrency(unitsSold * settings.price);
  const employeeExpense = roundCurrency(settings.wage * settings.workers);
  return {
    unitsSold,
    revenue,
    employeeExpense,
    profitLoss: roundCurrency(revenue - employeeExpense),
  };
}

const SHOP_TRANSACTION_OUTCOMES = new Set<ShopTransactionCandidate['outcome']>([
  'purchased',
  'negative_benefit',
  'no_stock',
  'no_capacity',
  'no_stock_or_capacity',
  'demand_fulfilled',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isShopResidenceTransaction(value: unknown): value is ShopResidenceTransaction {
  if (typeof value !== 'object' || value === null) return false;
  const transaction = value as Record<string, unknown>;
  if (
    typeof transaction.residenceId !== 'string' ||
    !isNonNegativeInteger(transaction.occupants) ||
    !isNonNegativeNumber(transaction.averageIncome) ||
    !isNonNegativeNumber(transaction.areaAveragePrice) ||
    !isNonNegativeNumber(transaction.expectedDemand) ||
    !isNonNegativeNumber(transaction.desiredQuantity) ||
    (transaction.productId !== undefined && typeof transaction.productId !== 'string') ||
    (transaction.basketType !== undefined &&
      transaction.basketType !== 'basic' &&
      transaction.basketType !== 'intermediate' &&
      transaction.basketType !== 'advanced' &&
      transaction.basketType !== 'goods') ||
    (transaction.basicNeedPerPerson !== undefined &&
      !isNonNegativeNumber(transaction.basicNeedPerPerson)) ||
    (transaction.referenceBasketCost !== undefined &&
      !isNonNegativeNumber(transaction.referenceBasketCost)) ||
    (transaction.intermediateBasketCost !== undefined &&
      !isNonNegativeNumber(transaction.intermediateBasketCost)) ||
    (transaction.advancedBasketCost !== undefined &&
      !isNonNegativeNumber(transaction.advancedBasketCost)) ||
    (transaction.calculationBasketCost !== undefined &&
      !isNonNegativeNumber(transaction.calculationBasketCost)) ||
    (transaction.basketBreakdown !== undefined &&
      (!Array.isArray(transaction.basketBreakdown) ||
        !transaction.basketBreakdown.every(isBasketProductBreakdown))) ||
    (transaction.productAveragePrice !== undefined &&
      !isNonNegativeNumber(transaction.productAveragePrice)) ||
    typeof transaction.candidate !== 'object' ||
    transaction.candidate === null
  ) {
    return false;
  }

  const candidate = transaction.candidate as Record<string, unknown>;
  return (
    typeof candidate.shopId === 'string' &&
    isCurrencyAmount(candidate.price) &&
    candidate.price >= MIN_SHOP_PRICE &&
    isNonNegativeNumber(candidate.distance) &&
    (candidate.distanceFactor === undefined ||
      (isFiniteNumber(candidate.distanceFactor) && candidate.distanceFactor > 0)) &&
    isNonNegativeNumber(candidate.desiredQuantity) &&
    isFiniteNumber(candidate.benefit) &&
    isPositiveInteger(candidate.rank) &&
    isNonNegativeInteger(candidate.stockAvailable) &&
    isNonNegativeInteger(candidate.capacityAvailable) &&
    isNonNegativeInteger(candidate.available) &&
    isNonNegativeInteger(candidate.demandBefore) &&
    isNonNegativeInteger(candidate.purchased) &&
    isNonNegativeInteger(candidate.demandAfter) &&
    (candidate.basicNeedPerPerson === undefined ||
      isNonNegativeNumber(candidate.basicNeedPerPerson)) &&
    (candidate.referenceBasketCost === undefined ||
      isNonNegativeNumber(candidate.referenceBasketCost)) &&
    (candidate.intermediateBasketCost === undefined ||
      isNonNegativeNumber(candidate.intermediateBasketCost)) &&
    (candidate.advancedBasketCost === undefined ||
      isNonNegativeNumber(candidate.advancedBasketCost)) &&
    (candidate.calculationBasketCost === undefined ||
      isNonNegativeNumber(candidate.calculationBasketCost)) &&
    (candidate.productAveragePrice === undefined ||
      isNonNegativeNumber(candidate.productAveragePrice)) &&
    (candidate.pf === undefined || isNonNegativeNumber(candidate.pf)) &&
    (candidate.q === undefined || isFiniteNumber(candidate.q)) &&
    (candidate.w === undefined || isFiniteNumber(candidate.w)) &&
    (candidate.errorBenefit === undefined || isFiniteNumber(candidate.errorBenefit)) &&
    (candidate.idealBenefit === undefined || isFiniteNumber(candidate.idealBenefit)) &&
    (candidate.associatedBenefit === undefined ||
      isNonNegativeNumber(candidate.associatedBenefit)) &&
    (candidate.resultShare === undefined ||
      isNonNegativeNumber(candidate.resultShare)) &&
    (candidate.allocatedResidents === undefined ||
      isNonNegativeInteger(candidate.allocatedResidents)) &&
    (candidate.expectedQuantity === undefined ||
      isNonNegativeNumber(candidate.expectedQuantity)) &&
    (candidate.valuesSaturated === undefined ||
      typeof candidate.valuesSaturated === 'boolean') &&
    typeof candidate.outcome === 'string' &&
    SHOP_TRANSACTION_OUTCOMES.has(candidate.outcome as ShopTransactionCandidate['outcome'])
  );
}

function isBasketProductBreakdown(value: unknown): value is BasketProductBreakdown {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === 'string' &&
    isNonNegativeNumber(item.dailyNeedPerPerson) &&
    (item.averagePrice === null || isNonNegativeNumber(item.averagePrice)) &&
    (item.priceSource === 'weighted_sales' ||
      item.priceSource === 'current_shop_prices' ||
      item.priceSource === 'unavailable') &&
    isNonNegativeInteger(item.historicalUnitsSold) &&
    isNonNegativeNumber(item.historicalRevenue) &&
    isNonNegativeInteger(item.currentShopCount) &&
    (item.basketContribution === null || isNonNegativeNumber(item.basketContribution)) &&
    (item.basketType === undefined ||
      item.basketType === 'basic' ||
      item.basketType === 'intermediate' ||
      item.basketType === 'advanced' ||
      item.basketType === 'goods')
  );
}

export function isCommerceDiagnosticsUpdate(value: unknown): value is CommerceDiagnosticsUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const update = value as Record<string, unknown>;
  return (
    update.type === 'commerce_diagnostics' &&
    typeof update.buildingId === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(update.day)) &&
    Array.isArray(update.transactions) &&
    update.transactions.every(isShopResidenceTransaction)
  );
}

export interface StoreSalesPlan {
  purchases: StorePurchase[];
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
    !isCurrencyAmount(salePrice) ||
    salePrice < MIN_SHOP_PRICE ||
    !isCurrencyAmount(employeeExpense) ||
    employeeExpense < 0 ||
    !isCurrencyAmount(productExpense) ||
    productExpense < 0
  ) {
    throw new RangeError('Os valores financeiros diários do comércio são inválidos.');
  }
  const revenue = roundCurrency(unitsSold * salePrice);
  return {
    revenue,
    profitLoss: roundCurrency(revenue - employeeExpense - productExpense),
  };
}

export function getShopDailyFinancials(
  wage: number,
  workers: number,
  unitsSold: number,
  salePrice: number,
): ShopDailyFinancials {
  if (
    !isCurrencyAmount(wage) ||
    wage < 0 ||
    !Number.isInteger(workers) ||
    workers < 0 ||
    !Number.isInteger(unitsSold) ||
    unitsSold < 0 ||
    !isCurrencyAmount(salePrice) ||
    salePrice < MIN_SHOP_PRICE
  ) {
    throw new RangeError('Os valores financeiros diários do comércio são inválidos.');
  }
  const employeeExpense = roundCurrency(wage * workers);
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
    !isCurrencyAmount(price) ||
    price < MIN_SHOP_PRICE ||
    price > MAX_SHOP_PRICE
  ) {
    return null;
  }
  return roundCurrency(price);
}

export function getShopSalesCapacity(
  type: ResidenceType,
  dailyWorkPoints: number,
  workers = 0,
): number {
  if (!Number.isFinite(dailyWorkPoints) || dailyWorkPoints < 0) {
    throw new RangeError('Work Points diários inválidos para calcular a capacidade de vendas.');
  }
  const definition = getResidenceDefinition(type);
  if (definition?.salesPerWorkerPerDay !== undefined) {
    if (!Number.isInteger(workers) || workers < 0) {
      throw new RangeError('Quantidade de funcionários inválida para calcular a capacidade de vendas.');
    }
    return workers * definition.salesPerWorkerPerDay;
  }
  const workPointsPerUnit = definition?.salesWorkPointsPerUnit ?? (() => {
    switch (type) {
      case 'shop_rice':
      case 'shop_potato':
      case 'shop_corn':
      case 'shop_barley':
      case 'shop_wheat':
      case 'shop_butcher':
      case 'shop_fish':
      case 'shop_sugar':
      case 'shop_vegetables':
      case 'shop_salt':
      case 'shop_spices':
        return SHOP_SALES_WORK_POINTS_PER_UNIT;
      case 'shop_milk':
        return MILK_SALES_WORK_POINTS_PER_LITER;
      default:
        throw new RangeError('Tipo inválido para calcular a capacidade diária de vendas.');
    }
  })();
  return Math.floor(dailyWorkPoints / workPointsPerUnit);
}

export function getCityProductKey(cityId: string, productId: string): string {
  return `${cityId}\u0000${productId}`;
}

export function getCityProductAveragePrices(
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): Map<string, number> {
  const weightedSales = new Map<string, { revenue: number; units: number }>();
  for (const sale of history) {
    if (
      !Number.isInteger(sale.unitsSold) ||
      sale.unitsSold < 0 ||
      !isCurrencyAmount(sale.price) ||
      sale.price < MIN_SHOP_PRICE
    ) {
      throw new RangeError('O histórico mensal de preços contém uma venda inválida.');
    }
    if (sale.unitsSold === 0) continue;
    const key = getCityProductKey(sale.cityId, sale.productId);
    const totals = weightedSales.get(key) ?? { revenue: 0, units: 0 };
    totals.revenue += sale.unitsSold * sale.price;
    totals.units += sale.unitsSold;
    weightedSales.set(key, totals);
  }

  const currentPrices = new Map<string, { total: number; count: number }>();
  for (const shop of shops) {
    if (!isCurrencyAmount(shop.price) || shop.price < MIN_SHOP_PRICE) {
      throw new RangeError('Uma loja possui um preço inválido ao calcular a média da cidade.');
    }
    const key = getCityProductKey(shop.cityId, shop.productId);
    const totals = currentPrices.get(key) ?? { total: 0, count: 0 };
    totals.total += shop.price;
    totals.count += 1;
    currentPrices.set(key, totals);
  }

  const averagePrices = new Map<string, number>();
  for (const [key, totals] of weightedSales) {
    averagePrices.set(key, totals.revenue / totals.units);
  }
  for (const [key, totals] of currentPrices) {
    if (!averagePrices.has(key)) averagePrices.set(key, totals.total / totals.count);
  }
  return averagePrices;
}

export function getBasicBasketCost(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
): number {
  return getBasicBasketBreakdown(cityId, demandByProduct, averagePrices, [], []).reduce(
    (total, item) => total + (item.basketContribution ?? 0),
    0,
  );
}

export function getIntermediateBasketCost(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
): number {
  return getIntermediateBasketBreakdown(cityId, demandByProduct, averagePrices, [], []).reduce(
    (total, item) => total + (item.basketContribution ?? 0),
    0,
  );
}

function getBasketBreakdownForProducts(
  productIds: readonly string[],
  basketType: BasketType,
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return productIds.map((productId) => {
    const demand = demandByProduct.get(productId);
    if (demand === undefined) {
      throw new Error(`A demanda não está configurada para ${productId}.`);
    }
    const key = getCityProductKey(cityId, productId);
    const sales = history.filter((sale) => getCityProductKey(sale.cityId, sale.productId) === key);
    const historicalUnitsSold = sales.reduce((total, sale) => total + sale.unitsSold, 0);
    const historicalRevenue = sales.reduce(
      (total, sale) => total + sale.unitsSold * sale.price,
      0,
    );
    const currentProductShops = shops.filter(
      (shop) => getCityProductKey(shop.cityId, shop.productId) === key,
    );
    const averagePrice = averagePrices.get(key);
    const priceSource: BasketProductBreakdown['priceSource'] =
      historicalUnitsSold > 0
        ? 'weighted_sales'
        : currentProductShops.length > 0
          ? 'current_shop_prices'
          : 'unavailable';
    const availablePrice = averagePrice ?? null;

    return {
      productId,
      dailyNeedPerPerson: demand,
      averagePrice: availablePrice,
      priceSource,
      historicalUnitsSold,
      historicalRevenue,
      currentShopCount: currentProductShops.length,
      basketContribution: availablePrice === null ? null : demand * availablePrice,
      basketType,
    };
  });
}

export function getBasicBasketBreakdown(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return getBasketBreakdownForProducts(
    BASIC_BASKET_PRODUCT_IDS,
    'basic',
    cityId,
    demandByProduct,
    averagePrices,
    shops,
    history,
  );
}

export function getIntermediateBasketBreakdown(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return getBasketBreakdownForProducts(
    INTERMEDIATE_BASKET_PRODUCT_IDS,
    'intermediate',
    cityId,
    demandByProduct,
    averagePrices,
    shops,
    history,
  );
}

export function getAdvancedBasketBreakdown(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return getBasketBreakdownForProducts(
    ADVANCED_BASKET_PRODUCT_IDS,
    'advanced',
    cityId,
    demandByProduct,
    averagePrices,
    shops,
    history,
  );
}

export function getGoodsBasketBreakdown(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return getBasketBreakdownForProducts(
    GOODS_BASKET_PRODUCT_IDS,
    'goods',
    cityId,
    demandByProduct,
    averagePrices,
    shops,
    history,
  );
}

export function getBasketBreakdown(
  cityId: string,
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  shops: Pick<SalesShop, 'cityId' | 'productId' | 'price'>[],
  history: CityProductSale[],
): BasketProductBreakdown[] {
  return [
    ...getBasicBasketBreakdown(cityId, demandByProduct, averagePrices, shops, history),
    ...getIntermediateBasketBreakdown(cityId, demandByProduct, averagePrices, shops, history),
    ...getAdvancedBasketBreakdown(cityId, demandByProduct, averagePrices, shops, history),
    ...getGoodsBasketBreakdown(cityId, demandByProduct, averagePrices, shops, history),
  ];
}

export interface PurchaseBenefitCalculation {
  pf: number;
  distanceFactor: number;
  q: number;
  w: number;
  errorBenefit: number;
  idealBenefit: number;
  associatedBenefit: number;
  logAssociatedBenefit: number;
  valuesSaturated: boolean;
}

function boundedDiagnosticValue(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(-MAX_DIAGNOSTIC_VALUE, Math.min(MAX_DIAGNOSTIC_VALUE, value));
}

function boundedExponential(log: number): number {
  if (log >= Math.log(MAX_DIAGNOSTIC_VALUE)) return MAX_DIAGNOSTIC_VALUE;
  if (log <= Math.log(Number.MIN_VALUE)) return 0;
  return Math.exp(log);
}

function logMagnitude(value: number): number {
  if (value === 0) return Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(value)) return Math.log(MAX_DIAGNOSTIC_VALUE);
  return Math.min(Math.log(MAX_DIAGNOSTIC_VALUE), Math.log(Math.abs(value)));
}

function boundedPower(value: number, exponent: number): number {
  if (value === 0) return 0;
  const magnitude = boundedExponential(exponent * logMagnitude(value));
  return Number.isInteger(exponent) && exponent % 2 === 1 ? Math.sign(value) * magnitude : magnitude;
}

function logAbsolutePositiveSum(logPositiveTerm: number, other: number): number {
  if (other === 0) return logPositiveTerm;
  const logOther = Math.log(Math.abs(other));
  if (other > 0) {
    const max = Math.max(logPositiveTerm, logOther);
    const min = Math.min(logPositiveTerm, logOther);
    return max + Math.log1p(Math.exp(min - max));
  }
  if (logPositiveTerm === logOther) return Number.NEGATIVE_INFINITY;
  const max = Math.max(logPositiveTerm, logOther);
  const min = Math.min(logPositiveTerm, logOther);
  return max + Math.log1p(-Math.exp(min - max));
}

function getExpectedStoreDemand(
  allocatedResidents: number,
  basicNeedPerPerson: number,
  logAssociatedBenefit: number,
): number {
  if (
    allocatedResidents === 0 ||
    basicNeedPerPerson === 0 ||
    logAssociatedBenefit === Number.NEGATIVE_INFINITY
  ) {
    return 0;
  }
  return boundedExponential(
    Math.log(allocatedResidents) +
      Math.log(basicNeedPerPerson) +
      logAssociatedBenefit,
  );
}

export function getPurchaseBenefitCalculation(
  income: number,
  price: number,
  basicNeedPerPerson: number,
  referenceBasketCost: number,
  distance: number,
  options: {
    basketType?: BasketType;
    intermediateBasketCost?: number;
    advancedBasketCost?: number;
  } = {},
): PurchaseBenefitCalculation {
  if (
    !Number.isFinite(income) ||
    income < 0 ||
    !Number.isFinite(price) ||
    price < MIN_SHOP_PRICE ||
    !Number.isFinite(basicNeedPerPerson) ||
    basicNeedPerPerson < 0 ||
    !Number.isFinite(referenceBasketCost) ||
    referenceBasketCost < 0 ||
    !Number.isFinite(distance) ||
    distance < 0
  ) {
    throw new RangeError('Os valores da cesta básica para calcular o benefício são inválidos.');
  }

  const pf = price * basicNeedPerPerson;
  const { radiusTiles, radicandNumerator } = GAME_RULES.consumption.distance;
  const distanceFactor = Math.sqrt(radicandNumerator / (radiusTiles + distance));
  if (options.basketType === 'goods') {
    const formula = GAME_RULES.consumption.goods;
    const intermediateBasketCost = options.intermediateBasketCost ?? 0;
    const advancedBasketCost = options.advancedBasketCost ?? 0;
    const combinedBasketCost = referenceBasketCost + intermediateBasketCost + advancedBasketCost;
    if (
      !Number.isFinite(intermediateBasketCost) ||
      intermediateBasketCost < 0 ||
      !Number.isFinite(advancedBasketCost) ||
      advancedBasketCost < 0 ||
      !Number.isFinite(combinedBasketCost)
    ) {
      throw new RangeError('O custo total das cestas básicas é inválido.');
    }
    if (income === 0 || combinedBasketCost === 0) {
      return {
        pf,
        distanceFactor,
        q: 0,
        w: 0,
        errorBenefit: 0,
        idealBenefit: 0,
        associatedBenefit: 0,
        logAssociatedBenefit: Number.NEGATIVE_INFINITY,
        valuesSaturated: false,
      };
    }

    const w = (1 - pf / combinedBasketCost) ** formula.wExponent;
    const rawQ = Math.expm1(w * Math.log(formula.discountBase)) * income;
    const q = boundedDiagnosticValue(rawQ);
    const idealBase =
      income / combinedBasketCost -
      1 / (formula.idealBasketIncomeOffsetDivisor * combinedBasketCost) +
      formula.idealConstantOffset;
    const idealBenefit = boundedPower(idealBase, formula.idealExponent);
    const errorBase =
      income <= combinedBasketCost / formula.incomeBasketThresholdDivisor
        ? 0
        : (income - pf - q) / combinedBasketCost;
    const errorBenefit = boundedDiagnosticValue(
      distanceFactor * boundedPower(errorBase, formula.errorExponent),
    );
    const logAssociatedBenefit =
      errorBase === 0 || idealBase === 0
        ? Number.NEGATIVE_INFINITY
        : formula.associatedBenefitExponent *
          (Math.log(distanceFactor) +
            formula.errorExponent * logMagnitude(errorBase) -
            formula.idealExponent * logMagnitude(idealBase));
    const associatedBenefit = boundedExponential(logAssociatedBenefit);
    const valuesSaturated =
      !Number.isFinite(rawQ) ||
      Math.abs(rawQ) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(w) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(errorBenefit) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(idealBenefit) >= MAX_DIAGNOSTIC_VALUE ||
      associatedBenefit === MAX_DIAGNOSTIC_VALUE;
    return {
      pf,
      distanceFactor,
      q,
      w: boundedDiagnosticValue(w),
      errorBenefit,
      idealBenefit,
      associatedBenefit,
      logAssociatedBenefit,
      valuesSaturated,
    };
  }

  if (options.basketType === 'intermediate' || options.basketType === 'advanced') {
    const isAdvanced = options.basketType === 'advanced';
    const formula = isAdvanced
      ? GAME_RULES.consumption.advanced
      : GAME_RULES.consumption.intermediate;
    const intermediateBasketCost = options.intermediateBasketCost ?? 0;
    const advancedBasketCost = options.advancedBasketCost ?? 0;
    const combinedBasketCost =
      referenceBasketCost + intermediateBasketCost + (isAdvanced ? advancedBasketCost : 0);
    if (
      !Number.isFinite(intermediateBasketCost) ||
      intermediateBasketCost < 0 ||
      !Number.isFinite(advancedBasketCost) ||
      advancedBasketCost < 0 ||
      !Number.isFinite(combinedBasketCost)
    ) {
      throw new RangeError('O custo da cesta intermediária é inválido.');
    }
    if (income === 0 || combinedBasketCost === 0) {
      return {
        pf,
        distanceFactor,
        q: 0,
        w: 0,
        errorBenefit: 0,
        idealBenefit: 0,
        associatedBenefit: 0,
        logAssociatedBenefit: Number.NEGATIVE_INFINITY,
        valuesSaturated: false,
      };
    }

    const w = (1 - pf / combinedBasketCost) ** formula.wExponent;
    const rawQ = Math.expm1(w * Math.log(formula.discountBase)) * income;
    const q = boundedDiagnosticValue(rawQ);
    const idealBase =
      (income - formula.idealIncomeOffset) / combinedBasketCost -
      1 / formula.idealBasketDivisor;
    const idealBenefit = boundedPower(idealBase, formula.idealExponent);
    const advancedThreshold =
      isAdvanced
        ? advancedBasketCost / GAME_RULES.consumption.advanced.advancedBasketThresholdDivisor
        : 0;
    const threshold =
      referenceBasketCost / formula.basicBasketThresholdDivisor +
      intermediateBasketCost / formula.intermediateBasketThresholdDivisor +
      advancedThreshold;
    const eligible =
      income > pf + formula.minimumIncomeAboveProductCost && income > threshold;
    const errorBase = eligible
      ? (income - pf - q) / combinedBasketCost
      : 0;
    const errorBenefit = boundedDiagnosticValue(
      distanceFactor * boundedPower(errorBase, formula.errorExponent),
    );
    const logAssociatedBenefit =
      errorBase === 0 || idealBase === 0
        ? Number.NEGATIVE_INFINITY
        : GAME_RULES.consumption.associatedBenefitExponent *
          (Math.log(distanceFactor) +
            formula.errorExponent * logMagnitude(errorBase) -
            formula.idealExponent * logMagnitude(idealBase));
    const associatedBenefit = boundedExponential(logAssociatedBenefit);
    const valuesSaturated =
      !Number.isFinite(rawQ) ||
      Math.abs(rawQ) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(w) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(errorBenefit) >= MAX_DIAGNOSTIC_VALUE ||
      Math.abs(idealBenefit) >= MAX_DIAGNOSTIC_VALUE ||
      associatedBenefit === MAX_DIAGNOSTIC_VALUE;
    return {
      pf,
      distanceFactor,
      q,
      w: boundedDiagnosticValue(w),
      errorBenefit,
      idealBenefit,
      associatedBenefit,
      logAssociatedBenefit,
      valuesSaturated,
    };
  }

  if (income === 0 || referenceBasketCost === 0) {
    return {
      pf,
      distanceFactor,
      q: 0,
      w: 0,
      errorBenefit: 0,
      idealBenefit: 0,
      associatedBenefit: 0,
      logAssociatedBenefit: Number.NEGATIVE_INFINITY,
      valuesSaturated: false,
    };
  }

  const formula = GAME_RULES.consumption.basic;
  const associatedExponent = GAME_RULES.consumption.associatedBenefitExponent;
  const w = (1 - pf / referenceBasketCost) ** formula.wExponent;
  const idealNumerator = income - formula.idealIncomeOffset;
  const idealBase = idealNumerator / referenceBasketCost;
  const logIdealBase =
    idealNumerator === 0
      ? Number.NEGATIVE_INFINITY
      : Math.log(Math.abs(idealNumerator)) - Math.log(referenceBasketCost);
  const directIdealBenefit = Math.abs(idealBase) ** formula.idealExponent;
  const idealBenefit =
    Number.isFinite(directIdealBenefit) && directIdealBenefit <= MAX_DIAGNOSTIC_VALUE
      ? directIdealBenefit
      : boundedExponential(formula.idealExponent * logIdealBase);
  const q = Math.expm1(w * Math.log(formula.discountBase)) * income;
  const qSaturated =
    !Number.isFinite(q) || Math.abs(q) >= MAX_DIAGNOSTIC_VALUE;
  const wSaturated = !Number.isFinite(w) || Math.abs(w) >= MAX_DIAGNOSTIC_VALUE;
  if (
    income < pf * formula.minimumIncomePriceMultiplier ||
    logIdealBase === Number.NEGATIVE_INFINITY ||
    idealBenefit === 0
  ) {
    return {
      pf,
      distanceFactor,
      q: boundedDiagnosticValue(q),
      w: boundedDiagnosticValue(w),
      errorBenefit: 0,
      idealBenefit,
      associatedBenefit: 0,
      logAssociatedBenefit: Number.NEGATIVE_INFINITY,
      valuesSaturated: qSaturated || wSaturated || idealBenefit === MAX_DIAGNOSTIC_VALUE,
    };
  }

  const preAdjustment = income - pf;
  const logRawErrorBase =
    preAdjustment === 0
      ? q === 0
        ? Number.NEGATIVE_INFINITY
        : Math.log(-q)
      : logAbsolutePositiveSum(Math.log(preAdjustment), -q);
  const logErrorBase =
    logRawErrorBase === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : logRawErrorBase - Math.log(referenceBasketCost);
  const logDistanceFactor = Math.log(distanceFactor);
  const errorBenefit = boundedExponential(
    logDistanceFactor + formula.errorExponent * logErrorBase,
  );
  const logAssociatedBenefit =
    logErrorBase === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : associatedExponent *
        (logDistanceFactor +
          formula.errorExponent * logErrorBase -
          formula.idealExponent * logIdealBase);
  const associatedBenefit =
    logAssociatedBenefit === Number.POSITIVE_INFINITY
      ? MAX_DIAGNOSTIC_VALUE
      : logAssociatedBenefit === Number.NEGATIVE_INFINITY
        ? 0
        : boundedExponential(logAssociatedBenefit);
  const valuesSaturated =
    qSaturated ||
    wSaturated ||
    errorBenefit === MAX_DIAGNOSTIC_VALUE ||
    idealBenefit === MAX_DIAGNOSTIC_VALUE ||
    associatedBenefit === MAX_DIAGNOSTIC_VALUE;

  return {
    pf,
    distanceFactor,
    q: boundedDiagnosticValue(q),
    w: boundedDiagnosticValue(w),
    errorBenefit,
    idealBenefit,
    associatedBenefit,
    logAssociatedBenefit,
    valuesSaturated,
  };
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
 * Distribui moradores entre lojas por produto, proporcionalmente ao benefício
 * associado, e limita as compras pelo estoque e capacidade diários.
 */
export function planShopSales(
  residences: SalesResidence[],
  shops: SalesShop[],
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  random: () => number = Math.random,
  history: CityProductSale[] = [],
): StorePurchase[] {
  return planShopSalesDetailed(
    residences,
    shops,
    demandByProduct,
    averagePrices,
    random,
    history,
  ).purchases;
}

export function planShopSalesDetailed(
  residences: SalesResidence[],
  shops: SalesShop[],
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  random: () => number = Math.random,
  history: CityProductSale[] = [],
): StoreSalesPlan {
  const remainingStock = new Map(shops.map((shop) => [shop.id, shop.stock]));
  const remainingCapacity = new Map(shops.map((shop) => [shop.id, shop.capacity]));
  const purchases: StorePurchase[] = [];
  const transactionsByShop = new Map<string, ShopResidenceTransaction[]>(
    shops.map((shop) => [shop.id, []]),
  );
  const sortedResidences = [...residences].sort(
    (a, b) => b.wellbeing - a.wellbeing || a.id.localeCompare(b.id),
  );
  const basketBreakdownByCity = new Map<string, BasketProductBreakdown[]>();
  for (const residence of sortedResidences) {
    if (!basketBreakdownByCity.has(residence.cityId)) {
      basketBreakdownByCity.set(
        residence.cityId,
        getBasketBreakdown(
          residence.cityId,
          demandByProduct,
          averagePrices,
          shops,
          history,
        ),
      );
    }
  }
  for (const productId of CONSUMPTION_PRODUCT_IDS) {
    const basicNeedPerPerson = demandByProduct.get(productId);
    if (basicNeedPerPerson === undefined) {
      throw new Error(`A demanda básica não está configurada para ${productId}.`);
    }
    const productShops = shops.filter((shop) => shop.productId === productId);
    for (const residence of sortedResidences) {
      if (residence.consumers <= 0) continue;
      const nearby = productShops.filter(
        (shop) =>
          getDistanceBetweenBuildings(shop, residence) <=
          GAME_RULES.consumption.distance.radiusTiles,
      );
      if (nearby.length === 0) continue;

      const basketBreakdown = basketBreakdownByCity.get(residence.cityId);
      if (!basketBreakdown) {
        throw new Error(`Não foi possível calcular a cesta da cidade ${residence.cityId}.`);
      }
      const referenceBasketCost = basketBreakdown.reduce(
        (total, item) =>
          total + (item.basketType === 'basic' ? item.basketContribution ?? 0 : 0),
        0,
      );
      const intermediateBasketCost = basketBreakdown.reduce(
        (total, item) =>
          total + (item.basketType === 'intermediate' ? item.basketContribution ?? 0 : 0),
        0,
      );
      const advancedBasketCost = basketBreakdown.reduce(
        (total, item) =>
          total + (item.basketType === 'advanced' ? item.basketContribution ?? 0 : 0),
        0,
      );
      const basketType: BasketType = (GOODS_BASKET_PRODUCT_IDS as readonly string[]).includes(productId)
        ? 'goods'
        : (ADVANCED_BASKET_PRODUCT_IDS as readonly string[]).includes(productId)
          ? 'advanced'
          : (INTERMEDIATE_BASKET_PRODUCT_IDS as readonly string[]).includes(productId)
            ? 'intermediate'
            : 'basic';
      const calculationBasketCost =
        basketType === 'goods' || basketType === 'advanced'
          ? referenceBasketCost + intermediateBasketCost + advancedBasketCost
          : basketType === 'intermediate'
            ? referenceBasketCost + intermediateBasketCost
          : referenceBasketCost;
      const productAveragePrice =
        averagePrices.get(getCityProductKey(residence.cityId, productId)) ?? 0;
      const candidates = nearby.map((shop) => {
        const distance = getDistanceBetweenBuildings(shop, residence);
        const calculation = getPurchaseBenefitCalculation(
          residence.averageIncome,
          shop.price,
          basicNeedPerPerson,
          referenceBasketCost,
          distance,
          { basketType, intermediateBasketCost, advancedBasketCost },
        );
        return { shop, distance, calculation, resultShare: 0, allocatedResidents: 0 };
      });

      const infiniteCandidates = candidates.filter(
        ({ calculation }) => calculation.logAssociatedBenefit === Number.POSITIVE_INFINITY,
      );
      if (infiniteCandidates.length > 0) {
        const share = 1 / infiniteCandidates.length;
        for (const candidate of infiniteCandidates) candidate.resultShare = share;
      } else {
        const maxLog = Math.max(...candidates.map(({ calculation }) => calculation.logAssociatedBenefit));
        if (Number.isFinite(maxLog)) {
          const weights = candidates.map(({ calculation }) =>
            calculation.logAssociatedBenefit === Number.NEGATIVE_INFINITY
              ? 0
              : Math.exp(calculation.logAssociatedBenefit - maxLog),
          );
          const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
          candidates.forEach((candidate, index) => {
            candidate.resultShare = weights[index] / totalWeight;
          });
        }
      }

      const eligible = candidates.filter((candidate) => candidate.resultShare > 0);
      if (eligible.length > 0) {
        let allocated = 0;
        const fractions = eligible
          .map((candidate) => {
            const exact = residence.consumers * candidate.resultShare;
            candidate.allocatedResidents = Math.floor(exact);
            allocated += candidate.allocatedResidents;
            return { candidate, fraction: exact - candidate.allocatedResidents };
          })
          .sort(
            (a, b) =>
              b.fraction - a.fraction ||
              a.candidate.shop.id.localeCompare(b.candidate.shop.id),
          );
        for (let index = 0; index < residence.consumers - allocated; index += 1) {
          fractions[index % fractions.length].candidate.allocatedResidents += 1;
        }
      }

      const ranked = [...candidates].sort(
        (a, b) =>
          b.resultShare - a.resultShare ||
          a.shop.id.localeCompare(b.shop.id),
      );
      let totalDesired = 0;
      const residenceTransactions: {
        shopId: string;
        transaction: ShopResidenceTransaction;
      }[] = [];
      for (const [index, candidate] of ranked.entries()) {
        const expectedQuantity = Math.min(
          MAX_DIAGNOSTIC_VALUE,
          getExpectedStoreDemand(
            candidate.allocatedResidents,
            basicNeedPerPerson,
            candidate.calculation.logAssociatedBenefit,
          ),
        );
        const whole = Math.floor(expectedQuantity);
        const fractional = expectedQuantity - whole;
        const randomValue = fractional > 0 ? random() : 1;
        if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
          throw new RangeError('A fonte de arredondamento da demanda retornou um valor inválido.');
        }
        const desiredQuantity = whole + (randomValue < fractional ? 1 : 0);
        totalDesired += desiredQuantity;
        const stockAvailable = remainingStock.get(candidate.shop.id) ?? 0;
        const capacityAvailable = remainingCapacity.get(candidate.shop.id) ?? 0;
        const available = Math.min(stockAvailable, capacityAvailable);
        const purchased = Math.min(desiredQuantity, available);
        const demandAfter = desiredQuantity - purchased;
        if (purchased > 0) {
          remainingStock.set(candidate.shop.id, stockAvailable - purchased);
          remainingCapacity.set(candidate.shop.id, capacityAvailable - purchased);
          purchases.push({
            shopId: candidate.shop.id,
            residenceId: residence.id,
            productId,
            quantity: purchased,
          });
        }
        const outcome =
          purchased > 0
            ? 'purchased'
            : candidate.calculation.associatedBenefit === 0
              ? 'negative_benefit'
              : desiredQuantity === 0
                ? 'demand_fulfilled'
                : stockAvailable <= 0 && capacityAvailable <= 0
                  ? 'no_stock_or_capacity'
                  : stockAvailable <= 0
                    ? 'no_stock'
                    : 'no_capacity';
        const boundedAssociated = candidate.calculation.associatedBenefit;
        const transaction: ShopResidenceTransaction = {
          residenceId: residence.id,
          occupants: candidate.allocatedResidents,
          averageIncome: residence.averageIncome,
          areaAveragePrice: productAveragePrice,
          expectedDemand: residence.consumers * basicNeedPerPerson,
          desiredQuantity: totalDesired,
          productId,
          basketType,
          basicNeedPerPerson,
          referenceBasketCost,
          intermediateBasketCost,
          advancedBasketCost,
          calculationBasketCost,
          basketBreakdown,
          productAveragePrice,
          candidate: {
            shopId: candidate.shop.id,
            price: candidate.shop.price,
            distance: candidate.distance,
            distanceFactor: candidate.calculation.distanceFactor,
            desiredQuantity: expectedQuantity,
            benefit: boundedAssociated,
            rank: index + 1,
            stockAvailable,
            capacityAvailable,
            available,
            demandBefore: desiredQuantity,
            purchased,
            demandAfter,
            basicNeedPerPerson,
            referenceBasketCost,
            intermediateBasketCost,
            advancedBasketCost,
            calculationBasketCost,
            productAveragePrice,
            pf: candidate.calculation.pf,
            q: candidate.calculation.q,
            w: candidate.calculation.w,
            errorBenefit: candidate.calculation.errorBenefit,
            idealBenefit: candidate.calculation.idealBenefit,
            associatedBenefit: boundedAssociated,
            resultShare: candidate.resultShare,
            allocatedResidents: candidate.allocatedResidents,
            expectedQuantity,
            valuesSaturated: candidate.calculation.valuesSaturated,
            outcome,
          },
        };
        residenceTransactions.push({ shopId: candidate.shop.id, transaction });
      }
      for (const { shopId, transaction } of residenceTransactions) {
        const shopTransactions = transactionsByShop.get(shopId);
        if (!shopTransactions) {
          throw new Error(`Não foi possível associar o diagnóstico à loja ${shopId}.`);
        }
        shopTransactions.push({ ...transaction, desiredQuantity: totalDesired });
      }
    }
  }
  return { purchases, transactionsByShop };
}
