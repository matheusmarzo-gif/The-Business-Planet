import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDailyRentRevenue,
  calculateEstimatedShopNetRevenue,
  estimateBlendedUnitCost,
  estimateProductionUnitCost,
  getShopSalesAndLossByProduct,
  getAccountingWeekRange,
  getAccountingPeriodLabel,
  parseAccountingPeriodDays,
  parseAccountingWeekOffset,
} from './accounting.js';

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

test('estimates shop net revenue from daily average warehouse cost and payroll', () => {
  assert.equal(calculateEstimatedShopNetRevenue(100, 10, 2, 3, 10), 54);
  assert.equal(calculateEstimatedShopNetRevenue(1, 0, 0, null, 0.5), 0.5);
  assert.equal(calculateEstimatedShopNetRevenue(100, 10, 2, null, 10), null);
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
