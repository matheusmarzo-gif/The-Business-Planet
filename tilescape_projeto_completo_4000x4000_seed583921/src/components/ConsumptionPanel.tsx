import { PRODUCTS } from '../types/product';
import { formatMoney } from '../types/wallet';

export interface ProductConsumption {
  productId: string;
  lastDayPerPerson: number;
  monthPerPerson: number;
  lastDayAveragePrice: number | null;
  monthAveragePrice: number | null;
}

// Produtos consumidos pelas residências; por enquanto apenas arroz.
export const CONSUMED_PRODUCT_IDS = ['rice'];

interface ConsumptionPanelProps {
  consumption: Map<string, ProductConsumption>;
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const price = (value: number | null) => (value === null ? '—' : formatMoney(value));

export default function ConsumptionPanel({ consumption, isLoading, error, onClose }: ConsumptionPanelProps) {
  return (
    <section className="warehouse-panel" aria-label="Consumo da residência">
      <div className="panel-title">
        <div className="eyebrow">RESIDÊNCIA</div>
        <h1>Consumo da casa</h1>
        <button type="button" className="panel-close" aria-label="Fechar consumo" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Consumo por pessoa por dia. A média do último mês considera os últimos 30 dias de jogo.
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
            <div className="consumption-row" key={productId}>
              <span className="warehouse-product">
                {product && <img src={product.icon} alt="" />}
                {product?.name ?? productId}
              </span>
              <span>{decimal.format(data?.lastDayPerPerson ?? 0)}</span>
              <span>{decimal.format(data?.monthPerPerson ?? 0)}</span>
              <span>{price(data?.lastDayAveragePrice ?? null)}</span>
              <span>{price(data?.monthAveragePrice ?? null)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
