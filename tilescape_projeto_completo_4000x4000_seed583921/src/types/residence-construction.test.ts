import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConstructionMenuDefinitions,
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

test('orders construction menus and applies the requested costs', () => {
  assert.deepEqual(
    getConstructionMenuDefinitions('comerciais').map(({ type }) => type),
    [
      'shop_rice',
      'shop_wheat',
      'shop_barley',
      'shop_potato',
      'shop_corn',
      'shop_fish',
      'shop_milk',
      'shop_butcher',
      'shop_sugar',
      'shop_spices',
      'shop_vegetables',
      'shop_salt',
      'shop_bread',
      'shop_cheese',
      'shop_fruit',
      'shop_chocolate',
    ],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('fazendas').map(({ type }) => type),
    [
      'farm_rice',
      'farm_wheat',
      'farm_barley',
      'farm_potato',
      'farm_corn',
      'farm_dairy',
      'farm_cattle',
      'farm_cane',
      'farm_vegetables',
      'farm_spices',
      'farm_cocoa',
      'farm_fruit',
    ],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('artesanais').map(({ type }) => type),
    ['fishery', 'toolmaker', 'charcoal_works', 'sugar_mill'],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('industrias').map(({ type }) => type),
    ['warehouse', 'flour_mill', 'bread_factory', 'cheese_factory', 'chocolate_factory'],
  );

  const costs: Partial<Record<keyof typeof RESIDENCES, { wood: number; stone: number; iron?: number; workPoints: number }>> = {
    farm_rice: { wood: 100, stone: 40, workPoints: 30000 },
    farm_wheat: { wood: 100, stone: 40, workPoints: 30000 },
    farm_barley: { wood: 100, stone: 40, workPoints: 30000 },
    farm_potato: { wood: 100, stone: 40, workPoints: 30000 },
    farm_corn: { wood: 100, stone: 40, workPoints: 30000 },
    farm_cattle: { wood: 250, stone: 75, workPoints: 125000 },
    fishery: { wood: 50, stone: 15, workPoints: 25000 },
    farm_dairy: { wood: 50, stone: 15, workPoints: 25000 },
    lumber_mill: { wood: 20, stone: 5, workPoints: 35000 },
    iron_mine: { wood: 60, stone: 20, workPoints: 120000 },
    quarry: { wood: 60, stone: 20, workPoints: 120000 },
    toolmaker: { wood: 60, stone: 20, workPoints: 120000 },
    charcoal_works: { wood: 60, stone: 20, workPoints: 120000 },
    farm_cane: { wood: 100, stone: 40, iron: 40, workPoints: 10000 },
    sugar_mill: { wood: 100, stone: 40, iron: 40, workPoints: 60000 },
    farm_vegetables: { wood: 100, stone: 40, iron: 40, workPoints: 110000 },
    farm_spices: { wood: 200, stone: 80, iron: 80, workPoints: 320000 },
    salt_gatherer: { wood: 100, stone: 40, iron: 40, workPoints: 10000 },
    flour_mill: { wood: 100, stone: 40, iron: 40, workPoints: 110000 },
    bread_factory: { wood: 180, stone: 120, iron: 60, workPoints: 480000 },
    farm_cocoa: { wood: 180, stone: 120, iron: 60, workPoints: 480000 },
    chocolate_factory: { wood: 180, stone: 120, iron: 60, workPoints: 480000 },
    cheese_factory: { wood: 360, stone: 240, iron: 120, workPoints: 960000 },
    farm_fruit: { wood: 360, stone: 240, iron: 120, workPoints: 960000 },
  };
  for (const [type, expected] of Object.entries(costs)) {
    const definition = RESIDENCES[type as keyof typeof RESIDENCES];
    assert.deepEqual(
      { ...definition.cost, workPoints: definition.workPoints },
      expected,
      type,
    );
  }
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
