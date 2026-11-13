import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getPopulationGrowthRate,
  getUnemploymentRate,
  isCityNeighbor,
  planMonthlyPopulationChange,
  roundPopulationChange,
  type PopulationCity,
  type PopulationResidence,
} from './population.js';

describe('population change', () => {
  it('uses the confirmed wellbeing bands for internal growth', () => {
    assert.equal(getPopulationGrowthRate(0), 0.001);
    assert.equal(getPopulationGrowthRate(49.99), 0.001);
    assert.equal(getPopulationGrowthRate(50), 0.001);
    assert.equal(getPopulationGrowthRate(50.01), 0.003);
    assert.equal(getPopulationGrowthRate(99), 0.003);
    assert.equal(getPopulationGrowthRate(100), 0.015);
    assert.equal(getPopulationGrowthRate(124), 0.015);
    assert.equal(getPopulationGrowthRate(125), 0.03);
    assert.equal(getPopulationGrowthRate(149), 0.03);
    assert.equal(getPopulationGrowthRate(150), 0.015);
    assert.equal(getPopulationGrowthRate(162), 0.015);
    assert.equal(getPopulationGrowthRate(163), 0.003);
  });

  it('calculates unemployment from the unemployed share and handles zero population', () => {
    assert.equal(getUnemploymentRate(100, 90), 0.1);
    assert.equal(getUnemploymentRate(100, 110), 0);
    assert.equal(getUnemploymentRate(0, 0), 0);
  });

  it('rounds fractional residents probabilistically', () => {
    assert.equal(roundPopulationChange(100, 0.015, () => 0.49), 2);
    assert.equal(roundPopulationChange(100, 0.015, () => 0.51), 1);
    assert.equal(roundPopulationChange(100, 0.01), 1);
  });

  it('treats the 850-tile neighbor limit as exclusive', () => {
    assert.equal(isCityNeighbor({ centerX: 0, centerY: 0 }, { centerX: 849, centerY: 0 }), true);
    assert.equal(isCityNeighbor({ centerX: 0, centerY: 0 }, { centerX: 850, centerY: 0 }), false);
  });

  it('grows eligible homes only while job offers remain and the city stays within the unemployment limit', () => {
    const cities: PopulationCity[] = [
      { id: 'growing', centerX: 0, centerY: 0, employed: 204, jobOffers: 1 },
      { id: 'no-offers', centerX: 1000, centerY: 0, employed: 9, jobOffers: 0 },
    ];
    const residences: PopulationResidence[] = [
      {
        id: 'a-nearly-full',
        cityId: 'growing',
        type: 'house_poor3',
        status: 'completed',
        occupants: 126,
        wellbeing: 125,
        rent: 1,
      },
      {
        id: 'b-after-threshold',
        cityId: 'growing',
        type: 'house_poor3',
        status: 'completed',
        occupants: 100,
        wellbeing: 125,
        rent: 1,
      },
      {
        id: 'no-jobs',
        cityId: 'no-offers',
        type: 'house_poor3',
        status: 'completed',
        occupants: 10,
        wellbeing: 150,
        rent: 1,
      },
    ];

    const plan = planMonthlyPopulationChange(cities, residences, () => 0);

    assert.equal(plan.occupantsByResidence.get('a-nearly-full'), 128);
    assert.equal(plan.occupantsByResidence.has('b-after-threshold'), false);
    assert.equal(plan.occupantsByResidence.has('no-jobs'), false);
  });

  it('distributes growth from full homes across empty residences by their capacity', () => {
    const city: PopulationCity = {
      id: 'city',
      centerX: 0,
      centerY: 0,
      employed: 40000,
      jobOffers: 1,
    };
    const fullHomes: PopulationResidence[] = [
      ...Array.from({ length: 312 }, (_, index) => ({
        id: `full-large-${String(index).padStart(3, '0')}`,
        cityId: 'city',
        type: 'house_poor3' as const,
        status: 'completed' as const,
        occupants: 128,
        wellbeing: 35,
        rent: 1,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `full-small-${index}`,
        cityId: 'city',
        type: 'house_poor2' as const,
        status: 'completed' as const,
        occupants: 32,
        wellbeing: 35,
        rent: 1,
      })),
    ];
    const emptyHomes: PopulationResidence[] = ['empty-a', 'empty-b'].map((id) => ({
      id,
      cityId: 'city',
      type: 'house_poor2',
      status: 'completed',
      occupants: 0,
      wellbeing: 0,
      rent: 1,
    }));

    const plan = planMonthlyPopulationChange(
      [city],
      [...fullHomes, ...emptyHomes],
      () => 0.99,
    );

    assert.equal(plan.occupantsByResidence.get('empty-a'), 32);
    assert.equal(plan.occupantsByResidence.get('empty-b'), 8);
    assert.equal(plan.populationChangeByCity.get('city'), 40);
  });

  it('weights the full-home wellbeing average by occupants before calculating growth', () => {
    const city: PopulationCity = {
      id: 'city',
      centerX: 0,
      centerY: 0,
      employed: 160,
      jobOffers: 1,
    };
    const residences: PopulationResidence[] = [
      {
        id: 'large-low-wellbeing',
        cityId: 'city',
        type: 'house_poor3',
        status: 'completed',
        occupants: 128,
        wellbeing: 0,
        rent: 1,
      },
      {
        id: 'small-high-wellbeing',
        cityId: 'city',
        type: 'house_poor2',
        status: 'completed',
        occupants: 32,
        wellbeing: 150,
        rent: 1,
      },
      {
        id: 'empty',
        cityId: 'city',
        type: 'house_poor1',
        status: 'completed',
        occupants: 0,
        wellbeing: 0,
        rent: 1,
      },
    ];

    const plan = planMonthlyPopulationChange([city], residences, () => 0.3);

    assert.equal(plan.occupantsByResidence.has('empty'), false);
    assert.equal(plan.populationChangeByCity.get('city'), 0);
  });

  it('reduces population in declining cities and transfers high-wellbeing emigrants', () => {
    const cities: PopulationCity[] = [
      { id: 'declining', centerX: 0, centerY: 0, employed: 178, jobOffers: 1 },
      { id: 'neighbor', centerX: 849, centerY: 0, employed: 90, jobOffers: 1 },
    ];
    const residences: PopulationResidence[] = [
      {
        id: 'low',
        cityId: 'declining',
        type: 'house_poor3',
        status: 'completed',
        occupants: 100,
        wellbeing: 40,
        rent: 1,
      },
      {
        id: 'high',
        cityId: 'declining',
        type: 'house_poor3',
        status: 'completed',
        occupants: 100,
        wellbeing: 120,
        rent: 2,
      },
      {
        id: 'neighbor-home',
        cityId: 'neighbor',
        type: 'house_poor3',
        status: 'completed',
        occupants: 100,
        wellbeing: 100,
        rent: 1,
      },
    ];

    const plan = planMonthlyPopulationChange(cities, residences, () => 0.99);

    assert.equal(plan.occupantsByResidence.get('low'), 98);
    assert.equal(plan.occupantsByResidence.get('high'), 99);
    assert.equal(plan.occupantsByResidence.get('neighbor-home'), 101);
    assert.deepEqual(plan.migrations, [
      { sourceCityId: 'declining', destinationCityId: 'neighbor', quantity: 1 },
    ]);
    assert.equal(plan.populationChangeByCity.get('declining'), -3);
    assert.equal(plan.populationChangeByCity.get('neighbor'), 1);
  });

  it('allows departures to leave the world when no eligible neighboring city can receive them', () => {
    const city: PopulationCity = {
      id: 'declining',
      centerX: 0,
      centerY: 0,
      employed: 88,
      jobOffers: 0,
    };
    const residence: PopulationResidence = {
      id: 'high',
      cityId: 'declining',
      type: 'house_poor3',
      status: 'completed',
      occupants: 100,
      wellbeing: 120,
      rent: 1,
    };

    const plan = planMonthlyPopulationChange([city], [residence], () => 0.99);

    assert.equal(plan.occupantsByResidence.get('high'), 99);
    assert.deepEqual(plan.migrations, []);
  });
});
