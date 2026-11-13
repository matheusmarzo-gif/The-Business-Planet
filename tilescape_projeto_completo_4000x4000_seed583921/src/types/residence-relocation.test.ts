import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateResidenceAppealsFromIncome,
  calculateResidenceAppeals,
  calculateResidenceBenefit,
  getResidenceBenefitIncome,
  planResidenceRelocations,
} from './residence-relocation.js';

const residence = (overrides: Partial<Parameters<typeof planResidenceRelocations>[0][number]>) => ({
  id: 'source',
  cityId: 'city',
  type: 'house_poor1' as const,
  rent: 10,
  occupants: 10,
  capacity: 10,
  monthlyCost: 100,
  dailyIncome: 20,
  internalAppeal: 50,
  ...overrides,
});

test('calculates employability and regional appeal from completed homes in the same city and radius', () => {
  const appeals = calculateResidenceAppeals([
    {
      id: 'home',
      cityId: 'city',
      x: 0,
      y: 0,
      salaryAverage: 10,
      cityAverageSalary: 20,
      constructionAppeal: 40,
    },
    {
      id: 'neighbor',
      cityId: 'city',
      x: 10,
      y: 0,
      salaryAverage: 30,
      cityAverageSalary: 20,
      constructionAppeal: 80,
    },
    {
      id: 'far',
      cityId: 'city',
      x: 21,
      y: 0,
      salaryAverage: 100,
      cityAverageSalary: 20,
      constructionAppeal: 100,
    },
    {
      id: 'other-city',
      cityId: 'other',
      x: 1,
      y: 0,
      salaryAverage: 100,
      cityAverageSalary: 20,
      constructionAppeal: 100,
    },
  ]);
  assert.deepEqual(appeals.get('home'), {
    employabilityAppeal: 0.5,
    regionalAppeal: 1,
    constructionAppeal: 40,
    internalAppeal: 40,
  });
  assert.equal(appeals.get('neighbor')?.regionalAppeal, 1);
  assert.equal(appeals.get('neighbor')?.internalAppeal, 80);
});

test('keeps internal appeal at least 10', () => {
  const [appeal] = calculateResidenceAppeals([
    {
      id: 'home',
      cityId: 'city',
      x: 0,
      y: 0,
      salaryAverage: 0,
      cityAverageSalary: 20,
      constructionAppeal: 40,
    },
  ]).values();
  assert.equal(appeal.internalAppeal, 10);
});

test('calculates city-wide weighted income and includes vacant homes in regional appeal', () => {
  const appeals = calculateResidenceAppealsFromIncome([
    {
      id: 'home-a',
      cityId: 'city',
      x: 0,
      y: 0,
      salaryAverage: 10,
      occupants: 2,
      constructionAppeal: 10,
    },
    {
      id: 'home-b',
      cityId: 'city',
      x: 1,
      y: 0,
      salaryAverage: 30,
      occupants: 1,
      constructionAppeal: 10,
    },
    {
      id: 'vacant-home',
      cityId: 'city',
      x: 2,
      y: 0,
      salaryAverage: 100,
      occupants: 0,
      constructionAppeal: 10,
    },
  ]);

  assert.ok(Math.abs((appeals.get('home-a')?.employabilityAppeal ?? 0) - 0.6) < 1e-12);
  assert.ok(Math.abs((appeals.get('home-a')?.regionalAppeal ?? 0) - 2.8) < 1e-12);
  assert.ok(Math.abs((appeals.get('vacant-home')?.regionalAppeal ?? 0) - 2.8) < 1e-12);
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

test('can reevaluate only the residence whose rent changed', () => {
  const moves = planResidenceRelocations(
    [
      residence({ id: 'other-source', occupants: 10, capacity: 10, rent: 40 }),
      residence({ id: 'target-source', occupants: 10, capacity: 10, rent: 40 }),
      residence({ id: 'destination', occupants: 0, capacity: 10, rent: 1 }),
    ],
    'target-source',
  );
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => move.sourceId === 'target-source'));
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

test('uses the recalculated internal appeal when comparing residences', () => {
  const moves = planResidenceRelocations([
    residence({ id: 'source', occupants: 10, rent: 10, internalAppeal: 20 }),
    residence({
      id: 'destination',
      occupants: 0,
      capacity: 10,
      rent: 10,
      internalAppeal: 80,
    }),
  ]);
  assert.equal(moves.length, 1);
  assert.ok(moves[0].associatedDestination > moves[0].associatedSource);
});

test('returns the associated benefit and its tooltip components', () => {
  const calculation = calculateResidenceBenefit({
    rent: 10,
    monthlyCost: 100,
    dailyIncome: 20,
    employabilityAppeal: 1,
    regionalAppeal: 1,
    constructionAppeal: 50,
  });
  assert.equal(calculation.monthlyCost, 100);
  assert.equal(calculation.internalAppeal, 50);
  assert.deepEqual(calculation.productContributions, []);
  assert.ok(calculation.errorBenefit > 0);
  assert.ok(calculation.idealBenefit > 0);
  assert.ok(calculation.associatedBenefit > 0);
});

test('uses city average income for empty homes and residence average otherwise', () => {
  const emptyHomeIncome = getResidenceBenefitIncome(0, 0, 20);
  assert.equal(emptyHomeIncome, 20);
  assert.equal(getResidenceBenefitIncome(3, 10, 20), 10);
  const calculation = calculateResidenceBenefit({
    rent: 1,
    monthlyCost: 20,
    dailyIncome: emptyHomeIncome,
    employabilityAppeal: 1,
    regionalAppeal: 1,
    constructionAppeal: 50,
  });
  assert.ok(calculation.errorBenefit > 0);
  assert.ok(calculation.idealBenefit > 0);
});
