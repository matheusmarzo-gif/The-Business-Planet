import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
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
  isWithinWorkerSearchRadius,
  parseWorkSettings,
  RESIDENCES,
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
  getCityProductAveragePrices,
  getCityProductKey,
  getShopDailyFinancials,
  getPurchaseBenefitCalculation,
  getShopSalesCapacity,
  isShopResidenceTransaction,
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
import { parseBasicDemandConfig } from './commerceDemand';

const city = { centerX: 1000, centerY: 1000 };

describe('wallet', () => {
  it('starts with C$ 10.000 and formats money in Brazilian style', () => {
    assert.equal(STARTING_BALANCE, 10000);
    assert.equal(formatMoney(STARTING_BALANCE).replace(/\u00a0/g, ' '), 'C$ 10.000');
    assert.equal(formatMoney(1.23).replace(/\u00a0/g, ' '), 'C$ 1,23');
    assert.equal(isCurrencyAmount(1.23), true);
    assert.equal(isCurrencyAmount(1.234), false);
    assert.equal(isCurrencyAmount(1.2300000000001), false);
    assert.equal(roundCurrency(1.23 * 3), 3.69);
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
    assert.equal(getHarvestDay('2026-01-31', FARM_CROP_RULES.farm_cattle.growthMonths), '2028-01-31');
    assert.equal(grow('2026-04-10', 'farm_cattle', 500).yieldUnits, 1000);
  });

  it('matches the rice farm construction and storage limits', () => {
    for (const farmType of [
      'farm_rice',
      'farm_potato',
      'farm_wheat',
      'farm_barley',
      'farm_corn',
      'farm_cattle',
    ] as const) {
      const farm = RESIDENCES[farmType];
      assert.equal(farm.width, 4);
      assert.equal(farm.height, 4);
      assert.deepEqual(farm.cost, { wood: 200, stone: 20 });
      assert.equal(farm.stockCapacity, 300);
      assert.equal(farm.maxWorkers, 30);
      assert.equal(farm.workPoints, 12000);
    }
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
      ],
      [100, 25, 2000, 5000, 10, 600],
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
      { stock: new Map(), minimumStock: new Map(), maximumStock: new Map([['rice', 100]]), capacityM3: 50, workPoints: 1000 },
      [link('farm', 'farm_rice', 300), link('shop', 'shop_rice', 5)],
    );
    // A fazenda envia 100 (desejável) = 200 pontos; a loja recebe 15 (20 - 5) = 30 pontos.
    assert.deepEqual(transfers, [
      { buildingId: 'farm', productId: 'rice', quantity: 100, direction: 'out' },
      { buildingId: 'shop', productId: 'rice', quantity: 15, direction: 'in' },
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
    assert.equal(supply[0].quantity, 8);
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
    assert.deepEqual(supply, [{ buildingId: 'shop', productId: 'fish', quantity: 30, direction: 'in' }]);
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
    assert.deepEqual(transfers.map((transfer) => transfer.quantity), Array(10).fill(20));
  });

  it('scales each shop share to its remaining stock need', () => {
    const transfers = planTransfers(
      { stock: new Map([['fish', 30]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 10000 },
      [
        { buildingId: 'shop-a', type: 'shop_fish', stock: 20 },
        { buildingId: 'shop-b', type: 'shop_fish', stock: 0 },
      ],
    );
    assert.deepEqual(
      transfers.map(({ buildingId, quantity }) => [buildingId, quantity]),
      [['shop-a', 10], ['shop-b', 20]],
    );
  });

  it('logs shared stock rationing as proportional distribution', async () => {
    const { planTransfersDetailed } = await import('./logistics');
    const { attempts } = planTransfersDetailed(
      { stock: new Map([['fish', 40]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 10000 },
      [
        { buildingId: 'shop-a', type: 'shop_fish', stock: 0 },
        { buildingId: 'shop-b', type: 'shop_fish', stock: 0 },
      ],
    );
    assert.deepEqual(attempts.map(({ wanted, moved, reason }) => [wanted, moved, reason]), [
      [40, 20, 'insufficient_stock'],
      [40, 20, 'insufficient_stock'],
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
  const home = (id: string, x: number, occupants: number, averageIncome: number) => ({
    id,
    cityId: 'city-a',
    type: 'house_poor1' as const,
    x,
    y: 0,
    occupants,
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
  ]);
  const cityPrices = (productId: string, price: number) =>
    new Map([[getCityProductKey('city-a', productId), price]]);

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
    assert.equal(getShopSalesCapacity('shop_rice', 19), 0);
    assert.equal(getShopSalesCapacity('shop_rice', 20), 1);
    const newShopTypes = ['shop_potato', 'shop_corn', 'shop_barley', 'shop_wheat', 'shop_butcher'] as const;
    assert.deepEqual(newShopTypes.map((type) => getShopSalesCapacity(type, 40)), [2, 2, 2, 2, 2]);
    assert.equal(getShopSalesCapacity('shop_fish', 40), 2);
    assert.equal(getShopSalesCapacity('shop_milk', 1), 1);
    assert.equal(getShopSalesCapacity('shop_milk', 0.9), 0);
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
    assert.deepEqual(diagnostic.basketBreakdown, breakdown);
    assert.equal(diagnostic.referenceBasketCost, 1.9143);
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
      [3, 3, 10, 400, 12000],
    );
    assert.deepEqual(dairy.cost, { wood: 60, stone: 60 });
    assert.equal(dairy.asset, '/buildings/farms/fazenda_leiteira.png');
    assert.deepEqual(
      planProduction(
        dairy.production!,
        { progress: 2, workPoints: 11, penalty: 0, freeSpace: 4 },
      ),
      { units: 2, progress: 3, woodUsed: 0, ironUsed: 0, batchStockUsed: 0 },
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
    ].join('\n'));
    assert.equal(multipliers.get('rice'), 0.03);
    assert.equal(multipliers.get('wheat'), 0.03);
    assert.equal(multipliers.get('barley'), 0.03);
    assert.equal(multipliers.get('corn'), 0.03);
    assert.equal(multipliers.get('potato'), 0.03);
    assert.equal(multipliers.get('fish'), 0.03);
    assert.equal(multipliers.get('red_meat'), 0.03);
    assert.equal(multipliers.get('milk'), 1);
    assert.throws(() => parseBasicDemandConfig('demanda_basica.milk=-1'), /linha 1/);
    assert.throws(
      () => parseBasicDemandConfig('demanda_basica.rice=0.03'),
      /não define o produto wheat/,
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
      [fishShop.width, fishShop.height, fishShop.maxWorkers, fishShop.workPoints],
    );
    assert.equal(dairyShop.stockCapacity, 400);
    assert.deepEqual(dairyShop.cost, fishShop.cost);
    assert.equal(dairyShop.stockProductId, 'milk');
    assert.equal(dairyShop.asset, '/buildings/commerce/loja_leite.png');
    assert.equal(canLinkToWarehouse('farm_dairy'), true);
    assert.equal(canLinkToWarehouse('shop_milk'), true);
    assert.deepEqual(
      planTransfers(
        {
          stock: new Map(),
          minimumStock: new Map(),
          maximumStock: new Map([['milk', 400]]),
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
      ['shop_butcher', 'red_meat', 'Açougue', '/buildings/commerce/loja_acougue.png'],
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
  });

  it('allows up to 100 workers during construction and applies the building limit on completion', () => {
    assert.equal(getMaxDesiredWorkers('shop_milk', 'under_construction'), 100);
    assert.equal(getMaxDesiredWorkers('shop_milk', 'completed'), 4);

    const homes = [{ id: 'home', type: 'house_poor2' as const, x: 0, y: 0, occupants: 100 }];
    const workplace = {
      id: 'dairy-shop',
      type: 'shop_milk' as const,
      x: 1,
      y: 0,
      wage: 10,
      workHoursPerDay: 8,
      desiredWorkers: 100,
    };

    assert.deepEqual(
      allocateWorkers(homes, [{ ...workplace, status: 'under_construction' }]),
      [{ workplaceId: 'dairy-shop', residenceId: 'home', count: 100 }],
    );
    assert.deepEqual(
      allocateWorkers(homes, [{ ...workplace, status: 'completed' }]),
      [{ workplaceId: 'dairy-shop', residenceId: 'home', count: 4 }],
    );
    assert.deepEqual(
      getEmploymentSummary([
        { type: 'shop_milk', status: 'completed', wage: 10, desiredWorkers: 100, employed: 4 },
      ]),
      { employed: 4, jobOffers: 0, averageWage: 10 },
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
      { employed: 12, jobOffers: 94, averageWage: 700 / 12 },
    );
  });

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
    assert.deepEqual(parseWorkSettings({ wage: 1.5, workHoursPerDay: 8, desiredWorkers: 0 }), {
      wage: 1.5,
      workHoursPerDay: 8,
      desiredWorkers: 0,
    });
    assert.equal(parseWorkSettings({ wage: 1.234, workHoursPerDay: 8, desiredWorkers: 0 }), null);
    assert.equal(parseWorkSettings(null), null);
  });

  it('computes the distance-adjusted work benefit', () => {
    assert.equal(getHoursFactor(8), 1);
    assert.equal(getHoursFactor(14), 0.5);
    assert.equal(getHoursFactor(2), 0.5);
    assert.equal(getWorkBenefit(10, 80, 8), 100);
    assert.ok(Math.abs(getWorkBenefit(10, 80, 8, 60) - 100 * Math.sqrt(0.5)) < 1e-12);
    assert.equal(getRestFactor(4), 1.2);
    assert.equal(getRestFactor(8), 1);
    assert.ok(Math.abs(getRestFactor(14) - 0.8) < 1e-9);
    assert.equal(getDailyWorkPoints(8, 100, 100), 100);
    assert.equal(getDailyWorkPoints(8, 50, 100), 50);
    assert.ok(Math.abs(getDailyWorkPoints(4, 100, 100) - 60) < 1e-9);
  });

  it('distributes each home proportionally and rounds allocations to its population', () => {
    const home = { id: 'home', type: 'house_poor1' as const, x: 100, y: 100, occupants: 32 };
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
    const home = { id: 'home', type: 'house_poor1' as const, x: 100, y: 100, occupants: 10 };
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
      { id: 'a', type: 'house_poor1' as const, x: 10, y: 10, occupants: 4 },
      { id: 'b', type: 'house_poor1' as const, x: 12, y: 10, occupants: 4 },
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

  it('accepts rent in cents with a minimum of C$ 0.01', () => {
    assert.equal(parseRent({ rent: 1 }), 1);
    assert.equal(parseRent({ rent: 0.01 }), 0.01);
    assert.equal(parseRent({ rent: 2.5 }), 2.5);
    assert.equal(parseRent({ rent: 0 }), null);
    assert.equal(parseRent({ rent: 2.501 }), null);
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
        sugarcaneStock: 0,
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
        sugarcaneStock: 0,
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

  describe('salt gathering', () => {
    const city = {
      id: 'rural-city',
      name: 'Rural City',
      centerX: 100,
      centerY: 100,
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
        [2, 2, 10, 6000],
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
      { units: 7, progress: 50, woodUsed: 0, ironUsed: 0, batchStockUsed: 0 },
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
      { buildingId: 'shop', productId: 'fish', quantity: 40, direction: 'in' },
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
      [3, 10, 2000, 12000, 3, 50, 400, 12000],
    );
    assert.deepEqual(RESIDENCES.farm_cane.cost, { wood: 60, stone: 60 });
    assert.deepEqual(RESIDENCES.farm_spices.cost, { wood: 60, stone: 60 });
    assert.deepEqual(RESIDENCES.salt_gatherer.cost, { wood: 30, stone: 20 });
    assert.deepEqual(RESIDENCES.sugar_mill.cost, { wood: 30, stone: 80 });
    assert.equal(RESIDENCES.salt_gatherer.maxWorkers, 10);
    assert.equal(RESIDENCES.salt_gatherer.toolDemandPerWorker, 0.05);
    assert.equal(RESIDENCES.sugar_mill.maxWorkers, 40);
    assert.equal(RESIDENCES.sugar_mill.toolDemandPerWorker, 0.05);
  });

  it('uses chance production for salt below and above 400 effective Work Points', () => {
    const rule = RESIDENCES.salt_gatherer.production!;
    const input = { progress: 0, penalty: 0, freeSpace: 100 };
    assert.equal(planProduction(rule, { ...input, workPoints: 200 }, () => 0.49).units, 1);
    assert.equal(planProduction(rule, { ...input, workPoints: 200 }, () => 0.5).units, 0);
    assert.equal(planProduction(rule, { ...input, workPoints: 800 }, () => 0.99).units, 2);
    assert.equal(planProduction(rule, { ...input, workPoints: 200, penalty: 50 }, () => 0.3).units, 0);
  });

  it('supplies wood and iron to a toolmaker through a warehouse', () => {
    const transfers = planTransfers(
      { stock: new Map([['wood', 20], ['iron', 3]]), minimumStock: new Map(), maximumStock: new Map(), capacityM3: 50, workPoints: 1e6 },
      [{ buildingId: 't', type: 'toolmaker', stock: 0, woodStock: 10, ironStock: 1 }],
    );
    assert.deepEqual(
      transfers.map((t) => [t.productId, t.quantity, t.direction]),
      [['wood', 20, 'in'], ['iron', 3, 'in']].map(([p, q, d]) => [p, Math.min(q as number, p === 'wood' ? 20 : 3), d]),
    );
  });

  it('makes sugar using canes, wood, Work Points, and available stock space', () => {
    const rule = RESIDENCES.sugar_mill.production!;
    const input = {
      progress: 0,
      workPoints: 600,
      penalty: 0,
      freeSpace: 200,
      wood: 1,
      batchStock: 6,
    };
    const result = planProduction(rule, input);
    assert.deepEqual(
      [result.units, result.woodUsed, result.batchStockUsed],
      [1, 1, 6],
    );
    assert.equal(
      planProduction(rule, { ...input, batchStock: 5 }).units,
      0,
    );
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
      [3, 3, 40, 200, 400, 5, 12000],
    );
    assert.equal(
      planProduction(rule, { ...input, workPoints: 600, penalty: 50 }).units,
      0,
    );
  });

  it('supplies the sugar mill with cane from a linked warehouse', () => {
    const transfers = planTransfers(
      {
        stock: new Map([['sugarcane', 400]]),
        minimumStock: new Map(),
        maximumStock: new Map(),
        capacityM3: 50,
        workPoints: 1e6,
      },
      [{ buildingId: 'sugar-mill', type: 'sugar_mill', stock: 0, sugarcaneStock: 0 }],
    );
    assert.deepEqual(transfers, [
      { buildingId: 'sugar-mill', productId: 'sugarcane', quantity: 400, direction: 'in' },
    ]);
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
