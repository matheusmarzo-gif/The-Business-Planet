import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPlayerBuildableConstructionType,
  planConstructionMaterialWithdrawals,
  RESIDENCES,
} from './residence.js';

test('allows authenticated players to build every catalog construction', () => {
  for (const type of Object.keys(RESIDENCES)) {
    assert.equal(isPlayerBuildableConstructionType(type), true, type);
  }
});

test('rejects construction types outside the catalog', () => {
  assert.equal(isPlayerBuildableConstructionType('prefeitura'), false);
  assert.equal(isPlayerBuildableConstructionType('__proto__'), false);
  assert.equal(isPlayerBuildableConstructionType(null), false);
});

test('plans construction costs across nearby warehouses without allowing partial payment', () => {
  const cost = RESIDENCES.shop_milk.cost;
  assert.deepEqual(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'near', productId: 'wood', quantity: 10 },
        { buildingId: 'near', productId: 'stone', quantity: 5 },
      ],
      cost,
    ),
    [
      { buildingId: 'near', productId: 'wood', quantity: 10 },
      { buildingId: 'near', productId: 'stone', quantity: 5 },
    ],
  );
  assert.equal(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'near', productId: 'wood', quantity: 10 },
        { buildingId: 'near', productId: 'stone', quantity: 4 },
      ],
      cost,
    ),
    null,
  );
});

test('requires iron as well as wood and stone for construction costs that specify it', () => {
  const cost = RESIDENCES.shop_bread.cost;
  assert.deepEqual(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 180 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 120 },
        { buildingId: 'warehouse', productId: 'iron', quantity: 60 },
      ],
      cost,
    ),
    [
      { buildingId: 'warehouse', productId: 'wood', quantity: 180 },
      { buildingId: 'warehouse', productId: 'stone', quantity: 120 },
      { buildingId: 'warehouse', productId: 'iron', quantity: 60 },
    ],
  );
  assert.equal(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 180 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 120 },
      ],
      cost,
    ),
    null,
  );
});
