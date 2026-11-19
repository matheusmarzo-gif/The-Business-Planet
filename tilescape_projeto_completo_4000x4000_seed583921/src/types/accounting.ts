import {
  RESIDENCES,
  type ResidenceCost,
  type ResidenceType,
  type ResidentialBuildingStatus,
} from './residence.js';
import type { Crop, FarmAutomationSettings } from './farming.js';
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
  status: ResidentialBuildingStatus;
  buildingNumber: number;
  x: number;
  y: number;
  employed: number;
  desiredWorkers: number;
  fixedDesiredWorkers: number;
  desiredWorkersByWorkPoints: boolean;
  desiredWorkPointsPerDay: number;
  workHoursPerDay: number;
  wage: number;
  wageByTechnique: boolean;
  wagePerTechniqueRate: number;
  averageWorkerTechnique: number | null;
  minimumWorkerTechnique: number;
  employeeExpense: number;
  revenue: number;
  unitsSold: number;
  unitsLost: number;
  estimatedNetRevenue: number | null;
  price: number;
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
  rentPerPerson: number;
  associatedBenefit: number | null;
}

export interface AccountingProductionBuilding {
  id: string;
  type: ResidenceType;
  status: ResidentialBuildingStatus;
  buildingNumber: number;
  x: number;
  y: number;
  employed: number;
  desiredWorkers: number;
  fixedDesiredWorkers: number;
  desiredWorkersByWorkPoints: boolean;
  desiredWorkPointsPerDay: number;
  workHoursPerDay: number;
  wage: number;
  wageByTechnique: boolean;
  wagePerTechniqueRate: number;
  averageWorkerTechnique: number | null;
  minimumWorkerTechnique: number;
  employeeExpense: number;
  produced: number;
  stockProductId: string | null;
}

export interface AccountingFarm {
  id: string;
  type: ResidenceType;
  status: ResidentialBuildingStatus;
  buildingNumber: number;
  x: number;
  y: number;
  employed: number;
  desiredWorkers: number;
  fixedDesiredWorkers: number;
  desiredWorkersByWorkPoints: boolean;
  desiredWorkPointsPerDay: number;
  workHoursPerDay: number;
  wage: number;
  wageByTechnique: boolean;
  wagePerTechniqueRate: number;
  averageWorkerTechnique: number | null;
  minimumWorkerTechnique: number;
  stock: number;
  produced: number;
  workPointsGenerated: number;
  activeDays: number;
  efficiency: number | null;
  stockProductId: string;
  crop: Crop | null;
  farmAutomation: FarmAutomationSettings;
}

export interface AccountingProduct {
  productId: string;
  stockQuantity: number;
  producedQuantity: number;
  importedQuantity: number;
  exportedQuantity: number;
  shopSalesQuantity: number;
  shopStockLossQuantity: number;
  warehouseStockLossQuantity: number;
  otherStockLossQuantity: number;
  consumedQuantity: number;
  residentialConsumption: number;
  productionInputConsumption: number;
  unitCostEstimate: number | null;
}

export function getAccountingFarmWorkPointsNeeded(
  dailyWorkPoints: number | null,
  activeDays: number,
  produced: number,
  workPointsPerUnit: number | null,
): number {
  if (
    (dailyWorkPoints !== null && (!Number.isFinite(dailyWorkPoints) || dailyWorkPoints < 0)) ||
    !Number.isInteger(activeDays) ||
    activeDays < 0 ||
    !Number.isFinite(produced) ||
    produced < 0 ||
    (workPointsPerUnit !== null &&
      (!Number.isFinite(workPointsPerUnit) || workPointsPerUnit < 0))
  ) {
    throw new RangeError('A necessidade de Work Points da fazenda é inválida.');
  }
  if (dailyWorkPoints !== null) return dailyWorkPoints * activeDays;
  return (workPointsPerUnit ?? 0) * produced;
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

export function getAccountingStockLossByProduct(
  losses: readonly {
    productId: string;
    location: 'shop' | 'warehouse' | 'other';
    unitsLost: number;
  }[],
): Map<string, {
  shopQuantity: number;
  warehouseQuantity: number;
  otherQuantity: number;
}> {
  const quantities = new Map<string, {
    shopQuantity: number;
    warehouseQuantity: number;
    otherQuantity: number;
  }>();
  for (const loss of losses) {
    const totals = quantities.get(loss.productId) ?? {
      shopQuantity: 0,
      warehouseQuantity: 0,
      otherQuantity: 0,
    };
    if (loss.location === 'shop') totals.shopQuantity += loss.unitsLost;
    else if (loss.location === 'warehouse') totals.warehouseQuantity += loss.unitsLost;
    else totals.otherQuantity += loss.unitsLost;
    quantities.set(loss.productId, totals);
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

export function estimateConstructionMaterialValue(
  cost: ResidenceCost,
  productUnitCosts: ReadonlyMap<string, number>,
  fallbackMarketPrices: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const productId of ['wood', 'stone', 'iron', 'steel'] as const) {
    const quantity = cost[productId] ?? 0;
    const unitCost =
      productUnitCosts.get(productId) ??
      fallbackMarketPrices.get(productId) ??
      0;
    if (
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      !Number.isFinite(unitCost) ||
      unitCost < 0
    ) {
      throw new RangeError('O custo estimado dos materiais de construção é inválido.');
    }
    total += quantity * unitCost;
  }
  return roundCurrency(total);
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
  farms: AccountingFarm[];
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

export interface AccountingShopTotals {
  employeeExpense: number;
  revenue: number;
  unitsSold: number;
  unitsLost: number;
  estimatedNetRevenue: number | null;
}

export function summarizeAccountingShops(
  shops: readonly AccountingShop[],
): AccountingShopTotals {
  return {
    employeeExpense: roundCurrency(
      shops.reduce((total, shop) => total + shop.employeeExpense, 0),
    ),
    revenue: roundCurrency(shops.reduce((total, shop) => total + shop.revenue, 0)),
    unitsSold: shops.reduce((total, shop) => total + shop.unitsSold, 0),
    unitsLost: shops.reduce((total, shop) => total + shop.unitsLost, 0),
    estimatedNetRevenue: shops.every((shop) => shop.estimatedNetRevenue !== null)
      ? roundCurrency(
          shops.reduce((total, shop) => total + (shop.estimatedNetRevenue ?? 0), 0),
        )
      : null,
  };
}
