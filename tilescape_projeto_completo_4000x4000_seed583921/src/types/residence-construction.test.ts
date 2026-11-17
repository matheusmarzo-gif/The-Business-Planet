import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getConstructionMenuDefinitions,
  isPlayerBuildableConstructionType,
  planConstructionMaterialWithdrawals,
  RESIDENCES,
  SHOP_TYPES,
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

test('allows every catalog construction in the database building type constraint', async () => {
  const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8');
  const server = await readFile(new URL('../../server/index.ts', import.meta.url), 'utf8');
  const constraint = schema.match(
    /ADD CONSTRAINT all_buildings_building_type_check\s+CHECK \(building_type IN \(([\s\S]*?)\)\);/,
  );
  assert.ok(constraint, 'database schema must define the building type constraint');
  const allowedTypes = new Set(
    [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type),
  );
  assert.deepEqual(
    Object.keys(RESIDENCES).filter((type) => !allowedTypes.has(type)),
    [],
    'every catalog building type must be allowed by PostgreSQL',
  );
  assert.match(
    schema,
    /ALTER TABLE public\.residential_buildings RENAME TO all_buildings;/,
    'existing building rows must be preserved by renaming the legacy table',
  );
  assert.match(
    schema,
    /DROP CONSTRAINT IF EXISTS residential_buildings_building_type_check/,
    'the legacy building type constraint must be removed after the table rename',
  );
  assert.doesNotMatch(
    server,
    /\bresidential_buildings\b/,
    'runtime SQL must use the renamed all_buildings table',
  );
});

test('orders construction menus and applies the requested costs', () => {
  assert.deepEqual(
    getConstructionMenuDefinitions('residencias').map(({ type }) => type),
    [
      'house_poor1',
      'house_poor2',
      'house_poor3',
      'house_middle',
      'house_middle2',
      'house_middle3',
      'house_high',
      'house_high2',
      'house_high3',
    ],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('residencias').map(
      ({ width, height, capacity, localAppeal }) => [width, height, capacity, localAppeal],
    ),
    [
      [2, 2, 4, 50],
      [3, 3, 32, 40],
      [4, 4, 128, 30],
      [2, 2, 4, 70],
      [3, 3, 32, 55],
      [4, 4, 128, 40],
      [2, 2, 4, 100],
      [3, 3, 32, 80],
      [4, 4, 128, 60],
    ],
  );
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
      'shop_clothing',
      'shop_furniture',
      'shop_utilities',
      'shop_glass',
      'shop_olive_oil',
      'shop_tobacco',
      'shop_alcohol',
      'shop_wine',
      'shop_tincture',
      'shop_carpet',
      'shop_porcelain',
      'shop_artwork',
      'shop_jewelry',
      'shop_rarities',
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
      'farm_sheep',
      'farm_cotton',
      'farm_olive',
      'farm_tobacco',
      'farm_grape',
    ],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('artesanais').map(({ type }) => type),
    [
      'fishery',
      'toolmaker',
      'charcoal_works',
      'sugar_mill',
      'bread_factory',
      'cheese_factory',
      'artist_workshop',
      'jeweler_workshop',
      'craftsman_workshop',
    ],
  );
  assert.deepEqual(
    getConstructionMenuDefinitions('industrias').map(({ type }) => type),
    [
      'warehouse',
      'silo',
      'flour_mill',
      'chocolate_factory',
      'steelworks',
      'thread_factory',
      'textile_factory',
      'furniture_factory',
      'utilities_factory',
      'glass_factory',
      'tincture_factory',
      'carpet_factory',
      'porcelain_factory',
      'olive_oil_factory',
      'tobacco_factory',
      'alcohol_distillery',
      'wine_factory',
    ],
  );
  assert.equal(RESIDENCES.silo.width, 4);
  assert.equal(RESIDENCES.silo.height, 4);
  assert.equal(RESIDENCES.silo.maxWorkers, 100);
  assert.equal(RESIDENCES.silo.storageCapacityM3, 400);
  assert.deepEqual(RESIDENCES.silo.allowedStorageProductIds, [
    'wheat',
    'barley',
    'potato',
    'corn',
    'rice',
    'fruit',
    'spices',
    'cocoa',
    'sugarcane',
    'olive',
    'grape',
    'tobacco_leaf',
    'cotton',
    'wool',
  ]);

  const costs: Partial<Record<keyof typeof RESIDENCES, { wood: number; stone: number; iron?: number; steel?: number; workPoints: number }>> = {
    house_poor1: { wood: 60, stone: 10, workPoints: 10000 },
    house_poor2: { wood: 300, stone: 250, workPoints: 150000 },
    house_poor3: { wood: 1500, stone: 1000, iron: 200, workPoints: 3300000 },
    house_middle: { wood: 90, stone: 15, workPoints: 15000 },
    house_middle2: { wood: 450, stone: 375, workPoints: 225000 },
    house_middle3: { wood: 2250, stone: 1500, iron: 300, steel: 100, workPoints: 4000000 },
    house_high: { wood: 180, stone: 30, iron: 15, workPoints: 15000 },
    house_high2: { wood: 900, stone: 750, iron: 50, steel: 50, workPoints: 225000 },
    house_high3: { wood: 4500, stone: 3000, iron: 600, steel: 250, workPoints: 4000000 },
    silo: { wood: 300, stone: 60, workPoints: 20000 },
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
    sand_pit: { wood: 60, stone: 30, workPoints: 240000 },
    steelworks: { wood: 1000, stone: 600, iron: 400, workPoints: 20000000 },
    farm_sheep: { wood: 60, stone: 20, workPoints: 130000 },
    farm_cotton: { wood: 60, stone: 20, workPoints: 130000 },
    farm_olive: { wood: 2000, stone: 1000, workPoints: 1200000 },
    farm_tobacco: { wood: 2000, stone: 1000, workPoints: 1200000 },
    farm_grape: { wood: 2000, stone: 1000, workPoints: 1200000 },
    thread_factory: { wood: 800, stone: 500, iron: 300, steel: 100, workPoints: 7000000 },
    textile_factory: { wood: 1000, stone: 600, iron: 400, steel: 100, workPoints: 10000000 },
    furniture_factory: { wood: 1000, stone: 600, iron: 400, steel: 100, workPoints: 10000000 },
    utilities_factory: { wood: 2000, stone: 1200, iron: 800, steel: 300, workPoints: 10000000 },
    glass_factory: { wood: 2000, stone: 1200, iron: 800, steel: 300, workPoints: 10000000 },
    gold_mine: { wood: 300, stone: 300, steel: 100, workPoints: 2900000 },
    silver_mine: { wood: 300, stone: 300, steel: 100, workPoints: 2900000 },
    shop_olive_oil: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_tobacco: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_alcohol: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_wine: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_tincture: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_carpet: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_porcelain: { wood: 40, stone: 40, iron: 40, steel: 40, workPoints: 260000 },
    shop_artwork: { wood: 60, stone: 60, iron: 60, steel: 40, workPoints: 350000 },
    shop_jewelry: { wood: 60, stone: 60, iron: 60, steel: 40, workPoints: 350000 },
    shop_rarities: { wood: 30, stone: 30, iron: 30, steel: 20, workPoints: 250000 },
    tincture_factory: { wood: 1000, stone: 500, iron: 500, steel: 500, workPoints: 21000000 },
    carpet_factory: { wood: 1000, stone: 500, iron: 500, steel: 500, workPoints: 21000000 },
    porcelain_factory: { wood: 1000, stone: 500, iron: 500, steel: 500, workPoints: 21000000 },
    olive_oil_factory: { wood: 100, stone: 50, iron: 50, steel: 50, workPoints: 3000000 },
    tobacco_factory: { wood: 100, stone: 50, iron: 50, steel: 50, workPoints: 3000000 },
    alcohol_distillery: { wood: 100, stone: 50, iron: 50, steel: 50, workPoints: 3000000 },
    wine_factory: { wood: 100, stone: 50, iron: 50, steel: 50, workPoints: 3000000 },
    artist_workshop: { wood: 200, stone: 100, iron: 100, steel: 100, workPoints: 4200000 },
    jeweler_workshop: { wood: 1000, stone: 500, iron: 500, steel: 500, workPoints: 21000000 },
    craftsman_workshop: { wood: 200, stone: 100, iron: 100, steel: 100, workPoints: 4200000 },
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

test('defines the requested shops and their per-unit sales rates', () => {
  assert.equal(RESIDENCES.shop_alcohol.name, 'Bar');
  assert.equal(RESIDENCES.alcohol_distillery.name, 'Destilaria');
  const shops = [
    ['shop_olive_oil', 'olive_oil', 20, 12, 420],
    ['shop_tobacco', 'tobacco', 20, 12, 420],
    ['shop_alcohol', 'alcohol', 20, 12, 420],
    ['shop_wine', 'wine', 20, 12, 420],
    ['shop_tincture', 'tincture', 40, 16, 120],
    ['shop_carpet', 'carpet', 40, 16, 120],
    ['shop_porcelain', 'porcelain', 40, 16, 120],
    ['shop_artwork', 'artwork', 20, 16, 600],
    ['shop_jewelry', 'jewelry', 20, 16, 600],
    ['shop_rarities', 'rarities', 10, 30, 2100],
  ] as const;
  for (const [type, productId, stockCapacity, maxWorkers, workPointsPerUnit] of shops) {
    const definition = RESIDENCES[type];
    assert.equal(SHOP_TYPES.includes(type), true, type);
    assert.equal(definition.kind, 'shop', type);
    assert.equal(definition.stockProductId, productId, type);
    assert.equal(definition.stockCapacity, stockCapacity, type);
    assert.equal(definition.maxWorkers, maxWorkers, type);
    assert.equal(definition.salesWorkPointsPerUnit, workPointsPerUnit, type);
  }
});

test('defines the requested seasonal crop rules', () => {
  assert.deepEqual(
    RESIDENCES.farm_olive.cropRule,
    {
      growthMonths: 8,
      dailyWorkPoints: 5000,
      harvestWorkPointsPerUnit: 12.5,
      baseYield: 1500,
      plantingEfficiencyByQuarter: [0.4, 0.3, 0.4, 1],
    },
  );
  assert.deepEqual(
    RESIDENCES.farm_tobacco.cropRule,
    {
      growthMonths: 6,
      dailyWorkPoints: 5000,
      harvestWorkPointsPerUnit: 50,
      baseYield: 800,
      plantingEfficiencyByQuarter: [0.8, 0.6, 1, 0.8],
    },
  );
  assert.deepEqual(
    RESIDENCES.farm_grape.cropRule,
    {
      growthMonths: 4,
      dailyWorkPoints: 10000,
      harvestWorkPointsPerUnit: 42,
      baseYield: 600,
      plantingEfficiencyByQuarter: [0.5, 0.6, 0.8, 1],
    },
  );
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

test('requires iron and steel as well as wood and stone for construction costs that specify them', () => {
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
  const steelCost = RESIDENCES.thread_factory.cost;
  assert.deepEqual(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 800 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 500 },
        { buildingId: 'warehouse', productId: 'iron', quantity: 300 },
        { buildingId: 'warehouse', productId: 'steel', quantity: 100 },
      ],
      steelCost,
    ),
    [
      { buildingId: 'warehouse', productId: 'wood', quantity: 800 },
      { buildingId: 'warehouse', productId: 'stone', quantity: 500 },
      { buildingId: 'warehouse', productId: 'iron', quantity: 300 },
      { buildingId: 'warehouse', productId: 'steel', quantity: 100 },
    ],
  );
  assert.equal(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 800 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 500 },
        { buildingId: 'warehouse', productId: 'iron', quantity: 300 },
      ],
      steelCost,
    ),
    null,
  );
});
