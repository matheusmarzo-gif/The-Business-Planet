import assert from 'node:assert/strict';
import test from 'node:test';
import { planWarehouseTrades, type TradeWarehouse } from './logistics.js';

function createWarehouse(
  id: string,
  ownerId: string,
  mode: 'buy' | 'sell',
  price: number,
  stock: number,
): TradeWarehouse {
  return {
    id,
    ownerId,
    type: 'warehouse',
    x: 100,
    y: 100,
    capacityM3: 50,
    workPoints: 100000,
    stock: new Map([['rice', stock]]),
    settings: new Map([
      ['rice', { minimumStock: 0, maximumStock: mode === 'buy' ? 10 : null, price, mode }],
    ]),
  };
}

test('manual warehouse supplier search plans trades only for the requested buyer', () => {
  const seller = createWarehouse('seller', 'player-a', 'sell', 5, 10);
  const requestedBuyer = createWarehouse('requested-buyer', 'player-b', 'buy', 20, 0);
  const otherBuyer = createWarehouse('other-buyer', 'player-c', 'buy', 20, 0);

  const trades = planWarehouseTrades([seller, requestedBuyer, otherBuyer], requestedBuyer.id);

  assert.equal(trades.length, 1);
  assert.equal(trades[0].buyerId, requestedBuyer.id);
  assert.equal(trades[0].sellerId, seller.id);
});
