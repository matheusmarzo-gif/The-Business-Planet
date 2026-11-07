import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAutomatableFarmType,
  parseFarmAutomationSettings,
  shouldStartAutomatedCrop,
} from './farming.js';

test('validates and orders farm automation settings', () => {
  assert.deepEqual(
    parseFarmAutomationSettings(
      { enabled: true, plantingMonths: [9, 3], plantingWorkers: 10, harvestWorkers: 4 },
      10,
    ),
    { enabled: true, plantingMonths: [3, 9], plantingWorkers: 10, harvestWorkers: 4 },
  );
});

test('rejects invalid farm automation settings', () => {
  assert.equal(
    parseFarmAutomationSettings(
      { enabled: true, plantingMonths: [], plantingWorkers: 2, harvestWorkers: 2 },
      10,
    ),
    null,
  );
  assert.equal(
    parseFarmAutomationSettings(
      { enabled: true, plantingMonths: [3, 3], plantingWorkers: 2, harvestWorkers: 2 },
      10,
    ),
    null,
  );
  assert.equal(
    parseFarmAutomationSettings(
      { enabled: true, plantingMonths: [13], plantingWorkers: 2, harvestWorkers: 2 },
      10,
    ),
    null,
  );
  assert.equal(
    parseFarmAutomationSettings(
      { enabled: false, plantingMonths: [], plantingWorkers: 11, harvestWorkers: 2 },
      10,
    ),
    null,
  );
});

test('starts automated crops only when idle and in a selected month', () => {
  const settings = {
    enabled: true,
    plantingMonths: [3, 9],
    plantingWorkers: 10,
    harvestWorkers: 4,
  };
  assert.equal(shouldStartAutomatedCrop(settings, null, 3), true);
  assert.equal(shouldStartAutomatedCrop(settings, 'growing', 3), false);
  assert.equal(shouldStartAutomatedCrop(settings, null, 4), false);
  assert.equal(shouldStartAutomatedCrop(settings, null, 13), false);
  assert.equal(shouldStartAutomatedCrop({ ...settings, enabled: false }, null, 3), false);
  assert.equal(isAutomatableFarmType('farm_rice'), true);
  assert.equal(isAutomatableFarmType('farm_cattle'), false);
});
