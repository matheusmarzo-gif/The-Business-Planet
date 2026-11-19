import assert from 'node:assert/strict';
import test from 'node:test';
import { getTechniqueAdjustedWage, getWorkersForWorkPoints } from './employment.js';
import { getWorkerTechnique } from './wellbeing.js';

test('calculates the workforce needed for a daily Work Points target', () => {
  assert.equal(getWorkersForWorkPoints(1000, 8, 15, 30), 7);
  assert.equal(getWorkersForWorkPoints(1000, 8, 15, 5), 5);
  assert.equal(getWorkersForWorkPoints(0, 8, 15, 30), 0);
});

test('converts city wellbeing into a minimum-technique wage fallback', () => {
  const technique = getWorkerTechnique(0);
  assert.equal(technique, 10);
  assert.equal(getTechniqueAdjustedWage(1.5, technique, 1), 15);
  assert.equal(getTechniqueAdjustedWage(0.5, technique, 8), 8);
});
