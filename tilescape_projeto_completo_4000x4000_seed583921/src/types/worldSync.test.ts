import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyEntityDelta,
  createWorldDelta,
  type WorldEntities,
} from './worldSync.js';

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
