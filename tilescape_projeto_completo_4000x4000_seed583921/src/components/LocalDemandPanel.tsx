import { Fragment } from 'react';
import { CONSUMPTION_PRODUCT_IDS } from '../types/commerceDemand';
import { PRODUCTS } from '../types/product';
import type { LocalDemandSummary } from '../types/localDemand';
import { formatMoney } from '../types/wallet';
import {
  ADVANCED_BASKET_PRODUCT_IDS,
  ADVANCED_GOODS_BASKET_PRODUCT_IDS,
  BASIC_BASKET_PRODUCT_IDS,
  GOODS_BASKET_PRODUCT_IDS,
  INTERMEDIATE_BASKET_PRODUCT_IDS,
  INTERMEDIATE_GOODS_BASKET_PRODUCT_IDS,
  NOBLE_BASKET_PRODUCT_IDS,
  NOBLE_GOODS_BASKET_PRODUCT_IDS,
} from '../types/commerceDemand';

interface LocalDemandPanelProps {
  summary: LocalDemandSummary | null;
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const money = (value: number | null) => value === null ? '—' : formatMoney(value);

export default function LocalDemandPanel({
  summary,
  isLoading,
  error,
  onClose,
}: LocalDemandPanelProps) {
  const products = new Map(summary?.products.map((item) => [item.productId, item]) ?? []);
  const stats = [
    { label: 'Moradores no raio', value: summary ? quantity.format(summary.population) : '—' },
    { label: 'Moradores empregados', value: summary ? quantity.format(summary.employedResidents) : '—' },
    { label: 'Vagas de emprego', value: summary ? quantity.format(summary.openJobOffers) : '—' },
    { label: 'Salário médio diário', value: summary ? money(summary.averageWage) : '—' },
  ];

  return (
    <section className="warehouse-panel local-demand-panel" aria-label="Demanda local">
      <div className="panel-title">
        <div className="eyebrow">RAIO DE 60 TILES</div>
        <h1>Demanda Local</h1>
        <button type="button" className="panel-close" aria-label="Fechar demanda local" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="accounting-summary-grid local-demand-stats">
        {stats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>
      <p className="warehouse-summary">
        Demanda e oferta são médias diárias dos últimos 30 dias, ponderadas pelos
        empregados atuais das residências próximas. A demanda usa a quantidade
        desejada; a oferta usa a quantidade efetivamente comprada.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list local-demand-list">
        <div className="local-demand-row warehouse-head">
          <span>Produto</span>
          <span>Demanda total</span>
          <span>Oferta total</span>
          <span>Preço ponderado</span>
        </div>
        {CONSUMPTION_PRODUCT_IDS.map((productId) => {
          const product = PRODUCTS.find((item) => item.id === productId);
          const data = products.get(productId);
          return (
            <Fragment key={productId}>
              {productId === BASIC_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta básica</div>
              )}
              {productId === INTERMEDIATE_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta intermediária</div>
              )}
              {productId === ADVANCED_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta avançada</div>
              )}
              {productId === NOBLE_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta nobre</div>
              )}
              {productId === GOODS_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta básica de bens</div>
              )}
              {productId === INTERMEDIATE_GOODS_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta intermediária de bens</div>
              )}
              {productId === ADVANCED_GOODS_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta avançada de bens</div>
              )}
              {productId === NOBLE_GOODS_BASKET_PRODUCT_IDS[0] && (
                <div className="consumption-basket-group">Cesta nobre de bens</div>
              )}
              <div className="local-demand-row">
                <span className="warehouse-product">
                  {product && <img src={product.icon} alt="" />}
                  {product?.name ?? productId}
                </span>
                <span>{summary ? quantity.format(data?.demandTotal ?? 0) : '—'}</span>
                <span>{summary ? quantity.format(data?.offerTotal ?? 0) : '—'}</span>
                <span>{money(data?.weightedPrice ?? null)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
