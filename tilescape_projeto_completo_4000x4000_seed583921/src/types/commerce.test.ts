import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SHOP_PRICE, getInitialShopPrice } from './commerce.js';

test('prefers the owner average when initializing a shop price', () => {
  assert.equal(getInitialShopPrice(27.456, 13), 27.46);
});

test('uses the city average when the owner has no similar shop', () => {
  assert.equal(getInitialShopPrice(null, 13.456), 13.46);
});

test('uses the default when no completed similar shop exists', () => {
  assert.equal(getInitialShopPrice(null, null), DEFAULT_SHOP_PRICE);
});
