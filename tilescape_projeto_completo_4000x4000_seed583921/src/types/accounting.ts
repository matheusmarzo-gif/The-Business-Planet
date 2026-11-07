import type { ResidenceType } from './residence.js';
import { roundCurrency } from './currency.js';

export const ACCOUNTING_PERIOD_DAYS = [1, 7, 30] as const;
export type AccountingPeriodDays = (typeof ACCOUNTING_PERIOD_DAYS)[number];

export function parseAccountingPeriodDays(value: unknown): AccountingPeriodDays | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return ACCOUNTING_PERIOD_DAYS.find((days) => days === parsed) ?? null;
}

export function getAccountingPeriodLabel(days: AccountingPeriodDays): string {
  if (days === 1) return 'último dia';
  return `últimos ${days} dias`;
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

export interface AccountingSummary {
  periodDays: AccountingPeriodDays;
  shops: AccountingShop[];
  residences: AccountingResidence[];
  production: AccountingProductionBuilding[];
  warehouse: {
    employeeExpense: number;
    buildings: AccountingWarehouse[];
    products: AccountingWarehouseProduct[];
  };
}

export function calculateDailyRentRevenue(occupants: number, rentPerPerson: number): number {
  if (!Number.isInteger(occupants) || occupants < 0 || !Number.isFinite(rentPerPerson) || rentPerPerson < 0) {
    throw new RangeError('O aluguel diário exige moradores e aluguel válidos.');
  }
  return roundCurrency(occupants * rentPerPerson);
}
