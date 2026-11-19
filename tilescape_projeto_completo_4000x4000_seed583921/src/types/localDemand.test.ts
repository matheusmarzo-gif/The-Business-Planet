import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateLocalDemandSummary } from './localDemand.js';

describe('local demand', () => {
  it('scales monthly per-person demand and realized purchases by current local employment', () => {
    const summary = calculateLocalDemandSummary(
      [
        { id: 'home-a', occupants: 10, employed: 4, wageTotal: 40 },
        { id: 'home-b', occupants: 20, employed: 2, wageTotal: 30 },
      ],
      [
        {
          residenceId: 'home-a',
          productId: 'rice',
          monthQuantity: 30,
          monthSpent: 90,
          monthConsumedQuantity: 36,
          monthConsumerDays: 12,
          monthDesiredQuantity: 60,
          monthDesiredConsumerDays: 12,
        },
        {
          residenceId: 'home-b',
          productId: 'rice',
          monthQuantity: 20,
          monthSpent: 100,
          monthConsumedQuantity: 6,
          monthConsumerDays: 6,
          monthDesiredQuantity: 18,
          monthDesiredConsumerDays: 6,
        },
      ],
      7,
    );

    assert.equal(summary.population, 30);
    assert.equal(summary.employedResidents, 6);
    assert.equal(summary.openJobOffers, 7);
    assert.equal(summary.averageWage, 70 / 6);
    assert.deepEqual(summary.products[0], {
      productId: 'rice',
      demandTotal: 26,
      offerTotal: 14,
      weightedPrice: 190 / 50,
    });
    assert.deepEqual(summary.products.map((product) => product.productId), [
      'rice', 'wheat', 'barley', 'corn', 'potato', 'fish', 'red_meat', 'milk',
      'sugar', 'vegetables', 'salt', 'spices', 'bread', 'cheese', 'fruit', 'chocolate',
      'olive_oil', 'tobacco', 'alcohol', 'wine', 'clothing', 'furniture', 'utilities',
      'glass', 'tincture', 'carpet', 'porcelain', 'artwork', 'jewelry', 'rarities',
    ]);
  });

  it('returns zero demand and offer without consumer history and no price without sales', () => {
    const summary = calculateLocalDemandSummary(
      [{ id: 'home', occupants: 1, employed: 1, wageTotal: 0 }],
      [],
      0,
    );

    assert.deepEqual(summary.products[0], {
      productId: 'rice',
      demandTotal: 0,
      offerTotal: 0,
      weightedPrice: null,
    });
  });
});
