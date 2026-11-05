import assert from 'node:assert/strict';
import test from 'node:test';
import { canStartResidenceConstruction } from './residence.js';

test('allows a new player to request their first warehouse', () => {
  assert.equal(canStartResidenceConstruction('warehouse', false), true);
});

test('still requires master access for other constructions without material inventory', () => {
  assert.equal(canStartResidenceConstruction('house_poor1', false), false);
  assert.equal(canStartResidenceConstruction('warehouse', true), true);
  assert.equal(canStartResidenceConstruction('house_poor1', true), true);
});
