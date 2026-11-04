import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
  type CityZone,
} from './city';
import {
  allocateImmigrants,
  getCityPopulation,
} from './immigration';
import {
  isTileInResidenceFootprint,
  parseRent,
  getResidencePlacementError,
  parseWorkSettings,
  RESIDENCES,
  type ResidentialBuilding,
} from './residence';
import { getRoadPlacementError } from './road';

const city = { centerX: 1000, centerY: 1000 };

describe('work settings', () => {
  it('accepts valid wage and hours and rejects invalid values', () => {
    assert.deepEqual(parseWorkSettings({ wage: 15, workHoursPerDay: 8 }), {
      wage: 15,
      workHoursPerDay: 8,
    });
    assert.equal(parseWorkSettings({ wage: -1, workHoursPerDay: 8 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 3 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 15 }), null);
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 4 }));
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 14 }));
    assert.equal(parseWorkSettings({ wage: 1.5, workHoursPerDay: 8 }), null);
    assert.equal(parseWorkSettings(null), null);
  });

  it('requires rent of at least 1', () => {
    assert.equal(parseRent({ rent: 1 }), 1);
    assert.equal(parseRent({ rent: 0 }), null);
    assert.equal(parseRent({ rent: 2.5 }), null);
  });
});

describe('immigration', () => {
  const home = (id: string, type: 'house_poor1' | 'house_poor2', rent: number, occupants = 0) => ({
    id,
    type,
    status: 'completed' as const,
    rent,
    occupants,
  });

  it('fills the cheapest homes first and breaks ties by local appeal', () => {
    const result = allocateImmigrants([
      home('expensive', 'house_poor1', 20),
      home('big-cheap', 'house_poor2', 5),
      home('small-cheap', 'house_poor1', 5),
    ]);
    assert.equal(result.get('small-cheap'), 4);
    assert.equal(result.get('big-cheap'), 32);
    assert.equal(result.get('expensive'), 4);
  });

  it('respects capacity, ignores unfinished homes and counts population', () => {
    const result = allocateImmigrants(
      [
        { ...home('building', 'house_poor1', 1), status: 'under_construction' as const },
        home('full', 'house_poor1', 1, 4),
      ],
      40,
    );
    assert.equal(result.size, 0);
    assert.equal(getCityPopulation([{ occupants: 4 }, { occupants: 7 }]), 11);
  });
});

describe('municipal zones', () => {
  it('accepts rectangles on the municipal boundary and rejects rectangles outside it', () => {
    assert.equal(
      getCityZonePlacementError(
        { minX: 849, minY: 849, maxX: 1151, maxY: 1151 },
        city,
        [],
      ),
      null,
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 848, minY: 849, maxX: 850, maxY: 850 },
        city,
        [],
      ),
      'zone_outside_municipality',
    );
  });

  describe('residential building placement', () => {
    const residentialCity = {
      id: 'city',
      name: 'Test',
      centerX: 100,
      centerY: 100,
      population: 0,
      wellbeing: 0,
      economy: 0,
      zones: [{ id: 'zone', cityId: 'city', type: 'urban' as const, minX: 0, minY: 0, maxX: 300, maxY: 300 }],
    };
    const allLand = () => true;
    const map = { width: 4000, height: 4000 };

    it('requires an urban lot, empty footprint, land, and orthogonally adjacent road', () => {
      const type = 'house_poor1';
      const position = { x: 20, y: 20 };
      assert.equal(
        getResidencePlacementError(type, position, [residentialCity], [], [{ x: 19, y: 20 }], allLand, map),
        null,
      );
      assert.equal(
        getResidencePlacementError(type, position, [residentialCity], [], [{ x: 19, y: 19 }], allLand, map),
        'not_adjacent_to_road',
      );
      assert.equal(
        getResidencePlacementError(
          type,
          position,
          [{ ...residentialCity, zones: [] }],
          [],
          [{ x: 19, y: 20 }],
          allLand,
          map,
        ),
        'outside_urban_zone',
      );
      assert.equal(
        getResidencePlacementError(type, position, [residentialCity], [], [{ x: 20, y: 20 }], allLand, map),
        'road_overlap',
      );
      assert.equal(
        getResidencePlacementError(type, position, [residentialCity], [], [{ x: 19, y: 20 }], () => false, map),
        'water',
      );
    });

    it('prevents roads from being built over residential footprints', () => {
      const house: ResidentialBuilding = {
        id: 'house',
        type: 'house_poor2',
        x: 20,
        y: 20,
        cityId: 'city',
        status: 'under_construction',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        wage: 10,
        workHoursPerDay: 8,
        rent: 10,
        occupants: 0,
      };

      assert.equal(
        getRoadPlacementError(
          { x: 22, y: 22 },
          [{ id: 'city', centerX: 100, centerY: 100 }],
          () => true,
          [house],
        ),
        'building_overlap',
      );
      assert.equal(
        getRoadPlacementError(
          { x: 23, y: 22 },
          [{ id: 'city', centerX: 100, centerY: 100 }],
          () => true,
          [house],
        ),
        null,
      );
    });

    it('checks footprint collisions across both residence sizes', () => {
      const first: ResidentialBuilding = {
        id: 'house',
        type: 'house_poor1',
        x: 20,
        y: 20,
        cityId: 'city',
        status: 'under_construction',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        wage: 10,
        workHoursPerDay: 8,
        rent: 10,
        occupants: 0,
      };
      assert.equal(
        getResidencePlacementError(
          'house_poor2',
          { x: 21, y: 20 },
          [residentialCity],
          [first],
          [{ x: 20, y: 19 }],
          allLand,
          map,
        ),
        'building_overlap',
      );
      assert.deepEqual(
        [RESIDENCES.house_poor1.width, RESIDENCES.house_poor1.height, RESIDENCES.house_poor1.capacity],
        [2, 2, 4],
      );
      assert.deepEqual(
        [RESIDENCES.house_poor2.width, RESIDENCES.house_poor2.height, RESIDENCES.house_poor2.capacity],
        [3, 3, 32],
      );
      assert.equal(isTileInResidenceFootprint(first, { x: 21, y: 21 }), true);
      assert.equal(isTileInResidenceFootprint(first, { x: 22, y: 21 }), false);
    });
  });

  it('rejects shared tiles between zones but allows adjacent rectangles', () => {
    const existing = [{ minX: 840, minY: 900, maxX: 850, maxY: 910 }];
    assert.equal(
      getCityZonePlacementError(
        { minX: 850, minY: 900, maxX: 860, maxY: 910 },
        city,
        existing,
      ),
      'zone_overlap',
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 851, minY: 900, maxX: 860, maxY: 910 },
        city,
        existing,
      ),
      null,
    );
  });

  it('maps construction categories to the required region type', () => {
    assert.equal(getRequiredCityZone('artesanais'), 'urban');
    assert.equal(getRequiredCityZone('comerciais'), 'urban');
    assert.equal(getRequiredCityZone('residencias'), 'urban');
    assert.equal(getRequiredCityZone('fazendas'), 'rural');
    assert.equal(getRequiredCityZone('recursos'), 'rural');
    assert.equal(getRequiredCityZone('industrias'), 'rural');
    assert.equal(getRequiredCityZone('prefeitura'), null);
  });

  it('requires every footprint tile to fit inside the required zone type', () => {
    const urban: CityZone = {
      id: 'urban',
      cityId: 'city',
      type: 'urban',
      minX: 10,
      minY: 10,
      maxX: 20,
      maxY: 20,
    };
    const footprint = [
      { minX: 11, minY: 11, maxX: 11, maxY: 11 },
      { minX: 12, minY: 11, maxX: 12, maxY: 11 },
    ];
    assert.equal(isFootprintInCityZone(footprint, [urban], 'urban'), true);
    assert.equal(isFootprintInCityZone(footprint, [urban], 'rural'), false);
    assert.equal(
      isFootprintInCityZone([...footprint, { minX: 21, minY: 11, maxX: 21, maxY: 11 }], [urban], 'urban'),
      false,
    );
  });
});
