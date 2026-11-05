import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
  type CityZone,
} from './city';
import { STARTING_BALANCE, formatMoney } from './wallet';
import { nextEfficiencyPenalty, planFishing, planProduction, rollToolDemand } from './fishing';
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
import { allocateWorkers, getDailyWorkPoints, getHoursFactor, getPayroll, getRestFactor, getWorkBenefit, getAverageIncomes } from './employment';
import {
  getPurchaseBenefit,
  getPurchaseQuantity,
  getShopSalesCapacity,
  parsePrice,
  planRiceSales,
} from './commerce';
import {
  canLinkToWarehouse,
  getTransportDemand,
  isWithinLinkRadius,
  parseWarehouseLink,
  planTransfers,
  planWarehouseTrades,
} from './logistics';
import {
  advanceGrowth,
  getHarvestDay,
  getPlantingFactor,
  planHarvest,
  type Crop,
} from './farming';
import { parseWarehouseSetting } from './warehouse';

const city = { centerX: 1000, centerY: 1000 };

describe('wallet', () => {
  it('starts with C$ 10.000 and formats money in Brazilian style', () => {
    assert.equal(STARTING_BALANCE, 10000);
    assert.equal(formatMoney(STARTING_BALANCE).replace(/\u00a0/g, ' '), 'C$ 10.000');
  });
});

describe('warehouse trading', () => {
  const warehouse = (
    id: string,
    ownerId: string,
    x: number,
    stock: [string, number][],
    settings: [string, number, number, 'sell' | 'buy'][],
    workPoints = 1e6,
  ) => ({
    id,
    ownerId,
    type: 'warehouse' as const,
    x,
    y: 0,
    capacityM3: 50,
    workPoints,
    stock: new Map(stock),
    settings: new Map(settings.map(([p, desired, price, mode]) => [p, { desired, price, mode }])),
  });

  it('buys the cheapest offers first, only below the buyer limit and above the seller desired stock', () => {
    const trades = planWarehouseTrades([
      warehouse('buyer', 'b', 0, [], [['rice', 30, 10, 'buy']]),
      warehouse('dear', 'c', 10, [['rice', 100]], [['rice', 90, 9, 'sell']]),
      warehouse('cheap', 'a', 20, [['rice', 100]], [['rice', 80, 5, 'sell']]),
      warehouse('toodear', 'd', 30, [['rice', 100]], [['rice', 0, 10, 'sell']]),
    ]);
    // cheap oferece 20 (>80), dear oferece 10 (>90); toodear não é menor que o limite 10.
    assert.deepEqual(trades, [
      { buyerId: 'buyer', sellerId: 'cheap', productId: 'rice', quantity: 20, price: 5 },
      { buyerId: 'buyer', sellerId: 'dear', productId: 'rice', quantity: 10, price: 9 },
    ]);
  });

  it('ignores same owner, out of range and limits by Work Points', () => {
    const base = warehouse('buyer', 'b', 0, [], [['rice', 30, 10, 'buy']], 20);
    assert.deepEqual(
      planWarehouseTrades([base, warehouse('same', 'b', 10, [['rice', 100]], [['rice', 0, 1, 'sell']])]),
      [],
    );
    assert.deepEqual(
      planWarehouseTrades([base, warehouse('far', 'a', 100, [['rice', 100]], [['rice', 0, 1, 'sell']])]),
      [],
    );
    // 20 pontos / 2 por unidade = 10 unidades.
    const limited = planWarehouseTrades([base, warehouse('near', 'a', 10, [['rice', 100]], [['rice', 0, 1, 'sell']])]);
    assert.equal(limited[0].quantity, 10);
  });
});

describe('rice farming', () => {
  const grow = (plantedDay: string, workPointsPerDay: number) => {
    let crop: Crop = { phase: 'growing', plantedDay, ratioSum: 0, days: 0, yieldUnits: 0, harvested: 0 };
    const end = getHarvestDay(plantedDay);
    for (let day = new Date(plantedDay + 'T00:00:00Z'); crop.phase === 'growing'; ) {
      day = new Date(day.getTime() + 86_400_000);
      crop = advanceGrowth(crop, day.toISOString().slice(0, 10), workPointsPerDay);
      assert.ok(day.toISOString().slice(0, 10) <= end);
    }
    return crop;
  };

  it('applies the planting month factor', () => {
    assert.deepEqual([1, 3, 4, 6, 7, 9, 10, 12].map(getPlantingFactor), [1, 1, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2]);
    assert.equal(getHarvestDay('2026-03-15'), '2026-09-15');
    assert.equal(getHarvestDay('2026-08-31'), '2027-02-28');
  });

  it('yields 1000 units at full productivity and scales with Work Points', () => {
    assert.equal(grow('2026-01-10', 1000).yieldUnits, 1000);
    assert.equal(grow('2026-01-10', 1500).yieldUnits, 1000);
    assert.equal(grow('2026-01-10', 800).yieldUnits, 800);
    assert.equal(grow('2026-05-10', 1000).yieldUnits, 600);
    assert.equal(grow('2026-08-10', 1000).yieldUnits, 400);
    assert.equal(grow('2026-11-10', 1000).yieldUnits, 200);
    assert.equal(grow('2026-01-10', 0).yieldUnits, 0);
  });

  it('harvests 20 Work Points per unit limited by free stock', () => {
    const crop: Crop = { phase: 'harvesting', plantedDay: '2026-01-10', ratioSum: 0, days: 0, yieldUnits: 1000, harvested: 0 };
    assert.deepEqual(planHarvest(crop, 5000, 300), { units: 250, done: false });
    assert.deepEqual(planHarvest(crop, 5000, 10), { units: 10, done: false });
    assert.deepEqual(planHarvest({ ...crop, harvested: 990 }, 99999, 300), { units: 10, done: true });
    assert.deepEqual(planHarvest(crop, 100, 300), { units: 5, done: false });
  });
});

describe('warehouse logistics', () => {
  const link = (buildingId: string, type: 'farm_rice' | 'shop_rice', stock: number) => ({
    buildingId,
    type,
    stock,
  });

  it('charges 100 Work Points per m³ and 0.125 per kg', () => {
    // arroz: 0,01 m³ e 8 kg => 1 + 1 = 2 por unidade
    assert.equal(getTransportDemand('rice', 10), 20);
    assert.equal(canLinkToWarehouse('farm_rice'), true);
    assert.equal(canLinkToWarehouse('warehouse'), false);
    assert.equal(canLinkToWarehouse('house_poor1'), false);
    assert.deepEqual(parseWarehouseLink({ warehouseId: null }), { warehouseId: null });
    assert.equal(parseWarehouseLink({}), null);
    assert.equal(
      isWithinLinkRadius(
        { type: 'farm_rice', x: 0, y: 0 },
        { type: 'warehouse', x: 50, y: 0 },
      ),
      true,
    );
    assert.equal(
      isWithinLinkRadius(
        { type: 'farm_rice', x: 0, y: 0 },
        { type: 'warehouse', x: 70, y: 0 },
      ),
      false,
    );
  });

  it('sends production up to the desired stock and supplies shops, limited by Work Points', () => {
    const transfers = planTransfers(
      { stock: new Map(), desired: new Map([['rice', 100]]), capacityM3: 50, workPoints: 1000 },
      [link('farm', 'farm_rice', 300), link('shop', 'shop_rice', 5)],
    );
    // A fazenda envia 100 (desejável) = 200 pontos; a loja recebe 15 (20 - 5) = 30 pontos.
    assert.deepEqual(transfers, [
      { buildingId: 'farm', productId: 'rice', quantity: 100, direction: 'out' },
      { buildingId: 'shop', productId: 'rice', quantity: 15, direction: 'in' },
    ]);

    const limited = planTransfers(
      { stock: new Map(), desired: new Map([['rice', 100]]), capacityM3: 50, workPoints: 50 },
      [link('farm', 'farm_rice', 300), link('shop', 'shop_rice', 0)],
    );
    // 50 pontos => 25 unidades; a produção tem prioridade e a loja fica sem nada.
    assert.deepEqual(limited, [
      { buildingId: 'farm', productId: 'rice', quantity: 25, direction: 'out' },
    ]);

    const none = planTransfers(
      { stock: new Map(), desired: new Map(), capacityM3: 50, workPoints: 1000 },
      [link('farm', 'farm_rice', 300)],
    );
    assert.deepEqual(none, []);
  });

  it('respects warehouse space and the shop maximum', () => {
    const full = planTransfers(
      { stock: new Map([['rice', 4990]]), desired: new Map([['rice', 9999]]), capacityM3: 50, workPoints: 1e6 },
      [link('farm', 'farm_rice', 300)],
    );
    // 50 m³ / 0,01 = 5000 unidades; só cabem mais 10.
    assert.equal(full[0].quantity, 10);
    const supply = planTransfers(
      { stock: new Map([['rice', 8]]), desired: new Map(), capacityM3: 50, workPoints: 1e6 },
      [link('shop', 'shop_rice', 0)],
    );
    assert.equal(supply[0].quantity, 8);
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
        warehouseId: null,
        toolStock: 0,
        woodStock: 0,
        ironStock: 0,
        averageIncome: 0,
        efficiencyPenalty: 0,
        crop: null,
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
        warehouseId: null,
        toolStock: 0,
        woodStock: 0,
        ironStock: 0,
        averageIncome: 0,
        efficiencyPenalty: 0,
        crop: null,
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

describe('fishery', () => {
  const city = {
    id: 'c',
    name: 'c',
    centerX: 100,
    centerY: 100,
    population: 0,
    wellbeing: 0,
    economy: 0,
    zones: [{ id: 'u', cityId: 'c', type: 'urban' as const, minX: 0, minY: 0, maxX: 300, maxY: 300 }],
  };
  const map = { width: 4000, height: 4000 };
  const road = [{ x: 19, y: 20 }];

  it('requires at least one water tile, urban zone and a road', () => {
    const waterAt = (x: number, y: number) => !(x === 20 && y === 20);
    assert.equal(getResidencePlacementError('fishery', { x: 20, y: 20 }, [city], [], road, waterAt, map), null);
    assert.equal(
      getResidencePlacementError('fishery', { x: 20, y: 20 }, [city], [], road, () => true, map),
      'not_on_water',
    );
    assert.equal(
      getResidencePlacementError('fishery', { x: 20, y: 20 }, [city], [], [], waterAt, map),
      'not_adjacent_to_road',
    );
    assert.equal(
      getResidencePlacementError('shop_fish', { x: 20, y: 20 }, [city], [], road, waterAt, map),
      'water',
    );
  });

  it('rolls tool demand as a probability below one', () => {
    assert.equal(rollToolDemand(10, () => 0.4), 1);
    assert.equal(rollToolDemand(10, () => 0.6), 0);
    assert.equal(rollToolDemand(40, () => 0.99), 2);
    assert.equal(rollToolDemand(0, () => 0), 0);
  });

  it('raises the penalty from 30% by 10 points up to 90% and recovers 10 per day', () => {
    let penalty = 0;
    const steps = [];
    for (let day = 0; day < 8; day += 1) {
      penalty = nextEfficiencyPenalty(penalty, false);
      steps.push(penalty);
    }
    assert.deepEqual(steps, [30, 40, 50, 60, 70, 80, 90, 90]);
    assert.equal(nextEfficiencyPenalty(90, true), 80);
    assert.equal(nextEfficiencyPenalty(5, true), 0);
  });

  it('produces one fish per 100 Work Points, reduced by the penalty and limited by space', () => {
    assert.deepEqual(planFishing({ progress: 0, workPoints: 1000, penalty: 0, freeSpace: 300 }), {
      fish: 10,
      progress: 0,
    });
    assert.deepEqual(planFishing({ progress: 50, workPoints: 1000, penalty: 30, freeSpace: 300 }), {
      fish: 7,
      progress: 50,
    });
    assert.equal(planFishing({ progress: 0, workPoints: 1000, penalty: 0, freeSpace: 4 }).fish, 4);
  });

  it('supplies tools and collects fish through a linked warehouse', () => {
    const transfers = planTransfers(
      { stock: new Map([['tools', 20]]), desired: new Map([['fish', 100]]), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 'f', type: 'fishery', stock: 30, toolStock: 4 }],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'f', productId: 'fish', quantity: 30, direction: 'out' },
      { buildingId: 'f', productId: 'tools', quantity: 6, direction: 'in' },
    ]);
  });
});

describe('recursos e ferramentaria', () => {
  it('uses chance mode for quarries and caps by free space', () => {
    const rule = RESIDENCES.quarry.production!;
    assert.equal(planProduction(rule, { progress: 0, workPoints: 6000, penalty: 0, freeSpace: 10 }).units, 2);
    assert.equal(planProduction(rule, { progress: 0, workPoints: 6000, penalty: 0, freeSpace: 1 }).units, 1);
    assert.equal(planProduction(rule, { progress: 0, workPoints: 1500, penalty: 0, freeSpace: 10 }, () => 0.4).units, 1);
    assert.equal(planProduction(rule, { progress: 0, workPoints: 1500, penalty: 0, freeSpace: 10 }, () => 0.6).units, 0);
  });

  it('makes a toolmaker batch only with inputs', () => {
    const rule = RESIDENCES.toolmaker.production!;
    const base = { progress: 0, workPoints: 1000, penalty: 0, freeSpace: 100 };
    assert.equal(planProduction(rule, { ...base, wood: 5, iron: 0 }).units, 0);
    const ok = planProduction(rule, { ...base, wood: 5, iron: 1 });
    assert.deepEqual([ok.units, ok.woodUsed, ok.ironUsed], [100, 5, 1]);
  });

  it('defines the new buildings', () => {
    assert.equal(RESIDENCES.iron_mine.toolDemandPerWorker, 0.15);
    assert.equal(RESIDENCES.lumber_mill.toolDemandPerWorker, 0.05);
    assert.equal(RESIDENCES.iron_mine.width, 3);
  });

  it('supplies wood and iron to a toolmaker through a warehouse', () => {
    const transfers = planTransfers(
      { stock: new Map([['wood', 20], ['iron', 3]]), desired: new Map(), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 't', type: 'toolmaker', stock: 0, woodStock: 10, ironStock: 1 }],
    );
    assert.deepEqual(
      transfers.map((t) => [t.productId, t.quantity, t.direction]),
      [['wood', 20, 'in'], ['iron', 3, 'in']].map(([p, q, d]) => [p, Math.min(q as number, p === 'wood' ? 20 : 3), d]),
    );
  });
});

describe('renda m�dia', () => {
  it('averages wages over occupants after allocation', () => {
    const incomes = getAverageIncomes(
      [{ id: 'h', occupants: 4 }, { id: 'e', occupants: 0 }],
      new Map([['a', 100], ['b', 50]]),
      [
        { workplaceId: 'a', residenceId: 'h', count: 2 },
        { workplaceId: 'b', residenceId: 'h', count: 1 },
      ],
    );
    assert.equal(incomes.get('h'), 62.5);
    assert.equal(incomes.get('e'), 0);
  });
});
