import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LocalDemandPanel from './LocalDemandPanel.js';
import { calculateLocalDemandSummary } from '../types/localDemand.js';

test('shows local indicators and baskets in consumption order', () => {
  const summary = calculateLocalDemandSummary(
    [{ id: 'home', occupants: 12, employed: 5, wageTotal: 50 }],
    [],
    3,
  );
  const markup = renderToStaticMarkup(
    createElement(LocalDemandPanel, {
      summary,
      isLoading: false,
      error: '',
      onClose: () => undefined,
    }),
  );

  assert.match(markup, /Moradores no raio/);
  assert.match(markup, /Moradores empregados/);
  assert.match(markup, /Vagas de emprego/);
  assert.match(markup, /Salário médio diário/);
  const basketNames = [
    'Cesta básica',
    'Cesta intermediária',
    'Cesta avançada',
    'Cesta nobre',
    'Cesta básica de bens',
    'Cesta intermediária de bens',
    'Cesta avançada de bens',
    'Cesta nobre de bens',
  ];
  const basketPositions = basketNames.map((name) => markup.indexOf(name));
  assert.ok(basketPositions.every((position) => position >= 0));
  assert.deepEqual(basketPositions, [...basketPositions].sort((a, b) => a - b));
  assert.match(markup, /Demanda total/);
  assert.match(markup, /Oferta total/);
  assert.match(markup, /Preço ponderado/);
});
