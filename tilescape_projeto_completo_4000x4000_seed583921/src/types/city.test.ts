import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
  type CityZone,
} from './city';
import { STARTING_BALANCE, formatMoney } from './wallet';
import {
  allocateImmigrants,
  getCityPopulation,
} from './immigration';
import {
  isTileInResidenceFootprint,
  parseRent,
  getResidencePlacementError,
  isWithinWorkerSearchRadius,
  parseWorkSettings,
  RESIDENCES,
  type ResidentialBuilding,
} from './residence';
import { getRoadPlacementError } from './road';
import { allocateWorkers, getDailyWorkPoints, getHoursFactor, getPayroll, getRestFactor, getWorkBenefit } from './employment';
import {
  getPurchaseBenefit,
  getPurchaseQuantity,
  getShopSalesCapacity,
  parsePrice,
  planRiceSales,
} from './commerce';
import { parseWarehouseSetting } from './warehouse';

const city = { centerX: 1000, centerY: 1000 };

describe('wallet', () => {
  it('starts with C$ 10.000 and formats money in Brazilian style', () => {
    assert.equal(STARTING_BALANCE, 10000);
    assert.equal(formatMoney(STARTING_BALANCE).replace(/\u00a0/g, ' '), 'C$ 10.000');
  });
});

describe('rice sales', () => {
  const shop = (id: string, x: number, price: number, stock: number, capacity: number) => ({
    id,
    type: 'shop_rice' as const,
    x,
    y: 0,
    price,
    stock,
    capacity,
  });
  const home = (id: string, x: number, occupants: number, averageIncome: number) => ({
    id,
    type: 'house_poor1' as const,
    x,
    y: 0,
    occupants,
    averageIncome,
  });

  it('computes capacity, price, benefit and quantity', () => {
    assert.equal(getShopSalesCapacity(99), 0);
    assert.equal(getShopSalesCapacity(250), 10);
    assert.equal(parsePrice({ price: 0 }), null);
    assert.equal(parsePrice({ price: 12 }), 12);
    assert.equal(getPurchaseBenefit(30, 10, 10), 8);
    // 10 pessoas * 0,03 * max(4, 1) = 1,2
    assert.equal(getPurchaseQuantity(10, 10, 10, () => 0.5), 1);
    assert.equal(getPurchaseQuantity(10, 10, 10, () => 0.1), 2);
    // 1 pessoa: 0,12 -> 12% de chance de comprar 1 unidade
    assert.equal(getPurchaseQuantity(1, 10, 10, () => 0.11), 1);
    assert.equal(getPurchaseQuantity(1, 10, 10, () => 0.13), 0);
  });

  it('buys from the best benefit first, within capacity, stock and radius', () => {
    const purchases = planRiceSales(
      [home('a', 10, 100, 50), home('far', 500, 100, 50)],
      [shop('cheap', 0, 5, 100, 4), shop('dear', 4, 20, 100, 100), shop('empty', 8, 1, 0, 100)],
      () => 0,
    );
    // Vma = (5+20+1)/3; "cheap" tem o maior benefício, mas só vende 4 (capacidade); o resto vem de "dear".
    assert.deepEqual(purchases, [
      { shopId: 'cheap', residenceId: 'a', quantity: 4 },
      { shopId: 'dear', residenceId: 'a', quantity: purchases[1].quantity },
    ]);
    assert.ok(purchases[1].quantity > 0);
    assert.equal(purchases.some((purchase) => purchase.residenceId === 'far'), false);
  });
});

describe('work settings', () => {
  it('accepts valid wage and hours and rejects invalid values', () => {
    assert.deepEqual(parseWorkSettings({ wage: 15, workHoursPerDay: 8, desiredWorkers: 3 }), {
      wage: 15,
      workHoursPerDay: 8,
      desiredWorkers: 3,
    });
    assert.equal(parseWorkSettings({ wage: 15, workHoursPerDay: 8 }), null);
    assert.equal(parseWorkSettings({ wage: 15, workHoursPerDay: 8, desiredWorkers: -1 }), null);
    assert.equal(parseWorkSettings({ wage: -1, workHoursPerDay: 8, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 3, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 15, desiredWorkers: 0 }), null);
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 4, desiredWorkers: 0 }));
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 14, desiredWorkers: 0 }));
    assert.equal(parseWorkSettings({ wage: 1.5, workHoursPerDay: 8, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings(null), null);
  });

  it('computes the work benefit and allocates workers from best to worst', () => {
    assert.equal(getHoursFactor(8), 1);
    assert.equal(getHoursFactor(14), 0.5);
    assert.equal(getHoursFactor(2), 0.5);
    assert.equal(getWorkBenefit(10, 80, 8), 100);
    assert.equal(getRestFactor(4), 1.2);
    assert.equal(getRestFactor(8), 1);
    assert.ok(Math.abs(getRestFactor(14) - 0.8) < 1e-9);
    assert.equal(getDailyWorkPoints(8, 100, 100), 100);
    assert.equal(getDailyWorkPoints(8, 50, 100), 50);
    assert.ok(Math.abs(getDailyWorkPoints(4, 100, 100) - 60) < 1e-9);
    const workplace = (id: string, x: number, wage: number, desiredWorkers: number) => ({
      id,
      type: 'farm_rice' as const,
      x,
      y: 0,
      wage,
      workHoursPerDay: 8,
      desiredWorkers,
    });
    const homes = [
      { id: 'a', type: 'house_poor1' as const, x: 10, y: 0, occupants: 4 },
      { id: 'b', type: 'house_poor1' as const, x: 12, y: 0, occupants: 4 },
      { id: 'far', type: 'house_poor1' as const, x: 500, y: 0, occupants: 4 },
    ];
    const assignments = allocateWorkers(homes, [
      workplace('rich', 0, 30, 5),
      workplace('poor', 4, 10, 10),
      workplace('closed', 8, 99, 0),
    ]);
    // "a" escolhe a melhor (benefício 18,75); com 1 vaga restante o benefício de "rich" cai e "b" vai para "poor".
    assert.deepEqual(assignments, [
      { workplaceId: 'rich', residenceId: 'a', count: 4 },
      { workplaceId: 'poor', residenceId: 'b', count: 4 },
    ]);
    const total = (id: string) =>
      assignments.filter((job) => job.workplaceId === id).reduce((sum, job) => sum + job.count, 0);
    assert.equal(total('rich'), 4);
    assert.equal(total('poor'), 4);
    assert.equal(assignments.some((job) => job.residenceId === 'far'), false);
    assert.deepEqual(
      [...getPayroll(
        [
          { id: 'rich', ownerId: 'u1', wage: 30 },
          { id: 'poor', ownerId: 'u1', wage: 10 },
        ],
        assignments,
      )],
      [['u1', 160]],
    );
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

    it('places rice farms only in rural zones next to a road', () => {
      const ruralCity = {
        ...residentialCity,
        zones: [{ id: 'rural', cityId: 'city', type: 'rural' as const, minX: 0, minY: 0, maxX: 300, maxY: 300 }],
      };
      const position = { x: 20, y: 20 };
      const road = [{ x: 19, y: 20 }];
      assert.equal(getResidencePlacementError('farm_rice', position, [ruralCity], [], road, allLand, map), null);
      assert.equal(
        getResidencePlacementError('farm_rice', position, [ruralCity], [], [], allLand, map),
        'not_adjacent_to_road',
      );
      assert.equal(
        getResidencePlacementError('farm_rice', position, [residentialCity], [], road, allLand, map),
        'outside_rural_zone',
      );
      assert.equal(
        getResidencePlacementError('house_poor1', position, [ruralCity], [], road, allLand, map),
        'outside_urban_zone',
      );
    });

    it('places rice shops only in urban zones next to a road, and not for immigrants', () => {
      const position = { x: 20, y: 20 };
      const road = [{ x: 19, y: 20 }];
      assert.equal(getResidencePlacementError('shop_rice', position, [residentialCity], [], road, allLand, map), null);
      assert.equal(
        getResidencePlacementError('shop_rice', position, [residentialCity], [], [], allLand, map),
        'not_adjacent_to_road',
      );
      assert.equal(
        getResidencePlacementError('shop_rice', position, [{ ...residentialCity, zones: [] }], [], road, allLand, map),
        'outside_urban_zone',
      );
    });

    it('places warehouses only in rural zones next to a road', () => {
      const ruralCity = {
        ...residentialCity,
        zones: [{ id: 'rural', cityId: 'city', type: 'rural' as const, minX: 0, minY: 0, maxX: 300, maxY: 300 }],
      };
      const position = { x: 20, y: 20 };
      const road = [{ x: 19, y: 20 }];
      assert.equal(getResidencePlacementError('warehouse', position, [ruralCity], [], road, allLand, map), null);
      assert.equal(
        getResidencePlacementError('warehouse', position, [residentialCity], [], road, allLand, map),
        'outside_rural_zone',
      );
      assert.equal(
        getResidencePlacementError('warehouse', position, [ruralCity], [], [], allLand, map),
        'not_adjacent_to_road',
      );
    });

    it('validates warehouse product settings', () => {
      const valid = { productId: 'rice', desiredStock: 10, price: 5, mode: 'buy' };
      assert.deepEqual(parseWarehouseSetting(valid), valid);
      assert.equal(parseWarehouseSetting({ ...valid, productId: 'unknown' }), null);
      assert.equal(parseWarehouseSetting({ ...valid, price: -1 }), null);
      assert.equal(parseWarehouseSetting({ ...valid, desiredStock: 1.5 }), null);
      assert.equal(parseWarehouseSetting({ ...valid, mode: 'trade' }), null);
    });

    it('limits the worker search area to 60 tiles from the building center', () => {
      const farm = { type: 'farm_rice' as const, x: 100, y: 100 };
      assert.equal(isWithinWorkerSearchRadius(farm, { x: 160, y: 102 }), true);
      assert.equal(isWithinWorkerSearchRadius(farm, { x: 170, y: 102 }), false);
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
        desiredWorkers: 0,
        workPointsDone: 0,
        price: 10,
        stock: 0,
        employed: 0,
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
        desiredWorkers: 0,
        workPointsDone: 0,
        price: 10,
        stock: 0,
        employed: 0,
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
