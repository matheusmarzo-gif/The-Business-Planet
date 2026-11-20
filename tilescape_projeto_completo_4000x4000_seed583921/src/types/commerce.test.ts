import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SHOP_PRICE,
  getInitialShopPrice,
  getPurchaseBenefitCalculation,
} from './commerce.js';
import {
  CONSUMPTION_PRODUCT_IDS,
  GOODS_BASKET_PRODUCT_IDS,
  NOBLE_BASKET_PRODUCT_IDS,
} from './commerceDemand.js';

test('prefers the owner average when initializing a shop price', () => {
  assert.equal(getInitialShopPrice(27.456, 13), 27.46);
});

test('uses the city average when the owner has no similar shop', () => {
  assert.equal(getInitialShopPrice(null, 13.456), 13.46);
});

test('uses the default when no completed similar shop exists', () => {
  assert.equal(getInitialShopPrice(null, null), DEFAULT_SHOP_PRICE);
});

test('uses the cumulative basket order and updated benefit constants', () => {
  const income = 100;
  const price = 1;
  const need = 0.05;
  const referenceBasketCost = 10;
  const costs = {
    intermediateBasketCost: 2,
    advancedBasketCost: 8,
    goodsBasketCost: 4,
    nobleBasketCost: 32,
    goodsIntermediateBasketCost: 16,
    goodsAdvancedBasketCost: 64,
    goodsNobleBasketCost: 128,
  };
  const scenarios = [
    {
      basketType: 'basic' as const,
      total: 10,
      wExponent: 4,
      idealBase: (income - 1 / 8) / 10,
      idealExponent: 4,
      associatedExponent: 4,
    },
    {
      basketType: 'intermediate' as const,
      total: 12,
      wExponent: 3,
      idealBase: (income - 1 / 6) / 12 - 1 / 180,
      idealExponent: 3,
      associatedExponent: 4,
    },
    {
      basketType: 'goods' as const,
      total: 16,
      wExponent: 3,
      idealBase: income / 16 - 1 / (6 * 16) + 1 / 17,
      idealExponent: 3,
      associatedExponent: 6,
    },
    {
      basketType: 'advanced' as const,
      total: 24,
      wExponent: 2,
      idealBase: (income - 1 / 6) / 24 + 1 / 17,
      idealExponent: 2,
      associatedExponent: 4,
    },
    {
      basketType: 'goodsIntermediate' as const,
      total: 40,
      wExponent: 2,
      idealBase: income / 40 - 1 / (6 * 40) + 1 / 20,
      idealExponent: 2,
      associatedExponent: 8,
    },
    {
      basketType: 'noble' as const,
      total: 72,
      wExponent: 2,
      idealBase: (income - 3) / 72,
      idealExponent: 2,
      associatedExponent: 4,
    },
    {
      basketType: 'goodsAdvanced' as const,
      total: 136,
      wExponent: 2,
      idealBase: income / 136 - 1 / (6 * 136) + 1 / 100,
      idealExponent: 2,
      associatedExponent: 5,
    },
    {
      basketType: 'goodsNoble' as const,
      total: 264,
      wExponent: 2,
      idealBase: income / 264 - 1 / (6 * 264) - 1 / 9,
      idealExponent: 2,
      associatedExponent: 3,
    },
  ];

  for (const scenario of scenarios) {
    const calculation = getPurchaseBenefitCalculation(
      income,
      price,
      need,
      referenceBasketCost,
      0,
      { basketType: scenario.basketType, ...costs },
    );
    assert.ok(
      Math.abs(calculation.w - (1 - (price * need) / scenario.total) ** scenario.wExponent) <
        1e-12,
      scenario.basketType,
    );
    assert.ok(
      Math.abs(
        calculation.idealBenefit -
          Math.abs(scenario.idealBase) ** scenario.idealExponent,
      ) < 1e-12,
      scenario.basketType,
    );
    assert.ok(
      Math.abs(
        calculation.associatedBenefit -
          (calculation.errorBenefit / calculation.idealBenefit) **
            scenario.associatedExponent,
      ) < 1e-8,
      scenario.basketType,
    );
  }
});

test('orders the noble basket before the basic goods basket in consumption lists', () => {
  assert.ok(
    CONSUMPTION_PRODUCT_IDS.indexOf(NOBLE_BASKET_PRODUCT_IDS[0]) <
      CONSUMPTION_PRODUCT_IDS.indexOf(GOODS_BASKET_PRODUCT_IDS[0]),
  );
});
