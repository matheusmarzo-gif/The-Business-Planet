import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getExpectedConstructionCost,
  getStockCapacity,
  getStockCapacitySlots,
  getStockLevel,
  getStockUpgradeCost,
} from './stockCapacity.js';
import { RESIDENCES } from './residence.js';

test('scales each configured stock slot by its level, defaulting to level one', () => {
  const definition = RESIDENCES.cheese_factory;
  assert.equal(getStockCapacity(definition, 'stock'), definition.stockCapacity);
  assert.equal(getStockCapacity(definition, 'stock', { stock: 3 }), definition.stockCapacity! * 3);
  assert.equal(getStockCapacity(definition, 'input:milk', { 'input:milk': 2 }), definition.inputCapacities!.milk * 2);
  assert.deepEqual(
    getStockCapacitySlots(definition, null).map(({ key }) => key).sort(),
    ['input:milk', 'input:salt', 'stock', 'tools'],
  );
});

test('rejects invalid levels and prices construction labor at one city salary per 100 work points', () => {
  assert.throws(() => getStockLevel({ stock: 5 }, 'stock'), RangeError);
  const definition = RESIDENCES.sand_pit;
  const expectedCost = getExpectedConstructionCost(
    definition,
    new Map([
      ['wood', 2],
      ['stone', 3],
    ]),
    10,
  );
  assert.equal(
    expectedCost,
    definition.cost.wood * 2 +
      definition.cost.stone * 3 +
      (definition.workPoints / 100) * 10,
  );
  assert.equal(getExpectedConstructionCost(definition, new Map([['wood', 2]]), 10), null);
});

test('accepts zero unit-cost estimates for construction materials', () => {
  const definition = RESIDENCES.sand_pit;
  assert.equal(
    getExpectedConstructionCost(
      definition,
      new Map([
        ['wood', 0],
        ['stone', 0],
      ]),
      10,
    ),
    (definition.workPoints / 100) * 10,
  );
});

test('charges the configured construction-cost fraction for each target level', () => {
  assert.equal(getStockUpgradeCost(1000, 2), 100);
  assert.equal(getStockUpgradeCost(1000, 3), 400);
  assert.equal(getStockUpgradeCost(1000, 4), 1000);
  assert.throws(() => getStockUpgradeCost(1000, 1), RangeError);
});
