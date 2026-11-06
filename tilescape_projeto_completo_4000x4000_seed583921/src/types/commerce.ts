import { getResidenceDefinition, isWithinWorkerSearchRadius, type ResidenceType } from './residence.js';
import { BASIC_BASKET_PRODUCT_IDS } from './commerceDemand.js';

export const DEFAULT_SHOP_PRICE = 10;
export const MIN_SHOP_PRICE = 1;
export const MAX_SHOP_PRICE = 100000;
// A cada 100 Work Points gerados no dia, a loja ganha 5 unidades de capacidade de venda.
export const SALES_PER_100_WORK_POINTS = 5;
const MAX_DIAGNOSTIC_VALUE = Number.MAX_SAFE_INTEGER;

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
  occupants: number;
  averageIncome: number;
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
  basicNeedPerPerson?: number;
  referenceBasketCost?: number;
  productAveragePrice?: number;
  candidate: ShopTransactionCandidate;
}

export interface CommerceDiagnosticsUpdate {
  type: 'commerce_diagnostics';
  buildingId: string;
  day: string;
  transactions: ShopResidenceTransaction[];
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
    (transaction.basicNeedPerPerson !== undefined &&
      !isNonNegativeNumber(transaction.basicNeedPerPerson)) ||
    (transaction.referenceBasketCost !== undefined &&
      !isNonNegativeNumber(transaction.referenceBasketCost)) ||
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
    isPositiveInteger(candidate.price) &&
    isNonNegativeNumber(candidate.distance) &&
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
    (candidate.productAveragePrice === undefined ||
      isNonNegativeNumber(candidate.productAveragePrice)) &&
    (candidate.pf === undefined || isNonNegativeNumber(candidate.pf)) &&
    (candidate.q === undefined || isFiniteNumber(candidate.q)) &&
    (candidate.w === undefined || isFiniteNumber(candidate.w)) &&
    (candidate.errorBenefit === undefined ||
      isNonNegativeNumber(candidate.errorBenefit)) &&
    (candidate.idealBenefit === undefined ||
      isNonNegativeNumber(candidate.idealBenefit)) &&
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
      !Number.isFinite(sale.price) ||
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
    if (!Number.isFinite(shop.price) || shop.price < MIN_SHOP_PRICE) {
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
  let total = 0;
  for (const productId of BASIC_BASKET_PRODUCT_IDS) {
    const demand = demandByProduct.get(productId);
    if (demand === undefined) {
      throw new Error(`A demanda básica não está configurada para ${productId}.`);
    }
    const averagePrice = averagePrices.get(getCityProductKey(cityId, productId));
    if (averagePrice === undefined) continue;
    total += demand * averagePrice;
  }
  return total;
}

export interface PurchaseBenefitCalculation {
  pf: number;
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
): PurchaseBenefitCalculation {
  if (
    !Number.isFinite(income) ||
    income < 0 ||
    !Number.isFinite(price) ||
    price < MIN_SHOP_PRICE ||
    !Number.isFinite(basicNeedPerPerson) ||
    basicNeedPerPerson < 0 ||
    !Number.isFinite(referenceBasketCost) ||
    referenceBasketCost < 0
  ) {
    throw new RangeError('Os valores da cesta básica para calcular o benefício são inválidos.');
  }

  const pf = price * basicNeedPerPerson;
  if (income === 0 || referenceBasketCost === 0) {
    return {
      pf,
      q: 0,
      w: 0,
      errorBenefit: 0,
      idealBenefit: 0,
      associatedBenefit: 0,
      logAssociatedBenefit: Number.NEGATIVE_INFINITY,
      valuesSaturated: false,
    };
  }

  const w = (1 - (pf * referenceBasketCost) / income) ** 9;
  const idealNumerator = income - 0.125;
  const idealBase = idealNumerator / referenceBasketCost;
  const logIdealBase =
    idealNumerator === 0
      ? Number.NEGATIVE_INFINITY
      : Math.log(Math.abs(idealNumerator)) - Math.log(referenceBasketCost);
  const directIdealBenefit = idealBase ** 4;
  const idealBenefit =
    Number.isFinite(directIdealBenefit) && directIdealBenefit <= MAX_DIAGNOSTIC_VALUE
      ? directIdealBenefit
      : boundedExponential(4 * logIdealBase);
  const negativeWExponent = w < 0 ? -w * Math.log(1.25) : 0;
  const qLog =
    w < 0
      ? negativeWExponent + Math.log(income) - Math.log(referenceBasketCost)
      : Number.NEGATIVE_INFINITY;
  const q =
    w < 0
      ? negativeWExponent < 50
        ? Math.expm1(negativeWExponent) * (income / referenceBasketCost)
        : boundedExponential(qLog)
      : (0.8 ** w - 1) * (income / referenceBasketCost);
  const qSaturated =
    !Number.isFinite(q) || Math.abs(q) >= MAX_DIAGNOSTIC_VALUE;
  const wSaturated = !Number.isFinite(w) || Math.abs(w) >= MAX_DIAGNOSTIC_VALUE;
  if (income < pf || logIdealBase === Number.NEGATIVE_INFINITY || idealBenefit === 0) {
    return {
      pf,
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
  const errorBase = preAdjustment + q;
  const logRawErrorBase =
    w < 0
      ? logAbsolutePositiveSum(qLog, preAdjustment)
      : errorBase === 0
        ? Number.NEGATIVE_INFINITY
        : Math.log(Math.abs(errorBase));
  const logErrorBase =
    logRawErrorBase === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : logRawErrorBase - Math.log(referenceBasketCost);
  const errorBenefit = boundedExponential(4 * logErrorBase);
  const logAssociatedBenefit =
    logErrorBase === Number.NEGATIVE_INFINITY
      ? Number.NEGATIVE_INFINITY
      : 16 * (logErrorBase - logIdealBase);
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
): StorePurchase[] {
  return planShopSalesDetailed(residences, shops, demandByProduct, averagePrices, random).purchases;
}

export function planShopSalesDetailed(
  residences: SalesResidence[],
  shops: SalesShop[],
  demandByProduct: ReadonlyMap<string, number>,
  averagePrices: ReadonlyMap<string, number>,
  random: () => number = Math.random,
): StoreSalesPlan {
  const remainingStock = new Map(shops.map((shop) => [shop.id, shop.stock]));
  const remainingCapacity = new Map(shops.map((shop) => [shop.id, shop.capacity]));
  const purchases: StorePurchase[] = [];
  const transactionsByShop = new Map<string, ShopResidenceTransaction[]>(
    shops.map((shop) => [shop.id, []]),
  );
  const sortedResidences = [...residences].sort((a, b) => a.id.localeCompare(b.id));
  for (const productId of BASIC_BASKET_PRODUCT_IDS) {
    const basicNeedPerPerson = demandByProduct.get(productId);
    if (basicNeedPerPerson === undefined) {
      throw new Error(`A demanda básica não está configurada para ${productId}.`);
    }
    const productShops = shops.filter((shop) => shop.productId === productId);
    for (const residence of sortedResidences) {
      if (residence.occupants <= 0) continue;
      const nearby = productShops.filter(
        (shop) => isWithinWorkerSearchRadius(shop, residence),
      );
      if (nearby.length === 0) continue;

      const referenceBasketCost = getBasicBasketCost(
        residence.cityId,
        demandByProduct,
        averagePrices,
      );
      const productAveragePrice =
        averagePrices.get(getCityProductKey(residence.cityId, productId)) ?? 0;
      const candidates = nearby.map((shop) => {
        const distance = getDistanceBetweenBuildings(shop, residence);
        const calculation = getPurchaseBenefitCalculation(
          residence.averageIncome,
          shop.price,
          basicNeedPerPerson,
          referenceBasketCost,
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
            const exact = residence.occupants * candidate.resultShare;
            candidate.allocatedResidents = Math.floor(exact);
            allocated += candidate.allocatedResidents;
            return { candidate, fraction: exact - candidate.allocatedResidents };
          })
          .sort(
            (a, b) =>
              b.fraction - a.fraction ||
              a.candidate.shop.id.localeCompare(b.candidate.shop.id),
          );
        for (let index = 0; index < residence.occupants - allocated; index += 1) {
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
          occupants: residence.occupants,
          averageIncome: residence.averageIncome,
          areaAveragePrice: productAveragePrice,
          expectedDemand: residence.occupants * basicNeedPerPerson,
          desiredQuantity: totalDesired,
          productId,
          basicNeedPerPerson,
          referenceBasketCost,
          productAveragePrice,
          candidate: {
            shopId: candidate.shop.id,
            price: candidate.shop.price,
            distance: candidate.distance,
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
