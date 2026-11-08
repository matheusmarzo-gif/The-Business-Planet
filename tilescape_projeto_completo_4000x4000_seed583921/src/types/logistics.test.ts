import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMaxManualTransferQuantity,
  getTransportDemand,
  planWarehouseStockWrites,
  planWarehouseTrades,
  type TradeWarehouse,
} from './logistics.js';

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

test('manual transfer limit respects reserved source stock, destination capacity, and transport work points', () => {
  assert.equal(getTransportDemand('rice', 1), 2);
  assert.equal(
    getMaxManualTransferQuantity({
      productId: 'rice',
      sourceStock: 20,
      sourceMinimumStock: 5,
      destinationFreeCapacity: 8,
      availableWorkPoints: 10,
    }),
    5,
  );
  assert.equal(
    getMaxManualTransferQuantity({
      productId: 'rice',
      sourceStock: 20,
      sourceMinimumStock: 20,
      destinationFreeCapacity: 8,
      availableWorkPoints: 100,
    }),
    0,
  );
  assert.equal(
    getMaxManualTransferQuantity({
      productId: 'unknown',
      sourceStock: 20,
      sourceMinimumStock: 0,
      destinationFreeCapacity: 20,
      availableWorkPoints: 100,
    }),
    0,
  );
});

test('plans negative warehouse stock deltas as updates, never inserts', () => {
  const writes = planWarehouseStockWrites(
    [
      { warehouseId: 'warehouse-a', productId: 'milk', quantity: -21 },
      { warehouseId: 'warehouse-a', productId: 'potato', quantity: 5 },
    ],
    new Map([['warehouse-a', new Set(['milk'])]]),
  );
  assert.deepEqual(writes, {
    updates: [{ warehouseId: 'warehouse-a', productId: 'milk', quantity: -21 }],
    inserts: [{ warehouseId: 'warehouse-a', productId: 'potato', quantity: 5 }],
  });
  assert.throws(
    () =>
      planWarehouseStockWrites(
        [{ warehouseId: 'warehouse-a', productId: 'milk', quantity: -21 }],
        new Map([['warehouse-a', new Set<string>()]]),
      ),
    /sem uma linha de estoque existente/,
  );
});
