export interface AccountingShop {
  id: string;
  type: string;
  employeeExpense: number;
  revenue: number;
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
    products: AccountingWarehouseProduct[];
  };
}
