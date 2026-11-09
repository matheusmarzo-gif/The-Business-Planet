import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTransferToLinkedBuilding,
  getMaxManualTransferQuantity,
  getTransportDemand,
  planWarehouseStockWrites,
  planTransfersDetailed,
  planWarehouseTrades,
  type TradeWarehouse,
  type WarehouseLogistics,
} from './logistics.js';
import { canStoreProduct } from './residence.js';

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

test('silos only hold their configured resources during local transport and warehouse trade', () => {
  const silo: WarehouseLogistics = {
    stock: new Map([['milk', 20]]),
    minimumStock: new Map(),
    maximumStock: new Map(),
    capacityM3: 400,
    workPoints: 10000,
    allowedProductIds: ['wheat', 'barley', 'potato', 'corn', 'rice', 'spices', 'cocoa', 'sugarcane', 'olive', 'grape', 'tobacco_leaf'],
  };
  const localTransfers = planTransfersDetailed(silo, [
    { buildingId: 'dairy-farm', type: 'farm_dairy', stock: 20 },
    { buildingId: 'milk-shop', type: 'shop_milk', stock: 0 },
  ]);
  assert.deepEqual(localTransfers.transfers, []);
  assert.equal(canStoreProduct('silo', 'wheat'), true);
  assert.equal(canStoreProduct('silo', 'milk'), false);
  const allowedLocalTransfer = planTransfersDetailed(
    {
      ...silo,
      stock: new Map([['wheat', 5]]),
    },
    [{
      buildingId: 'flour-mill',
      type: 'flour_mill',
      stock: 0,
      selectedInputProductId: 'wheat',
      inputStocks: { wheat: 0 },
    }],
  );
  assert.deepEqual(allowedLocalTransfer.transfers, [{
    buildingId: 'flour-mill',
    productId: 'wheat',
    quantity: 5,
    direction: 'in',
  }]);

  const siloSeller = createWarehouse('silo', 'player-a', 'sell', 5, 20);
  siloSeller.type = 'silo';
  siloSeller.capacityM3 = 400;
  siloSeller.stock.set('milk', 20);
  siloSeller.settings.set('milk', {
    minimumStock: 0,
    maximumStock: null,
    price: 5,
    mode: 'sell',
  });
  const buyer = createWarehouse('buyer', 'player-b', 'buy', 20, 0);
  buyer.settings.set('milk', {
    minimumStock: 0,
    maximumStock: 100,
    price: 20,
    mode: 'buy',
  });
  assert.deepEqual(planWarehouseTrades([siloSeller, buyer]).map((trade) => trade.productId), ['rice']);
});

test('multiple linked warehouses do not overfill a shop in the same transport run', () => {
  const shop = { buildingId: 'milk-shop', type: 'shop_milk' as const, stock: 0 };
  const warehouse = (stock: number): WarehouseLogistics => ({
    stock: new Map([['milk', stock]]),
    minimumStock: new Map(),
    maximumStock: new Map(),
    capacityM3: 50,
    workPoints: 10000,
  });
  const first = planTransfersDetailed(warehouse(50), [shop]).transfers;
  assert.equal(first[0]?.quantity, 50);
  for (const transfer of first) applyTransferToLinkedBuilding(shop, transfer);

  const second = planTransfersDetailed(warehouse(100), [shop]).transfers;
  assert.equal(second[0]?.quantity, 70);
  for (const transfer of second) applyTransferToLinkedBuilding(shop, transfer);
  assert.equal(shop.stock, 120);
});

test('upgraded stock capacity is used when automatically replenishing a linked shop', () => {
  const transfers = planTransfersDetailed(
    {
      stock: new Map([['milk', 300]]),
      minimumStock: new Map(),
      maximumStock: new Map(),
      capacityM3: 50,
      workPoints: 10000,
    },
    [{
      buildingId: 'milk-shop',
      type: 'shop_milk',
      stock: 0,
      stockLevels: { stock: 2 },
    }],
  ).transfers;

  assert.deepEqual(transfers, [{
    buildingId: 'milk-shop',
    productId: 'milk',
    quantity: 240,
    direction: 'in',
  }]);
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
