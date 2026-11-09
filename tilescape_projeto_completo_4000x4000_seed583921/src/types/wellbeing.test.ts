import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateResidenceWellbeing,
  getWorkerTechnique,
  MAX_RESIDENCE_WELLBEING,
} from './wellbeing.js';

const dailyNeeds = new Map([
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

test('scores consumption proportionally, capped at each product need', () => {
  const score = calculateResidenceWellbeing(
    [
      { productId: 'rice', quantity: 0.015, consumerDays: 1 },
      { productId: 'sugar', quantity: 0.02, consumerDays: 1 },
      { productId: 'bread', quantity: 0.5, consumerDays: 1 },
      { productId: 'clothing', quantity: 0.01, consumerDays: 1 },
    ],
    dailyNeeds,
  );
  assert.equal(score, 6.25 + 6.25 + 1.5 + 6.25);
});

test('scores the maximum of 162 and does not award points without consumers', () => {
  const completeConsumption = [...dailyNeeds].map(([productId, quantity]) => ({
    productId,
    quantity,
    consumerDays: 1,
  }));
  assert.equal(MAX_RESIDENCE_WELLBEING, 162);
  assert.equal(calculateResidenceWellbeing(completeConsumption, dailyNeeds), 162);
  assert.equal(
    calculateResidenceWellbeing(
      [{ productId: 'rice', quantity: 1, consumerDays: 0 }],
      dailyNeeds,
    ),
    0,
  );
});

test('maps residence wellbeing to worker technique across every formula boundary', () => {
  assert.equal(getWorkerTechnique(0), 10);
  assert.equal(getWorkerTechnique(100), 15);
  assert.equal(getWorkerTechnique(125), 20);
  assert.equal(getWorkerTechnique(150), 30);
  assert.equal(getWorkerTechnique(162), 40);
  assert.equal(getWorkerTechnique(-1), 10);
  assert.equal(getWorkerTechnique(200), 40);
});
