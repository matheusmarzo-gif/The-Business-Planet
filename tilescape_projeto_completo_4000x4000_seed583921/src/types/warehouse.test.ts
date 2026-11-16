import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WAREHOUSE_AUTOMATION_SETTINGS,
  parseWarehouseAutomationSettings,
  supportsWarehouseSupplier,
} from './warehouse.js';

test('warehouse automation settings require explicit boolean options', () => {
  assert.deepEqual(
    parseWarehouseAutomationSettings({ collectorActive: true, supplierActive: false }),
    { collectorActive: true, supplierActive: false },
  );
  assert.deepEqual(DEFAULT_WAREHOUSE_AUTOMATION_SETTINGS, {
    collectorActive: false,
    supplierActive: false,
  });
  assert.equal(parseWarehouseAutomationSettings({ collectorActive: true }), null);
  assert.equal(parseWarehouseAutomationSettings({ collectorActive: 1, supplierActive: false }), null);
  assert.equal(parseWarehouseAutomationSettings(null), null);
});

test('active suppliers are supported by warehouses and silos only', () => {
  assert.equal(supportsWarehouseSupplier('warehouse'), true);
  assert.equal(supportsWarehouseSupplier('silo'), true);
  assert.equal(supportsWarehouseSupplier('farm_wheat'), false);
});
