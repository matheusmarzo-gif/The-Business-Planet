import { RESIDENCES, type ResidenceType } from './residence.js';
import { roundCurrency } from './currency.js';

export const ACCOUNTING_PERIOD_DAYS = [1, 7, 30] as const;
export type AccountingPeriodDays = (typeof ACCOUNTING_PERIOD_DAYS)[number];
export const ACCOUNTING_WEEK_OFFSETS = [0, 1, 2, 3, 4] as const;
export type AccountingWeekOffset = (typeof ACCOUNTING_WEEK_OFFSETS)[number];

export function parseAccountingPeriodDays(value: unknown): AccountingPeriodDays | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return ACCOUNTING_PERIOD_DAYS.find((days) => days === parsed) ?? null;
}

export function getAccountingPeriodLabel(days: AccountingPeriodDays): string {
  if (days === 1) return 'último dia';
  return `últimos ${days} dias`;
}

export function parseAccountingWeekOffset(value: unknown): AccountingWeekOffset | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return ACCOUNTING_WEEK_OFFSETS.find((offset) => offset === parsed) ?? null;
}

export function getAccountingWeekRange(day: string, weekOffset: AccountingWeekOffset): {
  startDay: string;
  endDay: string;
} {
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - weekOffset * 7);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return {
    startDay: start.toISOString().slice(0, 10),
    endDay: end.toISOString().slice(0, 10),
  };
}

export interface AccountingBuildingPosition {
  id: string;
  x: number;
  y: number;
}

export interface AccountingShop {
  id: string;
  type: ResidenceType;
  buildingNumber: number;
  x: number;
  y: number;
  employeeExpense: number;
  revenue: number;
  unitsSold: number;
  unitsLost: number;
  estimatedNetRevenue: number | null;
}

export interface AccountingWarehouse {
  id: string;
  buildingNumber: number;
  x: number;
  y: number;
}

export interface AccountingWarehouseProduct {
  productId: string;
  boughtQuantity: number;
  purchaseExpense: number;
  soldQuantity: number;
  salesRevenue: number;
  profitLoss: number;
}

export interface AccountingResidence {
  id: string;
  type: ResidenceType;
  buildingNumber: number;
  x: number;
  y: number;
  occupants: number;
  capacity: number;
  rentRevenue: number;
}

export interface AccountingProductionBuilding {
  id: string;
  type: ResidenceType;
  buildingNumber: number;
  x: number;
  y: number;
  employeeExpense: number;
  produced: number;
  stockProductId: string | null;
}

export interface AccountingProduct {
  productId: string;
  stockQuantity: number;
  producedQuantity: number;
  importedQuantity: number;
  exportedQuantity: number;
  shopSalesQuantity: number;
  shopStockLossQuantity: number;
  consumedQuantity: number;
  residentialConsumption: number;
  productionInputConsumption: number;
  unitCostEstimate: number | null;
}

export function getShopSalesAndLossByProduct(
  shops: readonly Pick<AccountingShop, 'type' | 'unitsSold' | 'unitsLost'>[],
): Map<string, { soldQuantity: number; lostQuantity: number }> {
  const quantities = new Map<string, { soldQuantity: number; lostQuantity: number }>();
  for (const shop of shops) {
    const productId = RESIDENCES[shop.type].stockProductId;
    if (!productId) continue;
    const totals = quantities.get(productId) ?? { soldQuantity: 0, lostQuantity: 0 };
    totals.soldQuantity += shop.unitsSold;
    totals.lostQuantity += shop.unitsLost;
    quantities.set(productId, totals);
  }
  return quantities;
}

export function getShopProductUnitCostEstimate(
  shopType: ResidenceType,
  productUnitCosts: ReadonlyMap<string, number>,
): number | null {
  const productId = RESIDENCES[shopType].stockProductId;
  return productId ? productUnitCosts.get(productId) ?? null : null;
}

export interface AccountingSummary {
  periodDays: AccountingPeriodDays;
  weekOffset: AccountingWeekOffset;
  weeklySummary: {
    startDay: string;
    endDay: string;
    revenue: number;
    expenses: number;
    profitLoss: number;
    employees: number;
    companyValue: number;
    inventoryValue: number;
  };
  shops: AccountingShop[];
  residences: AccountingResidence[];
  production: AccountingProductionBuilding[];
  products: AccountingProduct[];
  warehouse: {
    employeeExpense: number;
    buildings: AccountingWarehouse[];
    products: AccountingWarehouseProduct[];
  };
}

export interface ProductUnitCostInput {
  quantity: number;
  unitCost: number | null;
}

export function estimateProductionUnitCost(
  workPointsPerUnit: number,
  costPerWorkPoint: number,
  inputs: readonly ProductUnitCostInput[],
): number {
  if (
    !Number.isFinite(workPointsPerUnit) ||
    workPointsPerUnit < 0 ||
    !Number.isFinite(costPerWorkPoint) ||
    costPerWorkPoint < 0
  ) {
    throw new RangeError('O custo de produção exige Work Points e custo unitário válidos.');
  }
  const materialCost = inputs.reduce((total, input) => {
    if (
      !Number.isFinite(input.quantity) ||
      input.quantity < 0 ||
      (input.unitCost !== null && (!Number.isFinite(input.unitCost) || input.unitCost < 0))
    ) {
      throw new RangeError('Os insumos do custo de produção são inválidos.');
    }
    return total + input.quantity * (input.unitCost ?? 0);
  }, 0);
  return Math.round((workPointsPerUnit * costPerWorkPoint + materialCost) * 1_000_000) /
    1_000_000;
}

export function estimateBlendedUnitCost(input: {
  producedQuantity: number;
  productionUnitCost: number | null;
  importedQuantity: number;
  importExpense: number;
  previousUnitCost: number | null;
}): { unitCost: number | null; sourceQuantity: number } {
  const { producedQuantity, productionUnitCost, importedQuantity, importExpense, previousUnitCost } =
    input;
  if (
    !Number.isFinite(producedQuantity) ||
    producedQuantity < 0 ||
    (productionUnitCost !== null &&
      (!Number.isFinite(productionUnitCost) || productionUnitCost < 0)) ||
    !Number.isFinite(importedQuantity) ||
    importedQuantity < 0 ||
    !Number.isFinite(importExpense) ||
    importExpense < 0 ||
    (previousUnitCost !== null &&
      (!Number.isFinite(previousUnitCost) || previousUnitCost < 0))
  ) {
    throw new RangeError('As quantidades e os custos do produto são inválidos.');
  }
  const productionCost = productionUnitCost ?? previousUnitCost;
  const pricedProductionQuantity = productionCost === null ? 0 : producedQuantity;
  const sourceQuantity = pricedProductionQuantity + importedQuantity;
  if (sourceQuantity === 0) {
    return { unitCost: previousUnitCost, sourceQuantity: 0 };
  }
  return {
    unitCost:
      (pricedProductionQuantity * (productionCost ?? 0) + importExpense) / sourceQuantity,
    sourceQuantity,
  };
}

export function calculateDailyRentRevenue(occupants: number, rentPerPerson: number): number {
  if (!Number.isInteger(occupants) || occupants < 0 || !Number.isFinite(rentPerPerson) || rentPerPerson < 0) {
    throw new RangeError('O aluguel diário exige moradores e aluguel válidos.');
  }
  return roundCurrency(occupants * rentPerPerson);
}

export function calculateEstimatedShopNetRevenue(
  revenue: number,
  unitsSold: number,
  unitsLost: number,
  unitCostEstimate: number | null,
  employeeExpense: number,
): number | null {
  const totalUnits = unitsSold + unitsLost;
  if (
    !Number.isFinite(revenue) ||
    revenue < 0 ||
    !Number.isInteger(unitsSold) ||
    unitsSold < 0 ||
    !Number.isInteger(unitsLost) ||
    unitsLost < 0 ||
    !Number.isFinite(employeeExpense) ||
    employeeExpense < 0 ||
    (unitCostEstimate !== null &&
      (!Number.isFinite(unitCostEstimate) || unitCostEstimate < 0))
  ) {
    throw new RangeError('Os valores da receita líquida estimada são inválidos.');
  }
  if (totalUnits > 0 && unitCostEstimate === null) return null;
  return roundCurrency(revenue - totalUnits * (unitCostEstimate ?? 0) - employeeExpense);
}
