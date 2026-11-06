import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDailyRentRevenue } from './accounting.js';

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
