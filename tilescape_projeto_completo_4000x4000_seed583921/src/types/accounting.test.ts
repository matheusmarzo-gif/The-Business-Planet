import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDailyRentRevenue,
  getAccountingPeriodLabel,
  parseAccountingPeriodDays,
} from './accounting.js';

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
