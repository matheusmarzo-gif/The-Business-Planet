import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CommerceDiagnosticsUpdate, ShopResidenceTransaction } from '../types/commerce';
import { loadCommerceDiagnostics, saveCommerceDiagnostics } from './commerceDiagnosticsStorage';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function update(day: string, buildingId = 'shop-a'): CommerceDiagnosticsUpdate {
  const transaction: ShopResidenceTransaction = {
    residenceId: 'home-a',
    occupants: 4,
    averageIncome: 10,
    areaAveragePrice: 9,
    expectedDemand: 0.12,
    desiredQuantity: 0,
    candidate: {
      shopId: buildingId,
      price: 9,
      distance: 0,
      desiredQuantity: 0,
      benefit: 1,
      rank: 1,
      stockAvailable: 4,
      capacityAvailable: 4,
      available: 4,
      demandBefore: 0,
      purchased: 0,
      demandAfter: 0,
      outcome: 'demand_fulfilled',
    },
  };
  return {
    type: 'commerce_diagnostics',
    buildingId,
    day,
    transactions: [transaction],
  };
}

describe('commerce diagnostics browser storage', () => {
  it('stores diagnostics per account and shop, without mixing users', () => {
    const storage = createStorage();
    saveCommerceDiagnostics(storage, 'owner@example.com', update('1100-01-01'));
    saveCommerceDiagnostics(storage, 'owner@example.com', update('1100-01-02', 'shop-b'));
    saveCommerceDiagnostics(storage, 'another@example.com', update('1100-01-02'));

    assert.deepEqual(
      loadCommerceDiagnostics(storage, 'owner@example.com', 'shop-a').get('1100-01-01'),
      update('1100-01-01').transactions,
    );
    assert.equal(loadCommerceDiagnostics(storage, 'owner@example.com', 'shop-a').has('1100-01-02'), false);
    assert.deepEqual(
      loadCommerceDiagnostics(storage, 'owner@example.com', 'shop-b').get('1100-01-02'),
      update('1100-01-02', 'shop-b').transactions,
    );
  });

  it('keeps only the latest 30 days for each shop', () => {
    const storage = createStorage();
    for (let day = 1; day <= 31; day += 1) {
      saveCommerceDiagnostics(storage, 'owner@example.com', update(`1100-01-${String(day).padStart(2, '0')}`));
    }

    const saved = loadCommerceDiagnostics(storage, 'owner@example.com', 'shop-a');
    assert.equal(saved.size, 30);
    assert.equal(saved.has('1100-01-01'), false);
    assert.equal(saved.has('1100-01-31'), true);
  });

  it('reports corrupt local records instead of silently ignoring them', () => {
    const storage = createStorage();
    storage.setItem('valdora:commerce-demand:owner%40example.com:shop-a', '{"1100-01-01":[{}]}');

    assert.throws(
      () => loadCommerceDiagnostics(storage, 'owner@example.com', 'shop-a'),
      /cálculo da demanda salvo neste navegador está inválido/i,
    );
  });
});
