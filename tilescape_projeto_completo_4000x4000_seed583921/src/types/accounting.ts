import type { ResidenceType } from './residence.js';
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
