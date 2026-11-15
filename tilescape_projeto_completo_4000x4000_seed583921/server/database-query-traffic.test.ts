import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateDatabaseResponseBytes,
  identifyDatabaseQuery,
} from './database-query-traffic.js';

test('database query identity is stable across whitespace and literal values', () => {
  const first = identifyDatabaseQuery("SELECT * FROM users WHERE id = 12 AND name = 'Ana'");
  const second = identifyDatabaseQuery("SELECT  *  FROM users WHERE id = 99 AND name = 'Bruno'");

  assert.equal(first.id, second.id);
  assert.equal(first.statement, "SELECT * FROM users WHERE id = ? AND name = '?'");
});

test('database response size estimates UTF-8 JSON row payloads', () => {
  const rows = [{ name: 'ação' }, { name: 'cidade' }];
  const expected = Buffer.byteLength(JSON.stringify(rows), 'utf8');

  assert.equal(estimateDatabaseResponseBytes(rows), expected);
  assert.equal(estimateDatabaseResponseBytes([]), 2);
});
