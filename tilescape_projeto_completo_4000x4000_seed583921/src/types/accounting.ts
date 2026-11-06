import type { ResidenceType } from './residence';

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

export interface AccountingSummary {
  shops: AccountingShop[];
  warehouse: {
    employeeExpense: number;
    buildings: AccountingWarehouse[];
    products: AccountingWarehouseProduct[];
  };
}
