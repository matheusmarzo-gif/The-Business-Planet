import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
  MAX_CITY_MINIMUM_WAGE,
  MIN_CITY_MINIMUM_WAGE,
  parseCityMinimumWage,
  type CityZone,
} from './city';
import { STARTING_BALANCE, formatMoney } from './wallet';
import { isCurrencyAmount, roundCurrency } from './currency';
import { nextEfficiencyPenalty, planFishing, planProduction, rollToolDemand } from './fishing';
import {
  allocateImmigrants,
  getCityPopulation,
} from './immigration';
import {
  isTileInResidenceFootprint,
  parseRent,
  getResidencePlacementError,
  getResidentialBuildingName,
  getConstructionMenuDefinitions,
  canStoreProduct,
  isStorageBuilding,
  isWithinWorkerSearchRadius,
  parseWorkSettings,
  RESIDENCES,
  SHOP_TYPES,
  parseInputProductSelection,
  type ResidentialBuilding,
  toRomanNumeral,
} from './residence';
import { getRoadPlacementError } from './road';
import {
  allocateWorkers,
  getDailyWorkPoints,
  getHoursFactor,
  getPayroll,
  getRestFactor,
  getWorkBenefit,
  getAverageIncomes,
  getEmploymentSummary,
  advanceConstruction,
  getMaxDesiredWorkers,
} from './employment';
import {
  getBasicBasketBreakdown,
  getBasicBasketCost,
  getAdvancedBasketBreakdown,
  getBasketBreakdown,
  getCityProductAveragePrices,
  getCityProductKey,
  getIntermediateBasketBreakdown,
  getIntermediateBasketCost,
  getShopDailyFinancials,
  getPurchaseBenefitCalculation,
  getShopSalesCapacity,
  isShopResidenceTransaction,
  simulateShopSales,
  parsePrice,
  planShopSales,
  planShopSalesDetailed,
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
  FARM_CROP_RULES,
  getHarvestDay,
  getPlantingFactor,
  planHarvest,
  type Crop,
} from './farming';
import { parseWarehouseSetting } from './warehouse';
import { planDailySpoilage, PRODUCTS } from './product';
import { getDairyFarmEfficiency } from './dairy';
import { GOODS_BASKET_PRODUCT_IDS, parseBasicDemandConfig } from './commerceDemand';

const city = { centerX: 1000, centerY: 1000 };

describe('city minimum wage', () => {
  it('accepts currency values from the default minimum through the maximum', () => {
    assert.equal(parseCityMinimumWage(MIN_CITY_MINIMUM_WAGE), 1);
    assert.equal(parseCityMinimumWage(12.34), 12.34);
    assert.equal(parseCityMinimumWage(MAX_CITY_MINIMUM_WAGE), 100000);
  });

  it('rejects values outside the supported currency range or precision', () => {
    for (const value of [0, -1, 100000.01, 1.001, '1']) {
      assert.equal(parseCityMinimumWage(value), null);
    }
  });
});

describe('wallet', () => {
  it('starts with C$ 25.000 and formats money in Brazilian style', () => {
    assert.equal(STARTING_BALANCE, 25000);
    assert.equal(formatMoney(STARTING_BALANCE).replace(/\u00a0/g, ' '), 'C$ 25.000');
    assert.equal(formatMoney(1.23).replace(/\u00a0/g, ' '), 'C$ 1,23');
    assert.equal(isCurrencyAmount(1.23), true);
    assert.equal(isCurrencyAmount(1.234), false);
    assert.equal(isCurrencyAmount(1.2300000000001), false);
    assert.equal(roundCurrency(1.23 * 3), 3.69);
  });

  it('applies the requested benefit multipliers by job-offer size', () => {
    const expectedMultipliers = [
      [1, 5],
      [4, 5],
      [5, 3],
      [10, 3],
      [11, 2],
      [20, 2],
      [21, 1],
      [40, 1],
      [41, 0.9],
      [100, 0.9],
      [101, 0.8],
      [300, 0.8],
      [301, 0.7],
    ] as const;
    for (const [offers, multiplier] of expectedMultipliers) {
      assert.equal(getWorkBenefit(offers, 80, 8) / (offers * 80 / 8), multiplier);
    }
  });

  it('scales chocolate production inputs and their fractional chances with Work Points', () => {
    const rule = RESIDENCES.chocolate_factory.production!;
    const input = {
      progress: 0,
      workPoints: 800,
      penalty: 0,
      freeSpace: 50,
      charcoal: 100,
      tools: 200,
      inputStocks: { cocoa: 5, sugar: 10, milk: 130 },
    };
    const result = planProduction(rule, input, () => 0.2);
    assert.equal(result.units, 2);
    assert.equal(result.charcoalUsed, 4);
    assert.equal(result.toolsUsed, 8);
    assert.deepEqual(result.inputStocksUsed, { charcoal: 4, milk: 5, tools: 8, cocoa: 0, sugar: 1 });

    const partial = planProduction(
      rule,
      { ...input, workPoints: 600 },
      () => 0.3,
    );
    assert.equal(partial.units, 2);
    assert.equal(partial.charcoalUsed, 3);
    assert.equal(partial.toolsUsed, 6);
    assert.equal(partial.inputStocksUsed.milk, 4);
    assert.equal(partial.progress, 0);

    assert.equal(
      planProduction(rule, { ...input, tools: 0 }).units,
      0,
    );
  });

  describe('nomes das construções', () => {
    it('converts sequential building numbers to Roman numerals', () => {
      assert.deepEqual([1, 2, 4, 9, 14, 40, 99, 2026].map(toRomanNumeral), [
        'I',
        'II',
        'IV',
        'IX',
        'XIV',
        'XL',
        'XCIX',
        'MMXXVI',
      ]);
      assert.equal(getResidentialBuildingName('shop_rice', 2), 'Loja de Arroz II');
      assert.throws(() => toRomanNumeral(0), RangeError);
    });
  });
});

describe('warehouse trading', () => {
  const warehouse = (
    id: string,
    ownerId: string,
    x: number,
    stock: [string, number][],
    settings: [string, number | null, number, 'sell' | 'buy'][],
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
    settings: new Map(
      settings.map(([p, target, price, mode]) => [
        p,
        {
          minimumStock: mode === 'sell' ? target ?? 0 : 0,
          maximumStock: mode === 'buy' ? target : null,
          price,
          mode,
        },
      ]),
    ),
  });

  it('buys the cheapest offers first, preserving the seller minimum and buyer maximum', () => {
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

  it('uses natural capacity as the buyer limit when maximum stock is MAX', () => {
    const trades = planWarehouseTrades([
      warehouse('buyer', 'b', 0, [['rice', 4990]], [['rice', null, 10, 'buy']]),
      warehouse('seller', 'a', 10, [['rice', 100]], [['rice', 0, 5, 'sell']]),
    ]);
    assert.equal(trades[0].quantity, 10);
  });

  it('accepts offers at the buyer price limit and accounts for stone transport weight', () => {
    const trades = planWarehouseTrades([
      warehouse('buyer', 'b', 0, [], [['stone', 10, 5, 'buy']], 80),
      warehouse('seller', 'a', 10, [['stone', 10]], [['stone', 0, 5, 'sell']]),
    ]);
    assert.deepEqual(trades, [
      { buyerId: 'buyer', sellerId: 'seller', productId: 'stone', quantity: 2, price: 5 },
    ]);
    assert.equal(getTransportDemand('wood', 1), 16.25);
    assert.equal(getTransportDemand('stone', 1), 30);
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
    assert.deepEqual(
      [1, 3, 4, 6, 7, 9, 10, 12].map((month) => getPlantingFactor(month)),
      [1, 1, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2],
    );
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

describe('other crop farms', () => {
  const grow = (plantedDay: string, farmType: keyof typeof FARM_CROP_RULES, workPoints: number) => {
    let crop: Crop = { phase: 'growing', plantedDay, ratioSum: 0, days: 0, yieldUnits: 0, harvested: 0 };
    const rule = FARM_CROP_RULES[farmType];
    for (let day = new Date(plantedDay + 'T00:00:00Z'); crop.phase === 'growing'; ) {
      day = new Date(day.getTime() + 86_400_000);
      crop = advanceGrowth(crop, day.toISOString().slice(0, 10), workPoints, rule);
    }
    return crop;
  };

  it('uses the requested seasonal planting efficiencies and crop yields', () => {
    const seasonalEfficiencies = {
      farm_potato: [0.5, 1, 0.2, 0.8],
      farm_wheat: [0.4, 0.5, 0.6, 1],
      farm_barley: [0.3, 0.7, 1, 0.6],
      farm_corn: [0.8, 1, 0.1, 0.1],
      farm_cattle: [0.4, 1, 0.8, 0.6],
      farm_cane: [0.9, 0.8, 1, 0.9],
      farm_spices: [1, 0.6, 0.6, 0.6],
      farm_vegetables: [0.2, 0.4, 1, 0.8],
      farm_sheep: [0.2, 1, 0.8, 1],
      farm_cotton: [0.4, 0.8, 1, 0.6],
    } as const;
    for (const [farmType, efficiencies] of Object.entries(seasonalEfficiencies)) {
      assert.deepEqual(
        [1, 4, 7, 10].map((month) =>
          getPlantingFactor(month, FARM_CROP_RULES[farmType as keyof typeof FARM_CROP_RULES].plantingEfficiencyByQuarter),
        ),
        efficiencies,
      );
    }
    assert.equal(grow('2026-01-10', 'farm_potato', 1000).yieldUnits, 500);
    assert.equal(grow('2026-04-10', 'farm_potato', 1000).yieldUnits, 1000);
    assert.equal(grow('2026-10-10', 'farm_wheat', 1000).yieldUnits, 1000);
    assert.equal(grow('2026-07-10', 'farm_barley', 1000).yieldUnits, 1000);
    assert.equal(grow('2026-10-10', 'farm_corn', 1000).yieldUnits, 100);
    assert.equal(grow('2026-01-10', 'farm_cane', 100).yieldUnits, 1800);
    assert.equal(grow('2026-01-10', 'farm_spices', 5000).yieldUnits, 600);
    assert.equal(grow('2026-01-10', 'farm_vegetables', 5000).yieldUnits, 200);
    assert.equal(grow('2026-07-10', 'farm_vegetables', 5000).yieldUnits, 1000);
    assert.equal(grow('2026-01-10', 'farm_vegetables', 2500).yieldUnits, 100);
    assert.equal(getHarvestDay('2026-01-31', FARM_CROP_RULES.farm_vegetables.growthMonths), '2026-03-31');
    assert.equal(getHarvestDay('2026-01-31', FARM_CROP_RULES.farm_cattle.growthMonths), '2028-01-31');
    assert.equal(grow('2026-04-10', 'farm_cattle', 500).yieldUnits, 4000);
    assert.equal(grow('2026-01-10', 'farm_sheep', 500).yieldUnits, 20);
    assert.equal(grow('2026-07-10', 'farm_cotton', 1000).yieldUnits, 300);
  });

  it('matches the rice farm construction and storage limits', () => {
    for (const farmType of [
      'farm_rice',
      'farm_potato',
      'farm_wheat',
      'farm_barley',
      'farm_corn',
    ] as const) {
      const farm = RESIDENCES[farmType];
      assert.equal(farm.width, 4);
      assert.equal(farm.height, 4);
      assert.deepEqual(farm.cost, { wood: 100, stone: 40 });
      assert.equal(farm.stockCapacity, 300);
      assert.equal(farm.maxWorkers, 30);
      assert.equal(farm.workPoints, 30000);
    }
    assert.deepEqual(RESIDENCES.farm_cattle.cost, { wood: 250, stone: 75 });
    assert.equal(RESIDENCES.farm_cattle.workPoints, 125000);
  });

  it('uses the configured daily and per-unit Work Point requirements', () => {
    assert.equal(FARM_CROP_RULES.farm_cattle.dailyWorkPoints, 500);
    const cattleCrop: Crop = {
      phase: 'harvesting',
      plantedDay: '2026-04-10',
      ratioSum: 0,
      days: 0,
      yieldUnits: 1000,
      harvested: 0,
    };
    assert.deepEqual(planHarvest(cattleCrop, 400, 100, FARM_CROP_RULES.farm_cattle), { units: 10, done: false });
    assert.equal(PRODUCTS.find((product) => product.id === 'red_meat')?.shelfLifeDays, 30);
    assert.deepEqual(
      [
        FARM_CROP_RULES.farm_cane.dailyWorkPoints,
        FARM_CROP_RULES.farm_cane.harvestWorkPointsPerUnit,
        FARM_CROP_RULES.farm_cane.baseYield,
        FARM_CROP_RULES.farm_spices.dailyWorkPoints,
        FARM_CROP_RULES.farm_spices.harvestWorkPointsPerUnit,
        FARM_CROP_RULES.farm_spices.baseYield,
        FARM_CROP_RULES.farm_vegetables.dailyWorkPoints,
        FARM_CROP_RULES.farm_vegetables.harvestWorkPointsPerUnit,
        FARM_CROP_RULES.farm_vegetables.baseYield,
        FARM_CROP_RULES.farm_sheep.dailyWorkPoints,
        FARM_CROP_RULES.farm_sheep.harvestWorkPointsPerUnit,
        FARM_CROP_RULES.farm_sheep.baseYield,
        FARM_CROP_RULES.farm_cotton.dailyWorkPoints,
        FARM_CROP_RULES.farm_cotton.harvestWorkPointsPerUnit,
        FARM_CROP_RULES.farm_cotton.baseYield,
      ],
        [100, 25, 2000, 5000, 10, 600, 5000, 10, 1000, 500, 50, 100, 1000, 100, 300],
    );
    assert.deepEqual(
      planHarvest(
        { phase: 'harvesting', plantedDay: '2026-07-10', ratioSum: 0, days: 0, yieldUnits: 100, harvested: 0 },
        80,
        100,
        FARM_CROP_RULES.farm_vegetables,
      ),
      { units: 8, done: false },
    );
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
    assert.deepEqual(parseWarehouseLink({ warehouseId: null }), { warehouseId: null, linked: false });
    assert.deepEqual(parseWarehouseLink({ warehouseId: 'silo-1' }), { warehouseId: 'silo-1', linked: true });
    assert.deepEqual(parseWarehouseLink({ warehouseId: 'silo-1', linked: false }), {
      warehouseId: 'silo-1',
      linked: false,
    });
    assert.equal(parseWarehouseLink({}), null);
    assert.equal(isStorageBuilding('warehouse'), true);
    assert.equal(isStorageBuilding('silo'), true);
    assert.equal(isStorageBuilding('farm_rice'), false);
    assert.equal(canStoreProduct('silo', 'wheat'), true);
    assert.equal(canStoreProduct('silo', 'cotton'), true);
    assert.equal(canStoreProduct('silo', 'wool'), true);
    assert.equal(canStoreProduct('silo', 'milk'), false);
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
      { stock: new Map(), minimumStock: new Map(), maximumStock: new Map([['rice', 100]]), capacityM3: 50, workPoints: 1000 },
      [link('farm', 'farm_rice', 300), link('shop', 'shop_rice', 5)],
    );
    // A fazenda envia 100; a loja já atingiu o novo limite de estoque de 5.
    assert.deepEqual(transfers, [
      { buildingId: 'farm', productId: 'rice', quantity: 100, direction: 'out' },
    ]);

    const limited = planTransfers(
      { stock: new Map(), minimumStock: new Map(), maximumStock: new Map([['rice', 100]]), capacityM3: 50, workPoints: 50 },
      [link('farm', 'farm_rice', 300), link('shop', 'shop_rice', 0)],
    );
    // 50 pontos => 25 unidades; a produção tem prioridade e a loja fica sem nada.
    assert.deepEqual(limited, [
      { buildingId: 'farm', productId: 'rice', quantity: 25, direction: 'out' },
    ]);

    const none = planTransfers(
      { stock: new Map(), minimumStock: new Map(), maximumStock: new Map([['rice', 0]]), capacityM3: 50, workPoints: 1000 },
      [link('farm', 'farm_rice', 300)],
    );
    assert.deepEqual(none, []);
  });

  it('respects warehouse space and the shop maximum', () => {
    const full = planTransfers(
      { stock: new Map([['rice', 4990]]), minimumStock: new Map(), maximumStock: new Map([['rice', 9999]]), capacityM3: 50, workPoints: 1e6 },
      [link('farm', 'farm_rice', 300)],
    );
    // 50 m³ / 0,01 = 5000 unidades; só cabem mais 10.
    assert.equal(full[0].quantity, 10);
    const supply = planTransfers(
      { stock: new Map([['rice', 8]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 1e6 },
      [link('shop', 'shop_rice', 0)],
    );
    assert.equal(supply[0].quantity, 5);
  });

  it('caps producer deliveries at the warehouse maximum and reserves its minimum for linked buildings', () => {
    const producer = planTransfers(
      {
        stock: new Map([['fish', 10]]),
        minimumStock: new Map([['fish', 20]]),
        maximumStock: new Map([['fish', 25]]),
        capacityM3: 50,
        workPoints: 10000,
      },
      [{ buildingId: 'fishery', type: 'fishery', stock: 40 }],
    );
    assert.deepEqual(producer, [{ buildingId: 'fishery', productId: 'fish', quantity: 15, direction: 'out' }]);

    const supply = planTransfers(
      {
        stock: new Map([['fish', 50]]),
        minimumStock: new Map([['fish', 20]]),
        maximumStock: new Map(),
        capacityM3: 50,
        workPoints: 10000,
      },
      [{ buildingId: 'shop', type: 'shop_fish', stock: 0 }],
    );
    assert.deepEqual(supply, [{ buildingId: 'shop', productId: 'fish', quantity: 5, direction: 'in' }]);
  });

  it('distributes scarce product stock proportionally across linked shops', () => {
    const shops = Array.from({ length: 10 }, (_, index) => ({
      buildingId: `shop-${String(index).padStart(2, '0')}`,
      type: 'shop_fish' as const,
      stock: 0,
    }));
    const transfers = planTransfers(
      { stock: new Map([['fish', 200]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 10000 },
      shops,
    );
    assert.deepEqual(transfers.map((transfer) => transfer.quantity), Array(10).fill(5));
  });

  it('scales each shop share to its remaining stock need', () => {
    const transfers = planTransfers(
      { stock: new Map([['fish', 6]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 10000 },
      [
        { buildingId: 'shop-a', type: 'shop_fish', stock: 4 },
        { buildingId: 'shop-b', type: 'shop_fish', stock: 0 },
      ],
    );
    assert.deepEqual(
      transfers.map(({ buildingId, quantity }) => [buildingId, quantity]),
      [['shop-a', 1], ['shop-b', 5]],
    );
  });

  it('logs shared stock rationing as proportional distribution', async () => {
    const { planTransfersDetailed } = await import('./logistics');
    const { attempts } = planTransfersDetailed(
      { stock: new Map([['fish', 8]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 10000 },
      [
        { buildingId: 'shop-a', type: 'shop_fish', stock: 0 },
        { buildingId: 'shop-b', type: 'shop_fish', stock: 0 },
      ],
    );
    assert.deepEqual(attempts.map(({ wanted, moved, reason }) => [wanted, moved, reason]), [
      [5, 4, 'insufficient_stock'],
      [5, 4, 'insufficient_stock'],
    ]);
  });
});

describe('shop sales', () => {
  const shop = (id: string, x: number, price: number, stock: number, capacity: number) => ({
    id,
    cityId: 'city-a',
    productId: 'rice',
    type: 'shop_rice' as const,
    x,
    y: 0,
    price,
    stock,
    capacity,
  });
  const home = (id: string, x: number, consumers: number, averageIncome: number) => ({
    id,
    cityId: 'city-a',
    type: 'house_poor1' as const,
    x,
    y: 0,
    consumers,
    averageIncome,
  });
  const demandByProduct = new Map([
    ['rice', 0.03],
    ['wheat', 0.03],
    ['barley', 0.03],
    ['corn', 0.03],
    ['potato', 0.03],
    ['fish', 0.03],
    ['red_meat', 0.03],
    ['milk', 1],
    ['sugar', 0.01],
    ['vegetables', 0.05],
    ['salt', 0.04],
    ['spices', 0.01],
    ['bread', 1],
    ['cheese', 0.1],
    ['fruit', 0.02],
    ['chocolate', 0.025],
    ['clothing', 0.01],
    ['furniture', 0.01],
    ['utilities', 0.01],
    ['glass', 0.01],
  ]);
  const cityPrices = (productId: string, price: number) =>
    new Map([[getCityProductKey('city-a', productId), price]]);

  it('uses the employed residents as the consumer population', () => {
    const plan = planShopSalesDetailed(
      [home('working-home', 0, 2, 100)],
      [shop('rice-shop', 0, 1, 100, 100)],
      demandByProduct,
      cityPrices('rice', 1),
      () => 0,
    );
    const transaction = plan.transactionsByShop.get('rice-shop')?.[0];
    assert.ok(transaction);
    assert.equal(transaction.expectedDemand, 2 * 0.03);
    assert.equal(transaction.occupants, 2);
  });

  it('calculates daily shop revenue and profit from payroll and paid product costs', () => {
    assert.deepEqual(getShopDailyFinancials(20, 3, 12, 15), {
      employeeExpense: 60,
      productExpense: 0,
      unitsSold: 12,
      salePrice: 15,
      revenue: 180,
      profitLoss: 120,
    });
    assert.deepEqual(getShopDailyFinancials(25, 2, 0, 10), {
      employeeExpense: 50,
      productExpense: 0,
      unitsSold: 0,
      salePrice: 10,
      revenue: 0,
      profitLoss: -50,
    });
    assert.deepEqual(getShopDailyFinancials(0.25, 3, 3, 1.23), {
      employeeExpense: 0.75,
      productExpense: 0,
      unitsSold: 3,
      salePrice: 1.23,
      revenue: 3.69,
      profitLoss: 2.94,
    });
  });

  it('computes store benefit with the basic-basket formula and zero guards', () => {
    assert.equal(getShopSalesCapacity('shop_rice', 24), 0);
    assert.equal(getShopSalesCapacity('shop_rice', 25), 1);
    const newShopTypes = ['shop_potato', 'shop_corn', 'shop_barley', 'shop_wheat', 'shop_butcher'] as const;
    assert.deepEqual(newShopTypes.map((type) => getShopSalesCapacity(type, 25)), [1, 1, 1, 1, 1]);
    assert.equal(getShopSalesCapacity('shop_fish', 50), 1);
    assert.equal(getShopSalesCapacity('shop_milk', 1), 1);
    assert.equal(getShopSalesCapacity('shop_milk', 0.9), 0);
    assert.equal(getShopSalesCapacity('shop_bread', 3), 1);
    assert.equal(getShopSalesCapacity('shop_cheese', 26), 1);
    assert.equal(parsePrice({ price: 0 }), null);
    assert.equal(parsePrice({ price: 12 }), 12);
    assert.equal(parsePrice({ price: 0.01 }), 0.01);
    assert.equal(parsePrice({ price: 1.23 }), 1.23);
    assert.equal(parsePrice({ price: 1.234 }), null);
    const income = 1;
    const price = 5;
    const basicNeed = 0.03;
    const rr = 0.3;
    const pf = price * basicNeed;
    const w = (1 - pf / rr) ** 4;
    const q = (0.8 ** w - 1) * income;
    const distance = 0;
    const distanceFactor = Math.sqrt(60 / (60 + distance));
    const benefitError = distanceFactor * ((income - pf - q) / rr) ** 4;
    const benefitIdeal = (income / rr - 0.125 / rr) ** 4;
    const calculation = getPurchaseBenefitCalculation(income, price, basicNeed, rr, distance);
    assert.equal(calculation.pf, pf);
    assert.equal(calculation.distanceFactor, distanceFactor);
    assert.equal(calculation.w, w);
    assert.ok(Math.abs(calculation.q - q) < 1e-12);
    assert.ok(Math.abs(calculation.errorBenefit - benefitError) < 1e-12);
    assert.equal(calculation.idealBenefit, benefitIdeal);
    const expectedAssociatedBenefit = (benefitError / benefitIdeal) ** 4;
    assert.ok(
      Math.abs(calculation.associatedBenefit - expectedAssociatedBenefit) /
        expectedAssociatedBenefit <
        1e-12,
    );
    const lowerPrice = getPurchaseBenefitCalculation(25, 10, 1, 10, 0);
    const higherPrice = getPurchaseBenefitCalculation(25, 20, 1, 10, 0);
    assert.equal(lowerPrice.valuesSaturated, false);
    assert.equal(higherPrice.valuesSaturated, false);
    assert.ok(Number.isFinite(lowerPrice.logAssociatedBenefit));
    assert.ok(Number.isFinite(higherPrice.logAssociatedBenefit));
    assert.ok(higherPrice.logAssociatedBenefit < lowerPrice.logAssociatedBenefit);
    assert.equal(getPurchaseBenefitCalculation(0.1, 10, 0.03, rr, 0).associatedBenefit, 0);
    assert.equal(getPurchaseBenefitCalculation(0.125, 1, 0, rr, 0).associatedBenefit, 0);
    const fartherStore = getPurchaseBenefitCalculation(income, price, basicNeed, rr, 40);
    assert.ok(fartherStore.errorBenefit < calculation.errorBenefit);
    assert.ok(fartherStore.associatedBenefit < calculation.associatedBenefit);
  });

  it('simulates sales from cached transactions and applies current stock, capacity, and payroll', () => {
    assert.equal(simulateShopSales([], {
      price: 3,
      stock: 5,
      dailyCapacity: 8,
      wage: 2,
      workers: 4,
    }), null);
    const result = simulateShopSales(
      [{
        residenceId: 'home',
        occupants: 100,
        averageIncome: 100,
        areaAveragePrice: 1,
        expectedDemand: 100,
        desiredQuantity: 100,
        basicNeedPerPerson: 1,
        referenceBasketCost: 10,
        candidate: {
          shopId: 'shop',
          price: 1,
          distance: 0,
          desiredQuantity: 100,
          benefit: 1,
          rank: 1,
          stockAvailable: 100,
          capacityAvailable: 100,
          available: 100,
          demandBefore: 100,
          purchased: 0,
          demandAfter: 100,
          allocatedResidents: 100,
          basicNeedPerPerson: 1,
          referenceBasketCost: 10,
          outcome: 'purchased',
        },
      }],
      { price: 3, stock: 5, dailyCapacity: 8, wage: 2, workers: 4 },
    );
    assert.deepEqual(result, {
      unitsSold: 5,
      revenue: 15,
      employeeExpense: 8,
      profitLoss: 7,
    });
  });

  it('accepts fractional shop prices in commerce diagnostics', () => {
    const transaction = {
      residenceId: 'home',
      occupants: 3,
      averageIncome: 10,
      areaAveragePrice: 1.23,
      expectedDemand: 1,
      desiredQuantity: 1,
      candidate: {
        shopId: 'shop',
        price: 1.23,
        distance: 0,
        desiredQuantity: 1,
        benefit: 1,
        rank: 1,
        stockAvailable: 1,
        capacityAvailable: 1,
        available: 1,
        demandBefore: 1,
        purchased: 1,
        demandAfter: 0,
        outcome: 'purchased' as const,
      },
    };
    assert.equal(isShopResidenceTransaction(transaction), true);
    assert.equal(
      isShopResidenceTransaction({
        ...transaction,
        candidate: { ...transaction.candidate, price: 1.234 },
      }),
      false,
    );
  });

  it('sells the new food products through the shared residence-demand planner', () => {
    const newShops = [
      { ...shop('potato', 0, 1, 20, 20), productId: 'potato', type: 'shop_potato' as const },
      { ...shop('corn', 0, 1, 20, 20), productId: 'corn', type: 'shop_corn' as const },
      { ...shop('barley', 0, 1, 20, 20), productId: 'barley', type: 'shop_barley' as const },
      { ...shop('wheat', 0, 1, 20, 20), productId: 'wheat', type: 'shop_wheat' as const },
      { ...shop('red-meat', 0, 1, 20, 20), productId: 'red_meat', type: 'shop_butcher' as const },
    ];
    const averagePrices = new Map(
      [...demandByProduct.keys()].map((productId) => [getCityProductKey('city-a', productId), 1]),
    );
    const plan = planShopSalesDetailed(
      [home('new-food-home', 0, 32, 10)],
      newShops,
      demandByProduct,
      averagePrices,
      () => 0,
    );
    assert.deepEqual(
      plan.purchases.map((purchase) => purchase.productId).sort(),
      ['barley', 'corn', 'potato', 'red_meat', 'wheat'],
    );
  });

  it('uses city-wide 30-day weighted prices and current prices only when no sales exist', () => {
    const shops = [
      shop('rice-a', 0, 5, 10, 10),
      shop('rice-b', 4, 15, 10, 10),
      { ...shop('wheat', 8, 8, 10, 10), cityId: 'city-b', productId: 'wheat' },
    ];
    const prices = getCityProductAveragePrices(shops, [
      { cityId: 'city-a', productId: 'rice', unitsSold: 2, price: 5 },
      { cityId: 'city-a', productId: 'rice', unitsSold: 6, price: 15 },
    ]);
    assert.equal(prices.get(getCityProductKey('city-a', 'rice')), 12.5);
    assert.equal(prices.get(getCityProductKey('city-b', 'wheat')), 8);
    assert.equal(getBasicBasketCost('city-a', demandByProduct, prices), 0.375);
  });

  it('records every basket item, price source, and precise contribution to RR', () => {
    const basketShops = [
      { ...shop('rice', 0, 8.36, 10, 10), productId: 'rice' },
      { ...shop('fish', 0, 8.45, 10, 10), productId: 'fish' },
      { ...shop('milk', 0, 1.41, 10, 10), productId: 'milk' },
    ];
    const history = basketShops.map((store) => ({
      cityId: 'city-a',
      productId: store.productId,
      unitsSold: 1,
      price: store.price,
    }));
    const prices = getCityProductAveragePrices(basketShops, history);
    const breakdown = getBasicBasketBreakdown(
      'city-a',
      demandByProduct,
      prices,
      basketShops,
      history,
    );

    assert.equal(breakdown.length, 8);
    assert.deepEqual(
      breakdown
        .filter((item) => item.averagePrice !== null)
        .map(({ productId, priceSource, basketContribution }) => ({
          productId,
          priceSource,
          basketContribution,
        })),
      [
        { productId: 'rice', priceSource: 'weighted_sales', basketContribution: 8.36 * 0.03 },
        { productId: 'fish', priceSource: 'weighted_sales', basketContribution: 8.45 * 0.03 },
        { productId: 'milk', priceSource: 'weighted_sales', basketContribution: 1.41 },
      ],
    );
    assert.equal(getBasicBasketCost('city-a', demandByProduct, prices), 1.9143);
    assert.equal(getIntermediateBasketCost('city-a', demandByProduct, prices), 0);
    const allBasketItems = getBasketBreakdown(
      'city-a',
      demandByProduct,
      prices,
      basketShops,
      history,
    );
    assert.equal(allBasketItems.length, 20);
    assert.equal(
      getAdvancedBasketBreakdown('city-a', demandByProduct, prices, basketShops, history).length,
      4,
    );
    assert.equal(
      allBasketItems.filter((item) => item.basketType === 'goods').length,
      4,
    );
    assert.deepEqual(
      getIntermediateBasketBreakdown('city-a', demandByProduct, prices, basketShops, history)
        .map(({ productId, basketContribution }) => [productId, basketContribution]),
      [
        ['sugar', null],
        ['vegetables', null],
        ['salt', null],
        ['spices', null],
      ],
    );
    assert.equal(
      allBasketItems.filter((item) => item.basketType === 'intermediate').length,
      4,
    );
    assert.ok(
      breakdown
        .filter((item) => item.basketContribution !== null)
        .reduce((total, item) => total + (item.basketContribution ?? 0), 0) === 1.9143,
    );
    const plan = planShopSalesDetailed(
      [home('basket-home', 0, 32, 10)],
      basketShops,
      demandByProduct,
      prices,
      () => 0,
      history,
    );
    const diagnostic = plan.transactionsByShop.get('rice')?.[0];
    assert.ok(diagnostic);
    assert.equal(isShopResidenceTransaction(diagnostic), true);
    assert.deepEqual(diagnostic.basketBreakdown, allBasketItems);
    assert.equal(diagnostic.referenceBasketCost, 1.9143);
    assert.equal(diagnostic.intermediateBasketCost, 0);
  });

  it('uses the intermediate-basket formula, RR2, and both income thresholds', () => {
    const income = 5;
    const price = 10;
    const need = 0.01;
    const rr = 2;
    const rr2 = 1;
    const distance = 15;
    const pf = price * need;
    const total = rr + rr2;
    const w = (1 - pf / total) ** 3;
    const q = (0.8 ** w - 1) * income;
    const distanceFactor = Math.sqrt(60 / (60 + distance));
    const error = distanceFactor * ((income - pf - q) / total) ** 3;
    const ideal = ((income - 1 / 6) / total - 1 / 110) ** 3;
    const calculation = getPurchaseBenefitCalculation(
      income,
      price,
      need,
      rr,
      distance,
      { basketType: 'intermediate', intermediateBasketCost: rr2 },
    );
    assert.equal(calculation.pf, pf);
    assert.equal(calculation.w, w);
    assert.ok(Math.abs(calculation.q - q) < 1e-12);
    assert.ok(Math.abs(calculation.errorBenefit - error) < 1e-12);
    assert.ok(Math.abs(calculation.idealBenefit - ideal) < 1e-12);
    assert.ok(
      Math.abs(calculation.associatedBenefit - (error / ideal) ** 4) < 1e-10,
    );
    assert.equal(
      getPurchaseBenefitCalculation(1, price, need, rr, 0, {
        basketType: 'intermediate',
        intermediateBasketCost: rr2,
      }).errorBenefit,
      0,
    );
    assert.equal(
      getPurchaseBenefitCalculation(2, price, need, 12, 0, {
        basketType: 'intermediate',
        intermediateBasketCost: 6,
      }).errorBenefit,
      0,
    );
  });

  it('sells intermediate products using RR plus RR2', () => {
    const sugarShop = {
      ...shop('sugar-intermediate', 0, 10, 100, 100),
      productId: 'sugar',
      type: 'shop_sugar' as const,
    };
    const shops = [sugarShop];
    const prices = new Map(
      [...demandByProduct.keys()].map((productId) => [
        getCityProductKey('city-a', productId),
        1,
      ]),
    );
    const plan = planShopSalesDetailed(
      [home('intermediate-home', 0, 32, 10)],
      shops,
      demandByProduct,
      prices,
      () => 0,
    );
    const transaction = plan.transactionsByShop.get(sugarShop.id)?.[0];
    assert.ok(transaction);
    assert.equal(transaction.basketType, 'intermediate');
    assert.equal(transaction.expectedDemand, 32 * 0.01);
    assert.equal(transaction.intermediateBasketCost, 0.11);
    assert.equal(transaction.referenceBasketCost, 1.21);
    assert.equal(transaction.calculationBasketCost, 1.32);
    assert.equal(transaction.candidate.calculationBasketCost, 1.32);
  });

  it('uses the goods-basket formula with RR plus RR2 plus RR3', () => {
    const income = 6;
    const price = 60;
    const need = 0.01;
    const rr = 2;
    const rr2 = 1;
    const rr3 = 0.5;
    const distance = 15;
    const total = rr + rr2 + rr3;
    const pf = price * need;
    const w = (1 - pf / total) ** 3;
    const q = (0.8 ** w - 1) * income;
    const distanceFactor = Math.sqrt(60 / (60 + distance));
    const error = distanceFactor * ((income - pf - q) / total) ** 3;
    const ideal = (income / total - 1 / (6 * total) + 1 / 16) ** 3;
    const calculation = getPurchaseBenefitCalculation(
      income,
      price,
      need,
      rr,
      distance,
      {
        basketType: 'goods',
        intermediateBasketCost: rr2,
        advancedBasketCost: rr3,
      },
    );
    assert.equal(calculation.pf, pf);
    assert.equal(calculation.w, w);
    assert.ok(Math.abs(calculation.q - q) < 1e-12);
    assert.ok(Math.abs(calculation.errorBenefit - error) < 1e-12);
    assert.ok(Math.abs(calculation.idealBenefit - ideal) < 1e-12);
    assert.ok(
      Math.abs(calculation.associatedBenefit - (error / ideal) ** 6) < 1e-10,
    );
    assert.equal(
      getPurchaseBenefitCalculation(total / 2, price, need, rr, 0, {
        basketType: 'goods',
        intermediateBasketCost: rr2,
        advancedBasketCost: rr3,
      }).errorBenefit,
      0,
    );
  });

  it('uses the advanced-basket formula, RR3, and its three income thresholds', () => {
    const income = 6;
    const price = 20;
    const need = 0.025;
    const rr = 2;
    const rr2 = 1;
    const rr3 = 0.5;
    const distance = 15;
    const pf = price * need;
    const total = rr + rr2 + rr3;
    const w = (1 - pf / total) ** 2;
    const q = (0.8 ** w - 1) * income;
    const distanceFactor = Math.sqrt(60 / (60 + distance));
    const error = distanceFactor * ((income - pf - q) / total) ** 2;
    const ideal = ((income - 1 / 6) / total - 1 / 180) ** 2;
    const calculation = getPurchaseBenefitCalculation(
      income,
      price,
      need,
      rr,
      distance,
      {
        basketType: 'advanced',
        intermediateBasketCost: rr2,
        advancedBasketCost: rr3,
      },
    );
    assert.equal(calculation.pf, pf);
    assert.equal(calculation.w, w);
    assert.ok(Math.abs(calculation.q - q) < 1e-12);
    assert.ok(Math.abs(calculation.errorBenefit - error) < 1e-12);
    assert.ok(Math.abs(calculation.idealBenefit - ideal) < 1e-12);
    assert.ok(
      Math.abs(calculation.associatedBenefit - (error / ideal) ** 4) < 1e-10,
    );
    assert.equal(
      getPurchaseBenefitCalculation(1, price, need, rr, 0, {
        basketType: 'advanced',
        intermediateBasketCost: rr2,
        advancedBasketCost: rr3,
      }).errorBenefit,
      0,
    );
  });

  it('sells new goods through the shared residence-demand planner', () => {
    const goodsShops = [
      { ...shop('clothing', 0, 10, 10, 10), productId: 'clothing', type: 'shop_clothing' as const },
      { ...shop('furniture', 0, 10, 10, 10), productId: 'furniture', type: 'shop_furniture' as const },
      { ...shop('utilities', 0, 10, 10, 10), productId: 'utilities', type: 'shop_utilities' as const },
      { ...shop('glass', 0, 10, 10, 10), productId: 'glass', type: 'shop_glass' as const },
    ];
    const prices = new Map(
      [...demandByProduct.keys()].map((productId) => [
        getCityProductKey('city-a', productId),
        1,
      ]),
    );
    const plan = planShopSalesDetailed(
      [home('goods-home', 0, 32, 10)],
      goodsShops,
      demandByProduct,
      prices,
      () => 0,
    );
    assert.deepEqual(
      plan.purchases.map((purchase) => purchase.productId).sort(),
      [...GOODS_BASKET_PRODUCT_IDS].sort(),
    );
    assert.ok(
      [...plan.transactionsByShop.values()]
        .flat()
        .every((transaction) => transaction.basketType === 'goods'),
    );
  });

  it('sells advanced products using RR plus RR2 plus RR3', () => {
    const chocolateShop = {
      ...shop('chocolate-advanced', 0, 10, 100, 100),
      productId: 'chocolate',
      type: 'shop_chocolate' as const,
    };
    const prices = new Map(
      [...demandByProduct.keys()].map((productId) => [
        getCityProductKey('city-a', productId),
        1,
      ]),
    );
    const plan = planShopSalesDetailed(
      [home('advanced-home', 0, 32, 10)],
      [chocolateShop],
      demandByProduct,
      prices,
      () => 0,
    );
    const transaction = plan.transactionsByShop.get(chocolateShop.id)?.[0];
    assert.ok(transaction);
    assert.equal(transaction.basketType, 'advanced');
    assert.equal(transaction.expectedDemand, 32 * 0.025);
    assert.equal(transaction.advancedBasketCost, 1.145);
    assert.equal(transaction.referenceBasketCost, 1.21);
    assert.equal(transaction.intermediateBasketCost, 0.11);
    assert.equal(transaction.calculationBasketCost, 2.465);
    assert.equal(transaction.candidate.calculationBasketCost, 2.465);
  });

  it('allocates integer residents by associated benefit and keeps their total exact', () => {
    const shops = [
      { ...shop('shop-5', 0, 5, 100, 100), productId: 'rice' },
      { ...shop('shop-10', 8, 10, 100, 100), productId: 'rice' },
      { ...shop('shop-20', 16, 20, 100, 100), productId: 'rice' },
    ];
    const home32 = { ...home('home-32', 4, 32, 0.3) };
    const plan = planShopSalesDetailed(
      [home32],
      shops,
      demandByProduct,
      cityPrices('rice', 10),
      () => 0.99,
    );
    const assigned = shops.map((store) => {
      const transaction = plan.transactionsByShop.get(store.id)?.[0];
      assert.ok(transaction);
      return transaction.candidate.allocatedResidents ?? 0;
    });
    assert.equal(assigned.reduce((sum, count) => sum + count, 0), 32);
    assert.equal(assigned[2], 0);
    assert.ok(Math.abs((assigned[0] ?? 0) - 32 * (
      getPurchaseBenefitCalculation(0.3, 5, 0.03, 0.3, 4).associatedBenefit /
      (getPurchaseBenefitCalculation(0.3, 5, 0.03, 0.3, 4).associatedBenefit +
        getPurchaseBenefitCalculation(0.3, 10, 0.03, 0.3, 4).associatedBenefit)
    )) <= 1);
    assert.ok(plan.purchases.every((purchase) => Number.isInteger(purchase.quantity)));
    assert.ok(
      plan.purchases.every((purchase) => {
        const store = shops.find((candidate) => candidate.id === purchase.shopId);
        return (
          store !== undefined &&
          purchase.quantity <= store.stock &&
          purchase.quantity <= store.capacity
        );
      }),
    );
  });

  it('distributes 32 residents across 9/10/20 fish shops before stock and capacity limits', () => {
    const fishShops = [
      { ...shop('fish-9', 0, 9, 7, 100), productId: 'fish', type: 'shop_fish' as const },
      { ...shop('fish-10', 8, 10, 100, 0), productId: 'fish', type: 'shop_fish' as const },
      { ...shop('fish-20', 16, 20, 100, 2), productId: 'fish', type: 'shop_fish' as const },
    ];
    const averagePrices = new Map([
      [getCityProductKey('city-a', 'rice'), 10],
      [getCityProductKey('city-a', 'fish'), 10],
      [getCityProductKey('city-a', 'milk'), 10],
    ]);
    const plan = planShopSalesDetailed(
      [home('home-32', 4, 32, 10)],
      fishShops,
      demandByProduct,
      averagePrices,
      () => 0,
    );
    assert.deepEqual(
      fishShops.map((store) =>
        plan.transactionsByShop.get(store.id)?.[0].candidate.allocatedResidents,
      ),
      [14, 13, 5],
    );
    assert.deepEqual(plan.purchases, [
      { shopId: 'fish-9', residenceId: 'home-32', productId: 'fish', quantity: 5 },
      { shopId: 'fish-20', residenceId: 'home-32', productId: 'fish', quantity: 1 },
    ]);
  });

  it('allows consumption above basic need but enforces each store stock and capacity', () => {
    const milkShops = [
      {
        ...shop('milk-a', 0, 10, 2, 3),
        type: 'shop_milk' as const,
        productId: 'milk',
      },
      {
        ...shop('milk-b', 4, 10, 2, 3),
        type: 'shop_milk' as const,
        productId: 'milk',
      },
    ];
    const plan = planShopSales(
      [home('milk-home', 0, 32, 10)],
      milkShops,
      demandByProduct,
      cityPrices('milk', 1),
      () => 0,
    );
    assert.deepEqual(plan, [
      { shopId: 'milk-a', residenceId: 'milk-home', productId: 'milk', quantity: 2 },
      { shopId: 'milk-b', residenceId: 'milk-home', productId: 'milk', quantity: 2 },
    ]);
  });

  it('allows nearby stores across city borders but respects the 60-tile range', () => {
    const shops = [
      { ...shop('near', 0, 10, 100, 100), productId: 'milk', type: 'shop_milk' as const },
      { ...shop('distant', 1000, 10, 100, 100), productId: 'milk', type: 'shop_milk' as const },
      { ...shop('other-city', 4, 10, 100, 100), cityId: 'city-b', productId: 'milk', type: 'shop_milk' as const },
    ];
    const plan = planShopSalesDetailed(
      [home('home', 0, 2, 100)],
      shops,
      demandByProduct,
      cityPrices('milk', 10),
      () => 0,
    );
    assert.equal(plan.transactionsByShop.get('near')?.length, 1);
    assert.equal(plan.transactionsByShop.get('distant')?.length, 0);
    assert.equal(plan.transactionsByShop.get('other-city')?.length, 1);
  });
});

describe('fazenda leiteira e demanda configurável', () => {
  it('applies the requested monthly production efficiencies', () => {
    assert.deepEqual(
      [1, 3, 4, 6, 7, 9, 10, 12].map(getDairyFarmEfficiency),
      [0.4, 0.4, 1, 1, 0.8, 0.8, 0.6, 0.6],
    );
    assert.throws(() => getDairyFarmEfficiency(0), RangeError);
  });

  it('accumulates dairy Work Points at five per liter and caps production by stock space', () => {
    const dairy = RESIDENCES.farm_dairy;
    assert.deepEqual(
      [dairy.width, dairy.height, dairy.maxWorkers, dairy.stockCapacity, dairy.workPoints],
      [3, 3, 10, 400, 25000],
    );
    assert.deepEqual(dairy.cost, { wood: 50, stone: 15 });
    assert.equal(dairy.workPoints, 25000);
    assert.equal(dairy.asset, '/buildings/farms/fazenda_leiteira.png');
    assert.deepEqual(
      planProduction(
        dairy.production!,
        { progress: 2, workPoints: 11, penalty: 0, freeSpace: 4 },
      ),
      {
        units: 2,
        progress: 3,
        woodUsed: 0,
        ironUsed: 0,
        charcoalUsed: 0,
        toolsUsed: 0,
        batchStockUsed: 0,
        inputStocksUsed: {},
      },
    );
    assert.equal(
      planProduction(
        dairy.production!,
        { progress: 0, workPoints: 50, penalty: 0, freeSpace: 4 },
      ).progress,
      0,
    );
  });

  it('uses the configured multiplier in household demand and validates the text file format', () => {
    const multipliers = parseBasicDemandConfig([
      'demanda_basica.rice=0.03',
      'demanda_basica.wheat=0.03',
      'demanda_basica.barley=0.03',
      'demanda_basica.corn=0.03',
      'demanda_basica.potato=0.03',
      'demanda_basica.fish=0.03',
      'demanda_basica.red_meat=0.03',
      'demanda_basica.milk=1',
      'demanda_intermediaria.sugar=0.01',
      'demanda_intermediaria.vegetables=0.05',
      'demanda_intermediaria.salt=0.04',
      'demanda_intermediaria.spices=0.01',
      'demanda_avancada.bread=1',
      'demanda_avancada.cheese=0.1',
      'demanda_avancada.fruit=0.02',
      'demanda_avancada.chocolate=0.025',
      'demanda_bens.clothing=0.01',
      'demanda_bens.furniture=0.01',
      'demanda_bens.utilities=0.01',
      'demanda_bens.glass=0.01',
    ].join('\n'));
    assert.equal(multipliers.get('rice'), 0.03);
    assert.equal(multipliers.get('wheat'), 0.03);
    assert.equal(multipliers.get('barley'), 0.03);
    assert.equal(multipliers.get('corn'), 0.03);
    assert.equal(multipliers.get('potato'), 0.03);
    assert.equal(multipliers.get('fish'), 0.03);
    assert.equal(multipliers.get('sugar'), 0.01);
    assert.equal(multipliers.get('vegetables'), 0.05);
    assert.equal(multipliers.get('salt'), 0.04);
    assert.equal(multipliers.get('spices'), 0.01);
    assert.equal(multipliers.get('bread'), 1);
    assert.equal(multipliers.get('cheese'), 0.1);
    assert.equal(multipliers.get('fruit'), 0.02);
    assert.equal(multipliers.get('chocolate'), 0.025);
    assert.equal(multipliers.get('clothing'), 0.01);
    assert.equal(multipliers.get('furniture'), 0.01);
    assert.equal(multipliers.get('utilities'), 0.01);
    assert.equal(multipliers.get('glass'), 0.01);
    assert.equal(multipliers.get('red_meat'), 0.03);
    assert.equal(multipliers.get('milk'), 1);
    assert.throws(() => parseBasicDemandConfig('demanda_basica.milk=-1'), /linha 1/);
    assert.throws(
      () => parseBasicDemandConfig('demanda_basica.rice=0.03'),
      /não define o produto wheat/,
    );
    assert.throws(
      () => parseBasicDemandConfig(
        [
          'demanda_basica.rice=0.03',
          'demanda_basica.wheat=0.03',
          'demanda_basica.barley=0.03',
          'demanda_basica.corn=0.03',
          'demanda_basica.potato=0.03',
          'demanda_basica.fish=0.03',
          'demanda_basica.red_meat=0.03',
          'demanda_basica.milk=1',
          'demanda_basica.sugar=0.01',
          'demanda_intermediaria.vegetables=0.05',
          'demanda_intermediaria.salt=0.04',
          'demanda_intermediaria.spices=0.01',
          'demanda_avancada.bread=1',
          'demanda_avancada.cheese=0.1',
          'demanda_avancada.fruit=0.02',
          'demanda_avancada.chocolate=0.025',
          'demanda_bens.clothing=0.01',
          'demanda_bens.furniture=0.01',
          'demanda_bens.utilities=0.01',
          'demanda_bens.glass=0.01',
        ].join('\n'),
      ),
      /categoria de demanda incorreta/,
    );
    assert.throws(
      () => parseBasicDemandConfig([
        'demanda_basica.rice=0.03',
        'demanda_basica.rice=0.03',
      ].join('\n')),
      /linha 2/,
    );
    const configFile = readFileSync(
      fileURLToPath(new URL('../../config/demanda_basica.txt', import.meta.url)),
      'utf8',
    );
    assert.deepEqual(
      [...parseBasicDemandConfig(configFile)],
      [
        ['rice', 0.03],
        ['wheat', 0.03],
        ['barley', 0.03],
        ['corn', 0.03],
        ['potato', 0.03],
        ['fish', 0.03],
        ['red_meat', 0.03],
        ['milk', 1],
        ['sugar', 0.01],
        ['vegetables', 0.05],
        ['salt', 0.04],
        ['spices', 0.01],
        ['bread', 1],
        ['cheese', 0.1],
        ['fruit', 0.02],
        ['chocolate', 0.025],
        ['clothing', 0.01],
        ['furniture', 0.01],
        ['utilities', 0.01],
        ['glass', 0.01],
      ],
    );
    assert.equal(
      getBasicBasketCost(
        'city-a',
        multipliers,
        new Map([[getCityProductKey('city-a', 'milk'), 10]]),
      ),
      10,
    );
  });

  it('defines a dairy shop with shared building costs and increased stock capacity', () => {
    const dairyShop = RESIDENCES.shop_milk;
    const fishShop = RESIDENCES.shop_fish;
    assert.deepEqual(
      [dairyShop.width, dairyShop.height, dairyShop.maxWorkers, dairyShop.workPoints],
      [fishShop.width, fishShop.height, 1, fishShop.workPoints],
    );
    assert.equal(dairyShop.stockCapacity, 120);
    assert.deepEqual(dairyShop.cost, { wood: 10, stone: 5 });
    assert.equal(dairyShop.stockProductId, 'milk');
    assert.equal(dairyShop.asset, '/buildings/commerce/loja_leite.png');
    assert.equal(canLinkToWarehouse('farm_dairy'), true);
    assert.equal(canLinkToWarehouse('shop_milk'), true);
    assert.deepEqual(
      planTransfers(
        {
          stock: new Map(),
          minimumStock: new Map(),
          maximumStock: new Map([['milk', 120]]),
          capacityM3: 50,
          workPoints: 100000,
        },
        [{ buildingId: 'dairy-farm', type: 'farm_dairy', stock: 10 }],
      ),
      [{ buildingId: 'dairy-farm', productId: 'milk', quantity: 10, direction: 'out' }],
    );
    assert.deepEqual(
      planTransfers(
        {
          stock: new Map([['milk', 20]]),
          minimumStock: new Map(),
          maximumStock: new Map(),
          capacityM3: 50,
          workPoints: 100000,
        },
        [{ buildingId: 'milk-store', type: 'shop_milk', stock: 0 }],
      ),
      [{ buildingId: 'milk-store', productId: 'milk', quantity: 20, direction: 'in' }],
    );
  });

  it('defines the new food shops with rice-shop construction and stock capacity', () => {
    const riceShop = RESIDENCES.shop_rice;
    const expectedShops = [
      ['shop_potato', 'potato', 'Loja de Batata', '/buildings/commerce/loja_batata.png'],
      ['shop_corn', 'corn', 'Loja de Milho', '/buildings/commerce/loja_milho.png'],
      ['shop_barley', 'barley', 'Loja de Cevada', '/buildings/commerce/loja_cevada.png'],
      ['shop_wheat', 'wheat', 'Loja de Trigo', '/buildings/commerce/loja_trigo.png'],
    ] as const;
    for (const [type, productId, name, asset] of expectedShops) {
      const shop = RESIDENCES[type];
      assert.equal(shop.kind, 'shop');
      assert.deepEqual(
        [shop.width, shop.height, shop.maxWorkers, shop.stockCapacity, shop.workPoints],
        [riceShop.width, riceShop.height, riceShop.maxWorkers, riceShop.stockCapacity, riceShop.workPoints],
      );
      assert.deepEqual(shop.cost, riceShop.cost);
      assert.equal(shop.stockProductId, productId);
      assert.equal(shop.name, name);
      assert.equal(shop.asset, asset);
      assert.equal(canLinkToWarehouse(type), true);
    }
    const butcher = RESIDENCES.shop_butcher;
    assert.deepEqual(
      [butcher.maxWorkers, butcher.stockCapacity, butcher.workPoints, butcher.cost],
      [1, 5, 5000, { wood: 15, stone: 10 }],
    );
    assert.equal(butcher.stockProductId, 'red_meat');
  });

  it('defines sugar, vegetable, salt, and spice shops with their own capacities and work rates', () => {
    const expectedShops = [
      ['shop_sugar', 'sugar', 'Loja de Açúcar', '/buildings/commerce/loja_acucar.png', 5, 125],
      ['shop_vegetables', 'vegetables', 'Loja de Vegetais', '/buildings/commerce/loja_vegetais.png', 25, 20],
      ['shop_salt', 'salt', 'Loja de Sal', '/buildings/commerce/loja_sal.png', 25, 20],
      ['shop_spices', 'spices', 'Loja de Especiarias', '/buildings/commerce/loja_especiarias.png', 5, 125],
    ] as const;
    for (const [type, productId, name, asset, stockCapacity, workPointsPerUnit] of expectedShops) {
      const shop = RESIDENCES[type];
      assert.equal(shop.kind, 'shop');
      assert.deepEqual(
        [shop.width, shop.height, shop.maxWorkers, shop.stockCapacity, shop.workPoints],
        [2, 2, 4, stockCapacity, 70000],
      );
      assert.deepEqual(shop.cost, { wood: 60, stone: 40 });
      assert.equal(shop.stockProductId, productId);
      assert.equal(shop.name, name);
      assert.equal(shop.asset, asset);
      assert.equal(shop.salesWorkPointsPerUnit, workPointsPerUnit);
      assert.equal(getShopSalesCapacity(type, workPointsPerUnit), 1);
      assert.equal(SHOP_TYPES.includes(type), true);
      assert.equal(canLinkToWarehouse(type), true);
      assert.deepEqual(
        planTransfers(
          {
            stock: new Map([[productId, stockCapacity]]),
            minimumStock: new Map(),
            maximumStock: new Map(),
            capacityM3: 50,
            workPoints: 100000,
          },
          [{ buildingId: 'warehouse-shop', type, stock: 0 }],
        ),
        [{ buildingId: 'warehouse-shop', productId, quantity: stockCapacity, direction: 'in' }],
      );
    }
  });

  it('defines and connects the new goods shops', () => {
    const expectedShops = [
      ['shop_clothing', 'clothing', 'Loja de Roupas', '/buildings/commerce/loja_roupas.png'],
      ['shop_furniture', 'furniture', 'Loja de Móveis', '/buildings/commerce/loja_moveis.png'],
      ['shop_utilities', 'utilities', 'Loja de Utilitários', '/buildings/commerce/loja_utilitarios.png'],
      ['shop_glass', 'glass', 'Vidraçaria', '/buildings/commerce/loja_vidros.png'],
    ] as const;
    for (const [type, productId, name, asset] of expectedShops) {
      const shop = RESIDENCES[type];
      assert.equal(shop.kind, 'shop');
      assert.deepEqual(
        [shop.width, shop.height, shop.maxWorkers, shop.stockCapacity, shop.workPoints],
        [2, 2, 12, 5, 15000],
      );
      assert.deepEqual(shop.cost, { wood: 40, stone: 20 });
      assert.equal(shop.stockProductId, productId);
      assert.equal(shop.name, name);
      assert.equal(shop.asset, asset);
      assert.equal(shop.salesWorkPointsPerUnit, 300);
      assert.equal(getShopSalesCapacity(type, 300), 1);
      assert.equal(SHOP_TYPES.includes(type), true);
      assert.equal(canLinkToWarehouse(type), true);
    }
  });

  it('defines the vegetable farm crop cycle and construction limits', () => {
    const farm = RESIDENCES.farm_vegetables;
    assert.deepEqual([farm.width, farm.height, farm.maxWorkers, farm.stockCapacity, farm.workPoints], [
      3, 3, 50, 100, 110000,
    ]);
    assert.deepEqual(farm.cost, { wood: 100, stone: 40, iron: 40 });
    assert.equal(farm.stockProductId, 'vegetables');
    assert.deepEqual(farm.cropRule, FARM_CROP_RULES.farm_vegetables);
    assert.equal(canLinkToWarehouse('farm_vegetables'), true);
    assert.deepEqual(
      planTransfers(
        {
          stock: new Map(),
          minimumStock: new Map(),
          maximumStock: new Map([['vegetables', 100]]),
          capacityM3: 50,
          workPoints: 100000,
        },
        [{ buildingId: 'vegetable-farm', type: 'farm_vegetables', stock: 12 }],
      ),
      [{ buildingId: 'vegetable-farm', productId: 'vegetables', quantity: 12, direction: 'out' }],
    );
  });
});

describe('work settings', () => {
  const workplace = (id: string, x: number, wage: number, desiredWorkers: number) => ({
    id,
    type: 'farm_rice' as const,
    x,
    y: 0,
    wage,
    workHoursPerDay: 8,
    desiredWorkers,
    minimumWorkerTechnique: 10,
  });

  it('allows up to 100 workers during construction and applies the building limit on completion', () => {
    assert.equal(getMaxDesiredWorkers('shop_milk', 'under_construction'), 100);
    assert.equal(getMaxDesiredWorkers('shop_milk', 'completed'), 1);

    const homes = [{
      id: 'home',
      type: 'house_poor2' as const,
      x: 0,
      y: 0,
      occupants: 100,
      internalAppeal: 10,
      technique: 10,
    }];
    const workplace = {
      id: 'dairy-shop',
      type: 'shop_milk' as const,
      x: 1,
      y: 0,
      wage: 10,
      workHoursPerDay: 8,
      desiredWorkers: 100,
      minimumWorkerTechnique: 10,
    };

    assert.deepEqual(
      allocateWorkers(homes, [{ ...workplace, status: 'under_construction' }]),
      [{ workplaceId: 'dairy-shop', residenceId: 'home', count: 100 }],
    );
    assert.deepEqual(
      allocateWorkers(homes, [{ ...workplace, status: 'completed' }]),
      [{ workplaceId: 'dairy-shop', residenceId: 'home', count: 1 }],
    );
    assert.deepEqual(
      getEmploymentSummary([
        { type: 'shop_milk', status: 'completed', wage: 10, desiredWorkers: 100, employed: 1 },
      ]),
      { employed: 1, jobOffers: 0, averageWage: 10 },
    );
  });

  it('summarizes employed people, open job offers, and the employed-weighted daily wage', () => {
    assert.deepEqual(
      getEmploymentSummary([
        { type: 'shop_rice', status: 'completed', wage: 100, desiredWorkers: 4, employed: 2 },
        { type: 'warehouse', status: 'completed', wage: 50, desiredWorkers: 150, employed: 10 },
        { type: 'house_poor1', status: 'completed', wage: 25, desiredWorkers: 6, employed: 3 },
        { type: 'house_poor1', status: 'under_construction', wage: 25, desiredWorkers: 2, employed: 0 },
      ]),
      { employed: 12, jobOffers: 92, averageWage: 700 / 12 },
    );
  });

  it('accepts valid wage and hours and rejects invalid values', () => {
    assert.deepEqual(parseWorkSettings({ wage: 15, workHoursPerDay: 8, desiredWorkers: 3 }), {
      wage: 15,
      workHoursPerDay: 8,
      desiredWorkers: 3,
      minimumWorkerTechnique: 10,
    });
    assert.equal(
      parseWorkSettings({
        wage: 10,
        workHoursPerDay: 8,
        desiredWorkers: 0,
        minimumWorkerTechnique: 9,
      }),
      null,
    );
    assert.deepEqual(
      parseWorkSettings({
        wage: 10,
        workHoursPerDay: 8,
        desiredWorkers: 0,
        minimumWorkerTechnique: 40,
      }),
      {
        wage: 10,
        workHoursPerDay: 8,
        desiredWorkers: 0,
        minimumWorkerTechnique: 40,
      },
    );
    assert.equal(
      parseWorkSettings({
        wage: 10,
        workHoursPerDay: 8,
        desiredWorkers: 0,
        minimumWorkerTechnique: 20.5,
      }),
      null,
    );
    assert.equal(
      parseWorkSettings({
        wage: 10,
        workHoursPerDay: 8,
        desiredWorkers: 0,
        minimumWorkerTechnique: 41,
      }),
      null,
    );
    assert.equal(parseWorkSettings({ wage: 15, workHoursPerDay: 8 }), null);
    assert.equal(parseWorkSettings({ wage: 15, workHoursPerDay: 8, desiredWorkers: -1 }), null);
    assert.equal(parseWorkSettings({ wage: -1, workHoursPerDay: 8, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 3, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings({ wage: 10, workHoursPerDay: 15, desiredWorkers: 0 }), null);
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 4, desiredWorkers: 0 }));
    assert.ok(parseWorkSettings({ wage: 10, workHoursPerDay: 14, desiredWorkers: 0 }));
    assert.deepEqual(parseWorkSettings({ wage: 1.5, workHoursPerDay: 8, desiredWorkers: 0 }), {
      wage: 1.5,
      workHoursPerDay: 8,
      desiredWorkers: 0,
      minimumWorkerTechnique: 10,
    });
    assert.equal(parseWorkSettings({ wage: 1.234, workHoursPerDay: 8, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings(null), null);
  });

  it('computes the distance-adjusted work benefit', () => {
    assert.equal(getHoursFactor(8), 1);
    assert.equal(getHoursFactor(14), 0.5);
    assert.equal(getHoursFactor(2), 0.5);
    assert.equal(getWorkBenefit(10, 80, 8), 300);
    assert.ok(Math.abs(getWorkBenefit(10, 80, 8, 60) - 300 * Math.sqrt(0.5)) < 1e-12);
    assert.equal(getRestFactor(4), 1.2);
    assert.equal(getRestFactor(8), 1);
    assert.ok(Math.abs(getRestFactor(14) - 0.8) < 1e-9);
    assert.equal(getDailyWorkPoints(8, 100, 100), 100);
    assert.equal(getDailyWorkPoints(8, 50, 100), 50);
    assert.ok(Math.abs(getDailyWorkPoints(4, 100, 100) - 60) < 1e-9);
  });

  it('only assigns workers whose residence technique meets each workplace minimum', () => {
    const home = {
      id: 'home',
      type: 'house_poor1' as const,
      x: 100,
      y: 100,
      occupants: 10,
      internalAppeal: 10,
      technique: 25,
    };
    const eligible = workplace('eligible', 99, 10, 10);
    eligible.y = 99;
    eligible.minimumWorkerTechnique = 25;
    const ineligible = workplace('ineligible', 99, 100, 10);
    ineligible.y = 99;
    ineligible.minimumWorkerTechnique = 26;

    assert.deepEqual(allocateWorkers([home], [eligible, ineligible]), [
      { workplaceId: 'eligible', residenceId: 'home', count: 10 },
    ]);
  });

  it('distributes each home proportionally and rounds allocations to its population', () => {
    const home = {
      id: 'home',
      type: 'house_poor1' as const,
      x: 100,
      y: 100,
      occupants: 32,
      internalAppeal: 10,
      technique: 10,
    };
    const near = workplace('near', 99, 10, 32);
    near.y = 99;
    const far = workplace('far', 159, 10, 32);
    far.y = 99;
    const assignments = allocateWorkers([home], [near, far]);
    const distanceFactor = Math.sqrt(60 / 120);

    assert.deepEqual(assignments, [
      { workplaceId: 'near', residenceId: 'home', count: 19 },
      { workplaceId: 'far', residenceId: 'home', count: 13 },
    ]);
    assert.equal(assignments.reduce((sum, assignment) => sum + assignment.count, 0), home.occupants);
    assert.equal(getWorkBenefit(32, 10, 8, 60) / getWorkBenefit(32, 10, 8), distanceFactor);
  });

  it('caps proportional shares at vacancies and redistributes overflow', () => {
    const home = {
      id: 'home',
      type: 'house_poor1' as const,
      x: 100,
      y: 100,
      occupants: 10,
      internalAppeal: 10,
      technique: 10,
    };
    const scarce = workplace('scarce', 99, 1000, 2);
    scarce.y = 99;
    const available = workplace('available', 99, 10, 10);
    available.y = 99;
    assert.deepEqual(allocateWorkers([home], [scarce, available]), [
      { workplaceId: 'scarce', residenceId: 'home', count: 2 },
      { workplaceId: 'available', residenceId: 'home', count: 8 },
    ]);
  });

  it('updates vacancy-based benefits for each subsequent residence', () => {
    const homes = [
      {
        id: 'a',
        type: 'house_poor1' as const,
        x: 10,
        y: 10,
        occupants: 4,
        internalAppeal: 10,
        technique: 10,
      },
      {
        id: 'b',
        type: 'house_poor1' as const,
        x: 12,
        y: 10,
        occupants: 4,
        internalAppeal: 10,
        technique: 10,
      },
    ];
    const rich = workplace('rich', 9, 100, 5);
    rich.y = 9;
    const poor = workplace('poor', 9, 10, 5);
    poor.y = 9;
    const assignments = allocateWorkers(homes, [rich, poor]);
    assert.deepEqual(assignments, [
      { workplaceId: 'rich', residenceId: 'a', count: 4 },
      { workplaceId: 'rich', residenceId: 'b', count: 1 },
      { workplaceId: 'poor', residenceId: 'b', count: 3 },
    ]);
    assert.equal(assignments.reduce((sum, assignment) => sum + assignment.count, 0), 8);
    assert.deepEqual(
      [...getPayroll(
        [
          { id: 'rich', ownerId: 'u1', wage: 100 },
          { id: 'poor', ownerId: 'u1', wage: 10 },
        ],
        assignments,
      )],
      [['u1', 530]],
    );
    assert.deepEqual(
      [...getPayroll([{ id: 'cent-wage', ownerId: 'u2', wage: 0.23 }], [
        { workplaceId: 'cent-wage', residenceId: 'home', count: 3 },
      ])],
      [['u2', 0.69]],
    );
  });

  it('allocates scarce vacancies by internal appeal, breaking ties by residence id', () => {
    const homes = [
      {
        id: 'z-high-appeal',
        type: 'house_poor1' as const,
        x: 10,
        y: 10,
        occupants: 4,
        internalAppeal: 100,
        technique: 10,
      },
      {
        id: 'a-low-appeal',
        type: 'house_poor1' as const,
        x: 10,
        y: 10,
        occupants: 4,
        internalAppeal: 20,
        technique: 10,
      },
    ];
    assert.deepEqual(
      allocateWorkers(homes, [workplace('limited', 9, 10, 4)]),
      [{ workplaceId: 'limited', residenceId: 'z-high-appeal', count: 4 }],
    );
    assert.deepEqual(
      allocateWorkers(
        [
          { ...homes[1], id: 'z-tied-appeal' },
          { ...homes[1], id: 'a-tied-appeal' },
        ],
        [workplace('tied-limited', 9, 10, 4)],
      ),
      [{ workplaceId: 'tied-limited', residenceId: 'a-tied-appeal', count: 4 }],
    );
  });

  it('accepts rent in cents with a minimum of C$ 0.01', () => {
    assert.equal(parseRent({ rent: 1 }), 1);
    assert.equal(parseRent({ rent: 0.01 }), 0.01);
    assert.equal(parseRent({ rent: 2.5 }), 2.5);
    assert.equal(parseRent({ rent: 0 }), null);
    assert.equal(parseRent({ rent: 2.501 }), null);
  });
});

describe('immigration', () => {
  const home = (
    id: string,
    type: 'house_poor1' | 'house_poor2' | 'house_poor3',
    rent: number,
    occupants = 0,
  ) => ({
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

  it('uses the 128-person capacity of the third simple residence', () => {
    const result = allocateImmigrants([home('large', 'house_poor3', 1)], 150);
    assert.equal(result.get('large'), 128);
  });
});

describe('municipal zones', () => {
  it('accepts rectangles on the municipal boundary and rejects rectangles outside it', () => {
    assert.equal(
      getCityZonePlacementError(
        { minX: 849, minY: 849, maxX: 1151, maxY: 1151 },
        'urban',
        city,
        [],
      ),
      null,
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 848, minY: 849, maxX: 850, maxY: 850 },
        'urban',
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
      minimumWage: 1,
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
      assert.equal(getResidencePlacementError('farm_dairy', position, [ruralCity], [], road, allLand, map), null);
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
      assert.equal(getResidencePlacementError('shop_milk', position, [residentialCity], [], road, allLand, map), null);
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
      const valid = { productId: 'rice', minimumStock: 0, maximumStock: 10, price: 5, mode: 'buy' };
      assert.deepEqual(parseWarehouseSetting(valid), valid);
      assert.equal(parseWarehouseSetting({ ...valid, productId: 'unknown' }), null);
      assert.equal(parseWarehouseSetting({ ...valid, price: -1 }), null);
      assert.deepEqual(parseWarehouseSetting({ ...valid, price: 1.23 }), {
        ...valid,
        price: 1.23,
      });
      assert.equal(parseWarehouseSetting({ ...valid, price: 1.234 }), null);
      assert.equal(parseWarehouseSetting({ ...valid, maximumStock: 1.5 }), null);
      assert.equal(parseWarehouseSetting({ ...valid, minimumStock: 11 }), null);
      assert.deepEqual(parseWarehouseSetting({ ...valid, maximumStock: null }), { ...valid, maximumStock: null });
      assert.deepEqual(parseWarehouseSetting({ ...valid, maximumStock: 'MAX' }), { ...valid, maximumStock: null });
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
        minimumWorkerTechnique: 10,
        rent: 10,
        occupants: 0,
        wellbeing: 0,
        desiredWorkers: 0,
        averageWorkerTechnique: null,
        workPointsDone: 0,
        price: 10,
        stock: 0,
        stockLevels: {},
        warehouseIds: [],
        toolStock: 0,
        woodStock: 0,
        ironStock: 0,
        charcoalStock: 0,
        sugarcaneStock: 0,
        inputStocks: {},
        selectedInputProductId: null,
        averageIncome: 0,
        efficiencyPenalty: 0,
        farmAutomation: {
          enabled: false,
          plantingMonths: [],
          plantingWorkers: 0,
          harvestWorkers: 0,
        },
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
        minimumWorkerTechnique: 10,
        rent: 10,
        occupants: 0,
        wellbeing: 0,
        desiredWorkers: 0,
        averageWorkerTechnique: null,
        workPointsDone: 0,
        price: 10,
        stock: 0,
        stockLevels: {},
        warehouseIds: [],
        toolStock: 0,
        woodStock: 0,
        ironStock: 0,
        charcoalStock: 0,
        sugarcaneStock: 0,
        inputStocks: {},
        selectedInputProductId: null,
        averageIncome: 0,
        efficiencyPenalty: 0,
        farmAutomation: {
          enabled: false,
          plantingMonths: [],
          plantingWorkers: 0,
          harvestWorkers: 0,
        },
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
      assert.deepEqual(
        [
          RESIDENCES.house_poor3.width,
          RESIDENCES.house_poor3.height,
          RESIDENCES.house_poor3.capacity,
          RESIDENCES.house_poor3.localAppeal,
          RESIDENCES.house_poor3.cost.wood,
          RESIDENCES.house_poor3.cost.stone,
          RESIDENCES.house_poor3.workPoints,
        ],
        [4, 4, 128, 30, 1200, 2000, 300000],
      );
      assert.equal(isTileInResidenceFootprint(first, { x: 21, y: 21 }), true);
      assert.equal(isTileInResidenceFootprint(first, { x: 22, y: 21 }), false);
    });
  });

  it('allows overlapping zones of the same type', () => {
    const existing: CityZone[] = [{
      id: 'urban-1',
      cityId: 'city',
      type: 'urban',
      minX: 840,
      minY: 900,
      maxX: 850,
      maxY: 910,
    }];
    assert.equal(
      getCityZonePlacementError(
        { minX: 850, minY: 900, maxX: 860, maxY: 910 },
        'urban',
        city,
        existing,
      ),
      null,
    );
  });

  it('rejects overlapping urban and rural zones but allows them to touch', () => {
    const existing: CityZone[] = [{
      id: 'urban',
      cityId: 'city',
      type: 'urban',
      minX: 840,
      minY: 900,
      maxX: 850,
      maxY: 910,
    }];
    assert.equal(
      getCityZonePlacementError(
        { minX: 851, minY: 900, maxX: 860, maxY: 910 },
        'rural',
        city,
        existing,
      ),
      null,
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 850, minY: 900, maxX: 860, maxY: 910 },
        'rural',
        city,
        existing,
      ),
      'zone_overlap',
    );
  });

  it('accepts a building footprint covered by the union of same-type zones', () => {
    const overlappingUrbanZones: CityZone[] = [
      {
        id: 'urban-1',
        cityId: 'city',
        type: 'urban',
        minX: 10,
        minY: 10,
        maxX: 17,
        maxY: 16,
      },
      {
        id: 'urban-2',
        cityId: 'city',
        type: 'urban',
        minX: 16,
        minY: 16,
        maxX: 22,
        maxY: 22,
      },
    ];
    const footprint = [
      { minX: 16, minY: 16, maxX: 17, maxY: 17 },
    ];
    assert.equal(isFootprintInCityZone(footprint, overlappingUrbanZones, 'urban'), true);
    assert.equal(isFootprintInCityZone(footprint, overlappingUrbanZones, 'rural'), false);
    assert.equal(
      getResidencePlacementError(
        'house_poor1',
        { x: 16, y: 16 },
        [{
          id: 'city',
          name: 'Test',
          centerX: 100,
          centerY: 100,
          minimumWage: 1,
          population: 0,
          wellbeing: 0,
          economy: 0,
          zones: overlappingUrbanZones,
        }],
        [],
        [{ x: 15, y: 16 }],
        () => true,
        { width: 4000, height: 4000 },
      ),
      null,
    );
    assert.equal(
      isFootprintInCityZone(
        [{ minX: 16, minY: 16, maxX: 17, maxY: 17 }],
        [overlappingUrbanZones[0]],
        'urban',
      ),
      false,
    );
    assert.equal(
      isFootprintInCityZone(
        [{ minX: 16, minY: 16, maxX: 17, maxY: 17 }],
        [
          overlappingUrbanZones[0],
          { ...overlappingUrbanZones[1], minY: 18 },
        ],
        'urban',
      ),
      false,
    );
    const ruralZones: CityZone[] = [
      { ...overlappingUrbanZones[0], maxX: 17, maxY: 22, type: 'rural' },
      {
        ...overlappingUrbanZones[1],
        minX: 17,
        minY: 10,
        maxX: 22,
        type: 'rural',
      },
    ];
    assert.equal(
      getResidencePlacementError(
        'warehouse',
        { x: 16, y: 16 },
        [{
          id: 'city',
          name: 'Test',
          centerX: 100,
          centerY: 100,
          minimumWage: 1,
          population: 0,
          wellbeing: 0,
          economy: 0,
          zones: ruralZones,
        }],
        [],
        [{ x: 15, y: 16 }],
        () => true,
        { width: 4000, height: 4000 },
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
    minimumWage: 1,
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

  describe('salt gathering', () => {
    const city = {
      id: 'rural-city',
      name: 'Rural City',
      centerX: 100,
      centerY: 100,
      minimumWage: 1,
      population: 0,
      wellbeing: 0,
      economy: 0,
      zones: [{ id: 'r', cityId: 'rural-city', type: 'rural' as const, minX: 0, minY: 0, maxX: 300, maxY: 300 }],
    };
    const position = { x: 20, y: 20 };
    const road = [{ x: 19, y: 20 }];
    const map = { width: 4000, height: 4000 };
    const landByRiver = (x: number, y: number) => !(x === 20 && y === 19);

    it('requires a rural lot adjacent to water and a road', () => {
      assert.equal(getResidencePlacementError('salt_gatherer', position, [city], [], road, landByRiver, map), null);
      assert.equal(
        getResidencePlacementError('salt_gatherer', position, [city], [], road, () => true, map),
        'not_adjacent_to_water',
      );
      assert.equal(
        getResidencePlacementError('salt_gatherer', position, [city], [], [], landByRiver, map),
        'not_adjacent_to_road',
      );
      assert.equal(RESIDENCES.salt_gatherer.production?.workPointsPerUnit, 400);
      assert.equal(RESIDENCES.salt_gatherer.stockCapacity, 100);
      assert.equal(RESIDENCES.salt_gatherer.toolCapacity, 5);
      assert.deepEqual(
        [
          RESIDENCES.salt_gatherer.width,
          RESIDENCES.salt_gatherer.height,
          RESIDENCES.salt_gatherer.maxWorkers,
          RESIDENCES.salt_gatherer.workPoints,
        ],
        [2, 2, 40, 10000],
      );
    });
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
    assert.deepEqual(
      planProduction(
        RESIDENCES.fishery.production!,
        { progress: 50, workPoints: 1000, penalty: 30, freeSpace: 300 },
      ),
      {
        units: 7,
        progress: 50,
        woodUsed: 0,
        ironUsed: 0,
        charcoalUsed: 0,
        toolsUsed: 0,
        batchStockUsed: 0,
        inputStocksUsed: {},
      },
    );
    assert.equal(planFishing({ progress: 0, workPoints: 1000, penalty: 0, freeSpace: 4 }).fish, 4);
  });

  it('supplies tools and collects fish through a linked warehouse', () => {
    const transfers = planTransfers(
      { stock: new Map([['tools', 20]]), minimumStock: new Map(), maximumStock: new Map([['fish', 100]]), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 'f', type: 'fishery', stock: 30, toolStock: 4 }],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'f', productId: 'fish', quantity: 30, direction: 'out' },
      { buildingId: 'f', productId: 'tools', quantity: 6, direction: 'in' },
    ]);
  });

  it('withdraws fish from warehouse stock to replenish the fish shop', () => {
    const transfers = planTransfers(
      { stock: new Map([['fish', 40]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 'shop', type: 'shop_fish', stock: 0 }],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'shop', productId: 'fish', quantity: 5, direction: 'in' },
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
    assert.equal(planProduction(rule, { ...base, charcoal: 5, iron: 0 }).units, 0);
    assert.equal(planProduction(rule, { ...base, charcoal: 4, iron: 1 }).units, 0);
    const ok = planProduction(rule, { ...base, charcoal: 5, iron: 1 });
    assert.deepEqual([ok.units, ok.charcoalUsed, ok.ironUsed], [100, 5, 1]);
  });

  it('defines the new buildings', () => {
    assert.equal(RESIDENCES.iron_mine.toolDemandPerWorker, 0.15);
    assert.equal(RESIDENCES.lumber_mill.toolDemandPerWorker, 0.05);
    assert.equal(RESIDENCES.iron_mine.width, 3);
    assert.deepEqual(
      [
        RESIDENCES.farm_cane.width,
        RESIDENCES.farm_cane.maxWorkers,
        RESIDENCES.farm_cane.stockCapacity,
        RESIDENCES.farm_cane.workPoints,
        RESIDENCES.farm_spices.width,
        RESIDENCES.farm_spices.maxWorkers,
        RESIDENCES.farm_spices.stockCapacity,
        RESIDENCES.farm_spices.workPoints,
      ],
      [3, 10, 2000, 10000, 3, 50, 400, 320000],
    );
    assert.deepEqual(RESIDENCES.farm_cane.cost, { wood: 100, stone: 40, iron: 40 });
    assert.deepEqual(RESIDENCES.farm_spices.cost, { wood: 200, stone: 80, iron: 80 });
    assert.deepEqual(RESIDENCES.salt_gatherer.cost, { wood: 100, stone: 40, iron: 40 });
    assert.deepEqual(RESIDENCES.sugar_mill.cost, { wood: 100, stone: 40, iron: 40 });
    assert.equal(RESIDENCES.salt_gatherer.maxWorkers, 40);
    assert.equal(RESIDENCES.salt_gatherer.toolDemandPerWorker, 0.05);
    assert.equal(RESIDENCES.toolmaker.woodCapacity, undefined);
    assert.equal(RESIDENCES.toolmaker.charcoalCapacity, 30);
    assert.equal(RESIDENCES.sugar_mill.charcoalCapacity, 30);
    assert.equal(RESIDENCES.sugar_mill.maxWorkers, 60);
    assert.equal(RESIDENCES.sugar_mill.toolDemandPerWorker, 0.05);
    assert.deepEqual(
      [
        RESIDENCES.charcoal_works.width,
        RESIDENCES.charcoal_works.height,
        RESIDENCES.charcoal_works.maxWorkers,
        RESIDENCES.charcoal_works.stockCapacity,
        RESIDENCES.charcoal_works.toolCapacity,
        RESIDENCES.charcoal_works.woodCapacity,
        RESIDENCES.charcoal_works.workPoints,
      ],
      [3, 3, 20, 100, 40, 30, 120000],
    );
    assert.deepEqual(RESIDENCES.charcoal_works.cost, { wood: 60, stone: 20 });
    assert.equal(RESIDENCES.charcoal_works.toolDemandPerWorker, 0.5);
  });

  it('uses chance production for salt below and above 400 effective Work Points', () => {
    const rule = RESIDENCES.salt_gatherer.production!;
    const input = { progress: 0, penalty: 0, freeSpace: 100 };
    assert.equal(planProduction(rule, { ...input, workPoints: 200 }, () => 0.49).units, 1);
    assert.equal(planProduction(rule, { ...input, workPoints: 200 }, () => 0.5).units, 0);
    assert.equal(planProduction(rule, { ...input, workPoints: 800 }, () => 0.99).units, 2);
    assert.equal(planProduction(rule, { ...input, workPoints: 200, penalty: 50 }, () => 0.3).units, 0);
  });

  it('supplies charcoal and iron to a toolmaker through a warehouse', () => {
    const transfers = planTransfers(
      { stock: new Map([['charcoal', 20], ['iron', 3]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 't', type: 'toolmaker', stock: 0, charcoalStock: 10, ironStock: 1 }],
    );
    assert.deepEqual(
      transfers.map((t) => [t.productId, t.quantity, t.direction]),
      [['iron', 3, 'in'], ['charcoal', 20, 'in']],
    );
  });

  it('supplies selected mill and factory inputs from a linked warehouse', () => {
    const transfers = planTransfers(
      {
        stock: new Map([
          ['wheat', 20],
          ['barley', 20],
          ['flour', 30],
          ['milk', 2000],
          ['salt', 133],
        ]),
        minimumStock: new Map(),
        maximumStock: new Map(),
        capacityM3: 50,
        workPoints: 1e6,
      },
      [
        {
          buildingId: 'mill',
          type: 'flour_mill',
          stock: 0,
          selectedInputProductId: 'barley',
          inputStocks: {},
        },
        { buildingId: 'bread-factory', type: 'bread_factory', stock: 0, inputStocks: { flour: 29 } },
        { buildingId: 'cheese-factory', type: 'cheese_factory', stock: 0, inputStocks: { milk: 1990, salt: 130 } },
      ],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'bread-factory', productId: 'flour', quantity: 1, direction: 'in' },
      { buildingId: 'cheese-factory', productId: 'milk', quantity: 10, direction: 'in' },
      { buildingId: 'cheese-factory', productId: 'salt', quantity: 3, direction: 'in' },
      { buildingId: 'mill', productId: 'barley', quantity: 20, direction: 'in' },
    ]);
  });

  it('defines flour production, factories, shops, and the mill input selector', () => {
    const flour = PRODUCTS.find((product) => product.id === 'flour');
    assert.deepEqual(
      flour && [flour.name, flour.category, flour.unit, flour.weightKg, flour.volumeM3, flour.shelfLifeDays],
      ['Farinha', 'processed', 'unit', 5, 0.01, 365],
    );
    assert.deepEqual(
      [
        RESIDENCES.flour_mill.width,
        RESIDENCES.flour_mill.height,
        RESIDENCES.flour_mill.maxWorkers,
        RESIDENCES.flour_mill.stockCapacity,
        RESIDENCES.flour_mill.workPoints,
      ],
      [3, 3, 60, 100, 110000],
    );
    assert.deepEqual(RESIDENCES.flour_mill.inputCapacities, { wheat: 20, barley: 20, corn: 20 });
    assert.equal(RESIDENCES.flour_mill.defaultInputProductId, 'wheat');
    assert.equal(parseInputProductSelection('flour_mill', { productId: 'corn' }), 'corn');
    assert.equal(parseInputProductSelection('flour_mill', { productId: 'rice' }), null);
    assert.equal(parseInputProductSelection('bread_factory', { productId: 'flour' }), null);
    assert.deepEqual(
      [
        RESIDENCES.bread_factory.stockCapacity,
        RESIDENCES.bread_factory.maxWorkers,
        RESIDENCES.bread_factory.workPoints,
        RESIDENCES.bread_factory.inputCapacities?.flour,
        RESIDENCES.bread_factory.toolCapacity,
        RESIDENCES.bread_factory.toolDemandPerWorker,
        RESIDENCES.cheese_factory.stockCapacity,
        RESIDENCES.cheese_factory.maxWorkers,
        RESIDENCES.cheese_factory.workPoints,
        RESIDENCES.cheese_factory.inputCapacities?.milk,
        RESIDENCES.cheese_factory.inputCapacities?.salt,
        RESIDENCES.cheese_factory.toolCapacity,
        RESIDENCES.cheese_factory.toolDemandPerWorker,
      ],
      [300, 60, 480000, 30, 60, 0.25, 100, 200, 960000, 2000, 133, 200, 0.25],
    );
    assert.equal(RESIDENCES.bread_factory.kind, 'workshop');
    assert.equal(RESIDENCES.cheese_factory.kind, 'workshop');
    assert.deepEqual(
      getConstructionMenuDefinitions('artesanais')
        .filter(({ type }) => ['bread_factory', 'cheese_factory'].includes(type))
        .map(({ type }) => type),
      ['bread_factory', 'cheese_factory'],
    );
    assert.equal(getConstructionMenuDefinitions('industrias').some(({ type }) =>
      type === 'bread_factory' || type === 'cheese_factory'), false);
    assert.deepEqual(
      [
        RESIDENCES.shop_bread.stockCapacity,
        RESIDENCES.shop_bread.maxWorkers,
        RESIDENCES.shop_bread.salesWorkPointsPerUnit,
        RESIDENCES.shop_cheese.stockCapacity,
        RESIDENCES.shop_cheese.maxWorkers,
        RESIDENCES.shop_cheese.salesWorkPointsPerUnit,
        RESIDENCES.shop_chocolate.stockCapacity,
        RESIDENCES.shop_chocolate.maxWorkers,
        RESIDENCES.shop_chocolate.salesWorkPointsPerUnit,
        RESIDENCES.shop_fruit.stockCapacity,
        RESIDENCES.shop_fruit.maxWorkers,
        RESIDENCES.shop_fruit.salesWorkPointsPerUnit,
      ],
      [350, 8, 3, 35, 8, 26, 20, 8, 54, 6, 8, 160],
    );
    assert.equal(SHOP_TYPES.includes('shop_bread'), true);
    assert.equal(SHOP_TYPES.includes('shop_cheese'), true);
    assert.equal(SHOP_TYPES.includes('shop_chocolate'), true);
    assert.equal(SHOP_TYPES.includes('shop_fruit'), true);
    assert.equal(canLinkToWarehouse('flour_mill'), true);
    assert.equal(canLinkToWarehouse('bread_factory'), true);
    assert.deepEqual(
      [RESIDENCES.farm_fruit.stockCapacity, RESIDENCES.farm_cocoa.stockCapacity],
      [1000, 400],
    );
    assert.deepEqual(
      [FARM_CROP_RULES.farm_fruit, FARM_CROP_RULES.farm_cocoa].map((rule) => [
        rule.growthMonths,
        rule.dailyWorkPoints,
        rule.harvestWorkPointsPerUnit,
        rule.baseYield,
        [...rule.plantingEfficiencyByQuarter],
      ]),
      [
        [12, 5000, 20, 1000, [1, 0.8, 0.6, 0.4]],
        [12, 2000, 62, 400, [1, 0.9, 0.7, 0.5]],
      ],
    );
  });

  it('uses input stocks and work points for flour, bread, and cheese production batches', () => {
    const recipes = [
      ['flour_mill', 300, 1, 100, 5, 1],
      ['bread_factory', 200, 1, 300, 10, 1],
    ] as const;
    for (const [type, workPoints, input, capacity, output, consumed] of recipes) {
      const rule = RESIDENCES[type].production!;
      const result = planProduction(rule, {
        progress: 0,
        workPoints,
        penalty: 0,
        freeSpace: capacity,
        batchStock: input,
      });
      assert.deepEqual([result.units, result.batchStockUsed], [output, consumed]);
    }
    const cheese = planProduction(RESIDENCES.cheese_factory.production!, {
        progress: 0,
        workPoints: 200,
        penalty: 0,
        freeSpace: 100,
        inputStocks: { milk: 15, salt: 1 },
      });
    assert.deepEqual([cheese.units, cheese.inputStocksUsed], [1, { milk: 15, salt: 1 }]);
    assert.equal(
      planProduction(RESIDENCES.cheese_factory.production!, {
        progress: 0,
        workPoints: 200,
        penalty: 0,
        freeSpace: 100,
        inputStocks: { milk: 15 },
      }).units,
      0,
    );
  });

  it('produces the requested steel, thread, textiles, furniture, utilities, and glass batches', () => {
    const recipes: readonly [
      keyof typeof RESIDENCES,
      number,
      Readonly<Record<string, number>>,
      number,
    ][] = [
      ['steelworks', 400, { iron: 2, charcoal: 10 }, 1],
      ['thread_factory', 300, { cotton: 1, wool: 1, charcoal: 4 }, 2],
      ['textile_factory', 400, { thread: 1, charcoal: 2 }, 2],
      ['furniture_factory', 400, { wood: 1 }, 1],
      ['utilities_factory', 400, { steel: 1, charcoal: 5 }, 8],
      ['glass_factory', 400, { sand: 10, charcoal: 20 }, 8],
    ];
    for (const [type, workPoints, recipeInputs, expectedUnits] of recipes) {
      const definition = RESIDENCES[type];
      const stockCapacity = definition.stockCapacity;
      assert.ok(stockCapacity !== undefined, type);
      let charcoal = 0;
      const inputStocks: Record<string, number> = {};
      for (const [productId, amount] of Object.entries(recipeInputs)) {
        if (productId === 'charcoal') charcoal = amount;
        else inputStocks[productId] = amount;
      }
      const result = planProduction(definition.production!, {
        progress: 0,
        workPoints,
        penalty: 0,
        freeSpace: stockCapacity,
        charcoal,
        inputStocks,
      });
      assert.equal(result.units, expectedUnits, type);
      assert.deepEqual(result.inputStocksUsed, recipeInputs, type);
      assert.equal(definition.maxWorkers, 40, type);
      assert.equal(definition.toolCapacity, type === 'steelworks' ? undefined : 80, type);
      if (type !== 'steelworks') assert.equal(definition.toolDemandPerWorker, 2, type);
    }
  });

  it('makes sugar using canes, charcoal, Work Points, and available stock space', () => {
    const rule = RESIDENCES.sugar_mill.production!;
    const input = {
      progress: 0,
      workPoints: 600,
      penalty: 0,
      freeSpace: 200,
      charcoal: 3,
      batchStock: 6,
    };
    const result = planProduction(rule, input);
    assert.deepEqual(
      [result.units, result.charcoalUsed, result.batchStockUsed],
      [1, 3, 6],
    );
    assert.equal(
      planProduction(rule, { ...input, batchStock: 5 }).units,
      0,
    );
    assert.equal(planProduction(rule, { ...input, charcoal: 2 }).units, 0);
    assert.equal(
      planProduction(rule, { ...input, freeSpace: 0 }).units,
      0,
    );
    assert.deepEqual(
      [
        RESIDENCES.sugar_mill.width,
        RESIDENCES.sugar_mill.height,
        RESIDENCES.sugar_mill.maxWorkers,
        RESIDENCES.sugar_mill.stockCapacity,
        RESIDENCES.sugar_mill.sugarcaneCapacity,
        RESIDENCES.sugar_mill.toolCapacity,
        RESIDENCES.sugar_mill.workPoints,
      ],
      [3, 3, 60, 200, 400, 5, 60000],
    );
    assert.equal(
      planProduction(rule, { ...input, workPoints: 600, penalty: 50 }).units,
      0,
    );
  });

  it('supplies the sugar mill with cane and charcoal from a linked warehouse', () => {
    const transfers = planTransfers(
      {
        stock: new Map([['sugarcane', 400], ['charcoal', 30]]),
        minimumStock: new Map(),
        maximumStock: new Map(),
        capacityM3: 50,
        workPoints: 1e6,
      },
      [{ buildingId: 'sugar-mill', type: 'sugar_mill', stock: 0, sugarcaneStock: 0, charcoalStock: 0 }],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'sugar-mill', productId: 'charcoal', quantity: 30, direction: 'in' },
      { buildingId: 'sugar-mill', productId: 'sugarcane', quantity: 400, direction: 'in' },
    ]);
  });

  it('makes five charcoal per 200 Work Points and one wood', () => {
    const rule = RESIDENCES.charcoal_works.production!;
    const result = planProduction(rule, {
      progress: 0,
      workPoints: 200,
      penalty: 0,
      freeSpace: 100,
      wood: 1,
    });
    assert.deepEqual([result.units, result.woodUsed], [5, 1]);
    assert.equal(
      planProduction(rule, {
        progress: 0,
        workPoints: 200,
        penalty: 0,
        freeSpace: 100,
        wood: 0,
      }).units,
      0,
    );
  });

  it('supplies the charcoal works with wood and tools through a warehouse', () => {
    const transfers = planTransfers(
      {
        stock: new Map([['wood', 30], ['tools', 10]]),
        minimumStock: new Map(),
        maximumStock: new Map(),
        capacityM3: 50,
        workPoints: 1e6,
      },
      [{ buildingId: 'charcoal-works', type: 'charcoal_works', stock: 0, woodStock: 0, toolStock: 0 }],
    );
    assert.deepEqual(
      transfers.map(({ productId, quantity, direction }) => [productId, quantity, direction]),
      [['tools', 10, 'in'], ['wood', 30, 'in']],
    );
  });

  it('defines the requested weights, volumes, and infinite shelf life for new products', () => {
    const newProducts = ['sand', 'steel', 'clothing', 'furniture', 'utilities', 'glass'];
    assert.deepEqual(
      newProducts.map((id) => {
        const definition = PRODUCTS.find((product) => product.id === id);
        assert.ok(definition);
        return [definition.weightKg, definition.volumeM3, definition.shelfLifeDays];
      }),
      [
        [150, 0.1, null],
        [800, 0.1, null],
        [25, 0.1, null],
        [50, 0.1, null],
        [5, 0.01, null],
        [300, 0.1, null],
      ],
    );
  });
});

describe('carvão', () => {
  it('has the specified weight, volume, and unlimited shelf life', () => {
    const charcoal = PRODUCTS.find(({ id }) => id === 'charcoal');
    assert.ok(charcoal);
    assert.deepEqual(
      [charcoal.weightKg, charcoal.volumeM3, charcoal.shelfLifeDays],
      [5, 0.015, null],
    );
  });
});

describe('renda média', () => {
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

describe('obras', () => {
  it('accumulates Work Points and completes at the required amount', () => {
    const day = getDailyWorkPoints(8, 100, 100);
    const partial = advanceConstruction(0, 6000, 2, 8, 100, 100);
    assert.equal(partial.done, 2 * day);
    assert.equal(partial.completed, false);
    const finished = advanceConstruction(5900, 6000, 1, 8, 100, 100);
    assert.deepEqual(finished, { done: 6000, completed: true });
  });

  it('can complete every building type from its own requirement', () => {
    for (const definition of Object.values(RESIDENCES)) {
      const result = advanceConstruction(definition.workPoints - 1, definition.workPoints, 1, 8, 100, 100);
      assert.equal(result.completed, true, definition.type);
    }
  });
});

describe('comandos do master', () => {
  it('only accepts known time scales and sane grants', async () => {
    const {
      isPastDailyWorldRefreshTime,
      isValidTimeScale,
      parseMasterGrant,
    } = await import('./worldClock');
    for (const scale of [15, 30, 60, 240]) assert.equal(isValidTimeScale(scale), true);
    for (const scale of [0, 1, 45, -15, '15', null]) assert.equal(isValidTimeScale(scale), false);
    assert.equal(isPastDailyWorldRefreshTime(0, 29), false);
    assert.equal(isPastDailyWorldRefreshTime(0, 30), true);
    assert.equal(isPastDailyWorldRefreshTime(0, 31), true);
    assert.equal(isPastDailyWorldRefreshTime(1, 0), true);
    assert.equal(isPastDailyWorldRefreshTime(24, 0), false);
    assert.equal(isPastDailyWorldRefreshTime(0, 60), false);
    assert.equal(parseMasterGrant(500), 500);
    assert.equal(parseMasterGrant(0.01), 0.01);
    assert.equal(parseMasterGrant(1.5), 1.5);
    for (const grant of [0, -5, 1.234, 2_000_000_000, '10', NaN]) assert.equal(parseMasterGrant(grant), null);
  });
});

describe('hist�rico de transporte do armaz�m', () => {
  it('explica por que a carga n�o foi transportada', async () => {
    const { planTransfersDetailed } = await import('./logistics');
    const link = [{ buildingId: 'a', type: 'fishery' as const, stock: 13, toolStock: 0 }];
    const run = (maximumStock: number, workPoints: number) =>
      planTransfersDetailed(
        { stock: new Map(), minimumStock: new Map(), maximumStock: new Map([['fish', maximumStock]]), capacityM3: 50, workPoints },
        link,
      ).attempts[0];
    assert.deepEqual(run(1000, 1000), { buildingId: 'a', productId: 'fish', direction: 'out', wanted: 13, moved: 13, reason: null });
    assert.equal(run(1000, 0).reason, 'no_work_points');
    assert.equal(run(1000, 0).moved, 0);
    assert.equal(run(0, 1000).reason, 'desired_reached');
    assert.equal(run(5, 1000).moved, 5);
  });

});

describe('validade dos produtos', () => {
  it('perde a fração diária do estoque e sorteia unidades indivisíveis', () => {
    assert.equal(planDailySpoilage(10, 10, () => 0.99), 1);
    assert.equal(planDailySpoilage(10, 100, () => 0.05), 1);
    assert.equal(planDailySpoilage(10, 100, () => 0.5), 0);
    assert.equal(planDailySpoilage(200, 100, () => 0.99), 2);
    assert.equal(planDailySpoilage(10, 1, () => 0.99), 10);
    assert.equal(planDailySpoilage(0, 10, () => 0), 0);
  });
});
