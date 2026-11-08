import assert from 'node:assert/strict';
import test from 'node:test';
import { planResidenceRelocations } from './residence-relocation.js';

const residence = (overrides: Partial<Parameters<typeof planResidenceRelocations>[0][number]>) => ({
  id: 'source',
  cityId: 'city',
  type: 'house_poor1' as const,
  rent: 10,
  occupants: 10,
  capacity: 10,
  monthlyCost: 100,
  dailyIncome: 20,
  ...overrides,
});

test('moves the calculated percentage and respects destination capacity', () => {
  const moves = planResidenceRelocations([
    residence({ id: 'source', occupants: 10, capacity: 10, rent: 40 }),
    residence({ id: 'destination', occupants: 0, capacity: 3, rent: 1 }),
  ]);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].quantity, 3);
  assert.ok(moves[0].associatedDestination > moves[0].associatedSource);
});

test('does not move residents between cities or when the destination is not better', () => {
  assert.deepEqual(
    planResidenceRelocations([
      residence({ id: 'source', occupants: 10, rent: 10 }),
      residence({ id: 'other-city', cityId: 'other', occupants: 0, capacity: 10, rent: 1 }),
      residence({ id: 'same-city', occupants: 0, capacity: 10, rent: 50 }),
    ]),
    [],
  );
});
