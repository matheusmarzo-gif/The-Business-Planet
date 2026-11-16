import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BuildingSummaryPanel from './BuildingSummaryPanel.js';
import type { ResidentialBuildingSummary } from '../types/residence.js';

function renderPanel(
  type: ResidentialBuildingSummary['type'],
  status: ResidentialBuildingSummary['status'] = 'completed',
) {
  const building: ResidentialBuildingSummary = {
    dataLevel: 'summary',
    id: 'building-id',
    ownerName: 'Player',
    isOwnedByCurrentUser: false,
    type,
    buildingNumber: 1,
    x: 10,
    y: 20,
    cityId: 'city-id',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: status === 'completed' ? '2026-01-02T00:00:00.000Z' : null,
  };
  return renderToStaticMarkup(
    createElement(BuildingSummaryPanel, {
      building,
      cityName: 'Test City',
      onOpenConsumption: () => undefined,
      onClose: () => undefined,
    }),
  );
}

test('offers on-demand consumption for completed public residences', () => {
  const markup = renderPanel('house_poor1');

  assert.match(markup, /Ver consumo da casa/);
});

test('does not offer consumption for buildings without completed residence data', () => {
  assert.doesNotMatch(renderPanel('house_poor1', 'under_construction'), /Ver consumo da casa/);
  assert.doesNotMatch(renderPanel('shop_alcohol'), /Ver consumo da casa/);
});
