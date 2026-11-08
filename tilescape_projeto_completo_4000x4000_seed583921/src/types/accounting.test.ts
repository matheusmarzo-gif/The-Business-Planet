import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDailyRentRevenue,
  getAccountingWeekRange,
  getAccountingPeriodLabel,
  parseAccountingPeriodDays,
  parseAccountingWeekOffset,
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
