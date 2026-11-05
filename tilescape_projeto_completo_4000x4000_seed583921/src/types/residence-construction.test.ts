import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlayerBuildableConstructionType, RESIDENCES } from './residence.js';

test('allows authenticated players to build every catalog construction', () => {
  for (const type of Object.keys(RESIDENCES)) {
    assert.equal(isPlayerBuildableConstructionType(type), true, type);
  }
});

test('rejects construction types outside the catalog', () => {
  assert.equal(isPlayerBuildableConstructionType('prefeitura'), false);
  assert.equal(isPlayerBuildableConstructionType('__proto__'), false);
  assert.equal(isPlayerBuildableConstructionType(null), false);
});
