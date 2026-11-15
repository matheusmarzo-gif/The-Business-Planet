import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEntityDelta,
  applyWorldBuildingDelta,
  createWorldDelta,
  type WorldEntities,
} from './worldSync.js';
import type { ResidentialBuilding, ResidentialBuildingSummary } from './residence.js';

type Building = { id: string; stock: number };

const city = (id: string, name: string) => ({
  id,
  name,
  centerX: 100,
  centerY: 100,
  minimumWage: 10,
  population: 20,
  wellbeing: 80,
  economy: 5,
  zones: [],
});

const initial: WorldEntities<Building> = {
  cities: [city('city-a', 'Old name')],
  roads: [
    { x: 10, y: 11, cityId: 'city-a' },
    { x: 12, y: 13, cityId: 'city-a' },
  ],
  buildings: [
    { id: 'building-a', stock: 5 },
    { id: 'building-b', stock: 7 },
  ],
};

test('creates a compact delta containing only changed, added, and removed entities', () => {
  const unchangedBuildings = Array.from({ length: 32 }, (_, index) => ({
    id: `unchanged-building-${index}`,
    stock: index,
  }));
  const previous = {
    ...initial,
    buildings: [...initial.buildings, ...unchangedBuildings],
  };
  const current: WorldEntities<Building> = {
    cities: [city('city-a', 'New name'), city('city-b', 'New city')],
    roads: [
      { x: 10, y: 11, cityId: 'city-a' },
      { x: 14, y: 15, cityId: 'city-b' },
    ],
    buildings: [
      ...unchangedBuildings,
      { id: 'building-a', stock: 4 },
      { id: 'building-c', stock: 1 },
    ],
  };
  const delta = createWorldDelta(previous, current, 4);

  assert.deepEqual(delta, {
    type: 'world_delta',
    revision: 4,
    cities: {
      upsert: [city('city-a', 'New name'), city('city-b', 'New city')],
      removed: [],
    },
    roads: {
      upsert: [{ x: 14, y: 15, cityId: 'city-b' }],
      removed: [{ x: 12, y: 13 }],
    },
    buildings: {
      upsert: [{ id: 'building-a', stock: 4 }, { id: 'building-c', stock: 1 }],
      removed: ['building-b'],
    },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(delta)) < Buffer.byteLength(JSON.stringify(current)));
});

test('returns null when the world has not changed', () => {
  assert.equal(createWorldDelta(initial, initial, 0), null);
});

test('applies entity updates and removals by stable entity key', () => {
  const result = applyEntityDelta(
    initial.roads,
    {
      upsert: [{ x: 14, y: 15, cityId: 'city-b' }],
      removed: [{ x: 12, y: 13 }],
    },
    ({ x, y }) => `${x},${y}`,
    ({ x, y }) => `${x},${y}`,
  );
  assert.deepEqual(result, [
    { x: 10, y: 11, cityId: 'city-a' },
    { x: 14, y: 15, cityId: 'city-b' },
  ]);
});

test('preserves owned building details when its public summary is updated', () => {
  const ownedBuilding: ResidentialBuilding = {
    id: 'owned-farm',
    ownerName: 'Player',
    isOwnedByCurrentUser: true,
    type: 'farm_rice',
    buildingNumber: 1,
    x: 10,
    y: 20,
    cityId: 'city-a',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-02T00:00:00.000Z',
    wage: 25,
    workHoursPerDay: 8,
    minimumWorkerTechnique: 10,
    rent: 10,
    occupants: 0,
    wellbeing: 0,
    desiredWorkers: 4,
    workPointsDone: 0,
    price: 10,
    stock: 7,
    stockLevels: {},
    warehouseIds: [],
    toolStock: 1,
    woodStock: 0,
    ironStock: 0,
    charcoalStock: 0,
    sugarcaneStock: 0,
    inputStocks: {},
    selectedInputProductId: null,
    efficiencyPenalty: 0,
    farmAutomation: {
      enabled: false,
      plantingMonths: [],
      plantingWorkers: 0,
      harvestWorkers: 0,
    },
    crop: null,
    employed: 3,
    averageIncome: 0,
    averageWorkerTechnique: null,
  };
  const summary: ResidentialBuildingSummary = {
    dataLevel: 'summary',
    id: ownedBuilding.id,
    ownerName: 'Player',
    isOwnedByCurrentUser: true,
    type: ownedBuilding.type,
    buildingNumber: ownedBuilding.buildingNumber ?? 1,
    x: 11,
    y: ownedBuilding.y,
    cityId: ownedBuilding.cityId,
    status: ownedBuilding.status,
    startedAt: ownedBuilding.startedAt,
    completedAt: ownedBuilding.completedAt,
  };

  const [updated] = applyWorldBuildingDelta(
    [ownedBuilding],
    { upsert: [summary], removed: [] },
  );

  assert.ok(updated);
  assert.equal('dataLevel' in updated, false);
  if ('dataLevel' in updated) return;
  assert.equal(updated.stock, 7);
  assert.equal(updated.wage, 25);
  assert.equal(updated.x, 11);
});
