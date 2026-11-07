import { Fragment } from 'react';
import { PRODUCTS } from '../types/product';
import { formatMoney } from '../types/wallet';
import {
  BASIC_BASKET_PRODUCT_IDS,
  CONSUMPTION_PRODUCT_IDS,
  ADVANCED_BASKET_PRODUCT_IDS,
  INTERMEDIATE_BASKET_PRODUCT_IDS,
} from '../types/commerceDemand';

export interface ProductConsumption {
  productId: string;
  lastDayPerPerson: number;
  monthPerPerson: number;
  lastDayAveragePrice: number | null;
  monthAveragePrice: number | null;
}

export const CONSUMED_PRODUCT_IDS = CONSUMPTION_PRODUCT_IDS;

interface ConsumptionPanelProps {
  consumption: Map<string, ProductConsumption>;
  isLoading: boolean;
  error: string;
  scope?: 'RESIDÊNCIA' | 'CIDADE';
  title?: string;
  onClose: () => void;
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const price = (value: number | null) => (value === null ? '—' : formatMoney(value));

export default function ConsumptionPanel({
  consumption,
  isLoading,
  error,
  scope = 'RESIDÊNCIA',
  title = 'Consumo da casa',
  onClose,
}: ConsumptionPanelProps) {
  return (
    <section className="warehouse-panel" aria-label={`Consumo ${scope.toLocaleLowerCase('pt-BR')}`}>
      <div className="panel-title">
        <div className="eyebrow">{scope}</div>
        <h1>{title}</h1>
        <button type="button" className="panel-close" aria-label="Fechar consumo" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Consumo médio por pessoa por dia. A média considera os últimos 30 dias de jogo.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        <div className="consumption-row warehouse-head">
          <span>Produto</span>
          <span>Último dia</span>
          <span>Média no mês</span>
          <span>Preço médio (dia)</span>
          <span>Preço médio (mês)</span>
        </div>
        {CONSUMED_PRODUCT_IDS.map((productId) => {
          const product = PRODUCTS.find((item) => item.id === productId);
          const data = consumption.get(productId);
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
              <div className="consumption-row">
                <span className="warehouse-product">
                  {product && <img src={product.icon} alt="" />}
                  {product?.name ?? productId}
                </span>
                <span>{decimal.format(data?.lastDayPerPerson ?? 0)}</span>
                <span>{decimal.format(data?.monthPerPerson ?? 0)}</span>
                <span>{price(data?.lastDayAveragePrice ?? null)}</span>
                <span>{price(data?.monthAveragePrice ?? null)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
