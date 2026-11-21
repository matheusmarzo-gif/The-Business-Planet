import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getConstructionMenuDefinitions,
  isPlayerBuildableConstructionType,
  planConstructionMaterialWithdrawals,
  RESIDENCES,
  SHOP_TYPES,
  supportsLocalDemand,
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

test('allows local demand only for artisanal, commercial, resource, and industrial categories', () => {
  assert.deepEqual(
    (['fishery', 'workshop', 'shop', 'resource', 'warehouse', 'industry'] as const)
      .map(supportsLocalDemand),
    [true, true, true, true, true, true],
  );
  assert.deepEqual(
    (['residence', 'farm'] as const).map(supportsLocalDemand),
    [false, false],
  );
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
    farm_rice: { wood: 60, stone: 20, workPoints: 60000 },
    farm_wheat: { wood: 60, stone: 20, workPoints: 60000 },
    farm_barley: { wood: 60, stone: 20, workPoints: 60000 },
    farm_potato: { wood: 60, stone: 20, workPoints: 60000 },
    farm_corn: { wood: 60, stone: 20, workPoints: 60000 },
    farm_cattle: { wood: 50, stone: 20, workPoints: 40000 },
    fishery: { wood: 50, stone: 20, workPoints: 40000 },
    farm_dairy: { wood: 80, stone: 30, workPoints: 40000 },
    lumber_mill: { wood: 110, stone: 40, workPoints: 70000 },
    iron_mine: { wood: 60, stone: 20, workPoints: 120000 },
    quarry: { wood: 60, stone: 20, workPoints: 120000 },
    toolmaker: { wood: 300, stone: 120, workPoints: 140000 },
    charcoal_works: { wood: 300, stone: 120, workPoints: 90000 },
    farm_cane: { wood: 60, stone: 20, workPoints: 55000 },
    sugar_mill: { wood: 1000, stone: 600, iron: 400, workPoints: 1000000 },
    farm_vegetables: { wood: 600, stone: 200, workPoints: 400000 },
    farm_spices: { wood: 700, stone: 200, workPoints: 800000 },
    salt_gatherer: { wood: 1500, stone: 300, iron: 200, workPoints: 500000 },
    flour_mill: { wood: 1500, stone: 300, iron: 200, steel: 200, workPoints: 1500000 },
    bread_factory: { wood: 4500, stone: 1000, iron: 500, steel: 1000, workPoints: 3000000 },
    farm_cocoa: { wood: 700, stone: 200, workPoints: 700000 },
    chocolate_factory: { wood: 4500, stone: 1000, iron: 500, steel: 750, workPoints: 7750000 },
    cheese_factory: { wood: 4500, stone: 1000, iron: 500, steel: 1000, workPoints: 2000000 },
    farm_fruit: { wood: 1000, stone: 600, iron: 400, workPoints: 1000000 },
    sand_pit: { wood: 1000, stone: 600, iron: 400, workPoints: 500000 },
    steelworks: { wood: 2000, stone: 1200, iron: 800, workPoints: 2000000 },
    farm_sheep: { wood: 90, stone: 20, workPoints: 100000 },
    farm_cotton: { wood: 180, stone: 40, workPoints: 200000 },
    farm_olive: { wood: 1000, stone: 200, iron: 100, steel: 250, workPoints: 2600000 },
    farm_tobacco: { wood: 1000, stone: 100, iron: 100, steel: 150, workPoints: 1450000 },
    farm_grape: { wood: 1000, stone: 200, iron: 100, steel: 250, workPoints: 2100000 },
    thread_factory: { wood: 1200, stone: 400, workPoints: 800000 },
    textile_factory: { wood: 1800, stone: 600, workPoints: 1200000 },
    furniture_factory: { wood: 1200, stone: 400, workPoints: 600000 },
    utilities_factory: { wood: 1800, stone: 600, workPoints: 1600000 },
    glass_factory: { wood: 1200, stone: 400, workPoints: 1100000 },
    gold_mine: { wood: 10000, stone: 2000, iron: 1000, steel: 2500, workPoints: 6000000 },
    silver_mine: { wood: 10000, stone: 2000, iron: 1000, steel: 2500, workPoints: 6000000 },
    shop_olive_oil: { wood: 300, stone: 150, steel: 75, workPoints: 250000 },
    shop_tobacco: { wood: 300, stone: 150, steel: 75, workPoints: 250000 },
    shop_alcohol: { wood: 300, stone: 150, steel: 75, workPoints: 250000 },
    shop_wine: { wood: 300, stone: 150, steel: 75, workPoints: 250000 },
    shop_tincture: { wood: 200, stone: 100, steel: 50, workPoints: 150000 },
    shop_carpet: { wood: 200, stone: 100, steel: 50, workPoints: 150000 },
    shop_porcelain: { wood: 200, stone: 100, steel: 50, workPoints: 150000 },
    shop_artwork: { wood: 1200, stone: 600, steel: 300, workPoints: 900000 },
    shop_jewelry: { wood: 1200, stone: 600, steel: 300, workPoints: 900000 },
    shop_rarities: { wood: 1600, stone: 900, steel: 450, workPoints: 1500000 },
    tincture_factory: { wood: 15000, stone: 3000, iron: 1500, steel: 4000, workPoints: 9500000 },
    carpet_factory: { wood: 15000, stone: 3000, iron: 1500, steel: 4000, workPoints: 9500000 },
    porcelain_factory: { wood: 12000, stone: 2000, iron: 1000, steel: 4000, workPoints: 7000000 },
    olive_oil_factory: { wood: 75000, stone: 15000, iron: 7500, steel: 20000, workPoints: 50000000 },
    tobacco_factory: { wood: 65000, stone: 13000, iron: 6500, steel: 18000, workPoints: 45000000 },
    alcohol_distillery: { wood: 70000, stone: 14000, iron: 7000, steel: 19000, workPoints: 47500000 },
    wine_factory: { wood: 75000, stone: 15000, iron: 7500, steel: 20000, workPoints: 40000000 },
    artist_workshop: { wood: 30000, stone: 6000, iron: 3000, steel: 8000, workPoints: 19000000 },
    jeweler_workshop: { wood: 40000, stone: 9000, iron: 3000, steel: 8000, workPoints: 20000000 },
    craftsman_workshop: { wood: 60000, stone: 13500, iron: 4500, steel: 12000, workPoints: 30000000 },
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
    ['shop_olive_oil', 'olive_oil', 6, 8, 234],
    ['shop_tobacco', 'tobacco', 12, 8, 102],
    ['shop_alcohol', 'alcohol', 4, 8, 325],
    ['shop_wine', 'wine', 8, 8, 153],
    ['shop_tincture', 'tincture', 13, 8, 64],
    ['shop_carpet', 'carpet', 2, 8, 400],
    ['shop_porcelain', 'porcelain', 3, 8, 380],
    ['shop_artwork', 'artwork', 8, 16, 204],
    ['shop_jewelry', 'jewelry', 8, 16, 204],
    ['shop_rarities', 'rarities', 7, 24, 358],
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
      harvestWorkPointsPerUnit: 13.33,
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
        { buildingId: 'near', productId: 'wood', quantity: 20 },
        { buildingId: 'near', productId: 'stone', quantity: 10 },
      ],
      cost,
    ),
    [
      { buildingId: 'near', productId: 'wood', quantity: 20 },
      { buildingId: 'near', productId: 'stone', quantity: 10 },
    ],
  );
  assert.equal(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'near', productId: 'wood', quantity: 20 },
        { buildingId: 'near', productId: 'stone', quantity: 9 },
      ],
      cost,
    ),
    null,
  );
});

test('requires iron and steel as well as wood and stone for construction costs that specify them', () => {
  const cost = RESIDENCES.cheese_factory.cost;
  assert.deepEqual(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 4500 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 1000 },
        { buildingId: 'warehouse', productId: 'iron', quantity: 500 },
        { buildingId: 'warehouse', productId: 'steel', quantity: 1000 },
      ],
      cost,
    ),
    [
      { buildingId: 'warehouse', productId: 'wood', quantity: 4500 },
      { buildingId: 'warehouse', productId: 'stone', quantity: 1000 },
      { buildingId: 'warehouse', productId: 'iron', quantity: 500 },
      { buildingId: 'warehouse', productId: 'steel', quantity: 1000 },
    ],
  );
  assert.equal(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 4500 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 1000 },
      ],
      cost,
    ),
    null,
  );
  const steelCost = RESIDENCES.thread_factory.cost;
  assert.deepEqual(
    planConstructionMaterialWithdrawals(
      [
        { buildingId: 'warehouse', productId: 'wood', quantity: 1200 },
        { buildingId: 'warehouse', productId: 'stone', quantity: 400 },
      ],
      steelCost,
    ),
    [
      { buildingId: 'warehouse', productId: 'wood', quantity: 1200 },
      { buildingId: 'warehouse', productId: 'stone', quantity: 400 },
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
