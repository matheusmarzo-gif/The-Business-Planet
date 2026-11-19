import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDailyRentRevenue,
  calculateEstimatedShopNetRevenue,
  estimateConstructionMaterialValue,
  estimateBlendedUnitCost,
  estimateProductionUnitCost,
  getAccountingStockLossByProduct,
  getAccountingFarmWorkPointsNeeded,
  getShopProductUnitCostEstimate,
  getShopSalesAndLossByProduct,
  getAccountingWeekRange,
  getAccountingPeriodLabel,
  parseAccountingPeriodDays,
  parseAccountingWeekOffset,
  summarizeAccountingShops,
  type AccountingShop,
} from './accounting.js';

test('calculates farm Work Points needed from active crop days', () => {
  assert.equal(getAccountingFarmWorkPointsNeeded(5000, 6, 12, 100), 30000);
  assert.equal(getAccountingFarmWorkPointsNeeded(null, 0, 12, 5), 60);
  assert.throws(() => getAccountingFarmWorkPointsNeeded(-1, 2, 0, null), RangeError);
});

test('aggregates shop sales and stock loss by the product sold', () => {
  assert.deepEqual(
    getShopSalesAndLossByProduct([
      { type: 'shop_rice', unitsSold: 8, unitsLost: 2 },
      { type: 'shop_rice', unitsSold: 5, unitsLost: 1 },
      { type: 'shop_fish', unitsSold: 3, unitsLost: 4 },
    ]),
    new Map([
      ['rice', { soldQuantity: 13, lostQuantity: 3 }],
      ['fish', { soldQuantity: 3, lostQuantity: 4 }],
    ]),
  );
});

test('aggregates stock loss by product and storage location', () => {
  assert.deepEqual(
    getAccountingStockLossByProduct([
      { productId: 'bread', location: 'shop', unitsLost: 2 },
      { productId: 'bread', location: 'warehouse', unitsLost: 5 },
      { productId: 'bread', location: 'other', unitsLost: 3 },
      { productId: 'bread', location: 'warehouse', unitsLost: 1 },
      { productId: 'fish', location: 'other', unitsLost: 4 },
    ]),
    new Map([
      ['bread', { shopQuantity: 2, warehouseQuantity: 6, otherQuantity: 3 }],
      ['fish', { shopQuantity: 0, warehouseQuantity: 0, otherQuantity: 4 }],
    ]),
  );
});

test('calculates daily rent for occupied residences to cents', () => {
  assert.equal(calculateDailyRentRevenue(3, 1.23), 3.69);
});

test('does not generate rent for an empty residence', () => {
  assert.equal(calculateDailyRentRevenue(0, 10), 0);
});

test('rejects invalid rent inputs', () => {
  assert.throws(() => calculateDailyRentRevenue(-1, 10), RangeError);
  assert.throws(() => calculateDailyRentRevenue(1.5, 10), RangeError);
  assert.throws(() => calculateDailyRentRevenue(1, Number.NaN), RangeError);
});

test('uses the product tab unit-cost estimate to calculate shop net revenue', () => {
  const productUnitCosts = new Map([['rice', 2.5]]);
  const unitCost = getShopProductUnitCostEstimate('shop_rice', productUnitCosts);

  assert.equal(unitCost, 2.5);
  assert.equal(calculateEstimatedShopNetRevenue(100, 10, 2, unitCost, 10), 60);
  assert.equal(calculateEstimatedShopNetRevenue(1, 0, 0, null, 0.5), 0.5);
  assert.equal(calculateEstimatedShopNetRevenue(100, 10, 2, null, 10), null);
});

test('summarizes shop accounting totals and marks estimated net revenue unavailable if needed', () => {
  const shops: AccountingShop[] = [
    {
      id: 'shop-1',
      type: 'shop_rice',
      status: 'completed',
      buildingNumber: 1,
      x: 0,
      y: 0,
      employed: 4,
      desiredWorkers: 8,
      fixedDesiredWorkers: 8,
      desiredWorkersByWorkPoints: false,
      desiredWorkPointsPerDay: 0,
      workHoursPerDay: 8,
      wage: 10,
      wageByTechnique: false,
      wagePerTechniqueRate: 1,
      averageWorkerTechnique: 15,
      minimumWorkerTechnique: 10,
      employeeExpense: 12.35,
      revenue: 40.55,
      unitsSold: 10,
      unitsLost: 1,
      estimatedNetRevenue: 20.25,
      price: 2,
    },
    {
      id: 'shop-2',
      type: 'shop_fish',
      status: 'completed',
      buildingNumber: 1,
      x: 1,
      y: 1,
      employed: 3,
      desiredWorkers: 6,
      fixedDesiredWorkers: 6,
      desiredWorkersByWorkPoints: false,
      desiredWorkPointsPerDay: 0,
      workHoursPerDay: 7,
      wage: 11,
      wageByTechnique: false,
      wagePerTechniqueRate: 1,
      averageWorkerTechnique: null,
      minimumWorkerTechnique: 12,
      employeeExpense: 8.4,
      revenue: 14.45,
      unitsSold: 5,
      unitsLost: 2,
      estimatedNetRevenue: 3.65,
      price: 3,
    },
  ];

  assert.deepEqual(summarizeAccountingShops(shops), {
    employeeExpense: 20.75,
    revenue: 55,
    unitsSold: 15,
    unitsLost: 3,
    estimatedNetRevenue: 23.9,
  });
  assert.equal(
    summarizeAccountingShops(shops.map((shop, index) =>
      index === 1 ? { ...shop, estimatedNetRevenue: null } : shop,
    )).estimatedNetRevenue,
    null,
  );
});

test('returns no shop product cost when the product has no estimate', () => {
  assert.equal(getShopProductUnitCostEstimate('shop_rice', new Map()), null);
});

test('values construction materials by player cost estimates before market fallbacks', () => {
  assert.equal(
    estimateConstructionMaterialValue(
      { wood: 10, stone: 4, iron: 2, steel: 1 },
      new Map([
        ['wood', 2],
        ['iron', 0],
      ]),
      new Map([
        ['wood', 9],
        ['stone', 3],
        ['iron', 4],
        ['steel', 6],
      ]),
    ),
    38,
  );
  assert.equal(
    estimateConstructionMaterialValue(
      { wood: 2, stone: 1 },
      new Map(),
      new Map([['wood', 1.25]]),
    ),
    2.5,
  );
});

test('rejects invalid inputs for estimated shop net revenue', () => {
  assert.throws(() => calculateEstimatedShopNetRevenue(-1, 0, 0, 1, 0), RangeError);
  assert.throws(() => calculateEstimatedShopNetRevenue(1, -1, 0, 1, 0), RangeError);
  assert.throws(() => calculateEstimatedShopNetRevenue(1, 0, 0, Number.NaN, 0), RangeError);
  assert.throws(() => calculateEstimatedShopNetRevenue(1, 0, 0, 1, -1), RangeError);
});

test('estimates production cost from Work Points and yesterday input prices', () => {
  assert.equal(estimateProductionUnitCost(1000, 0.09, []), 90);
  assert.equal(
    estimateProductionUnitCost(400, 0.1, [
      { quantity: 2, unitCost: 3 },
      { quantity: 1, unitCost: null },
    ]),
    46,
  );
  assert.throws(() => estimateProductionUnitCost(-1, 0.1, []), RangeError);
});

test('blends owned production and external purchases by quantity and carries prior estimates', () => {
  assert.deepEqual(
    estimateBlendedUnitCost({
      producedQuantity: 50,
      productionUnitCost: 10,
      importedQuantity: 50,
      importExpense: 1500,
      previousUnitCost: 8,
    }),
    { unitCost: 20, sourceQuantity: 100 },
  );
  assert.deepEqual(
    estimateBlendedUnitCost({
      producedQuantity: 0,
      productionUnitCost: null,
      importedQuantity: 0,
      importExpense: 0,
      previousUnitCost: 8,
    }),
    { unitCost: 8, sourceQuantity: 0 },
  );
});

test('parses only supported accounting periods', () => {
  assert.equal(parseAccountingPeriodDays('1'), 1);
  assert.equal(parseAccountingPeriodDays('7'), 7);
  assert.equal(parseAccountingPeriodDays('30'), 30);
  assert.equal(parseAccountingPeriodDays('2'), null);
  assert.equal(parseAccountingPeriodDays(['7']), null);
});

test('labels accounting periods in Portuguese', () => {
  assert.equal(getAccountingPeriodLabel(1), 'último dia');
  assert.equal(getAccountingPeriodLabel(7), 'últimos 7 dias');
  assert.equal(getAccountingPeriodLabel(30), 'últimos 30 dias');
});

test('parses five accounting week offsets and calculates seven-day ranges', () => {
  assert.equal(parseAccountingWeekOffset('0'), 0);
  assert.equal(parseAccountingWeekOffset('4'), 4);
  assert.equal(parseAccountingWeekOffset('5'), null);
  assert.deepEqual(getAccountingWeekRange('1101-08-09', 0), {
    startDay: '1101-08-03',
    endDay: '1101-08-09',
  });
  assert.deepEqual(getAccountingWeekRange('1101-08-09', 4), {
    startDay: '1101-07-06',
    endDay: '1101-07-12',
  });
});
