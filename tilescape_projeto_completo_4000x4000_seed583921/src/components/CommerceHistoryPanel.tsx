import { formatMoney } from '../types/wallet';
import type { ShopResidenceTransaction } from '../types/commerce';

export interface CommerceDay {
  day: string;
  employeeExpense: number;
  productExpense: number;
  unitsSold: number;
  salePrice: number;
  revenue: number;
  profitLoss: number;
  transactions: ShopResidenceTransaction[] | null;
}

interface CommerceHistoryPanelProps {
  title: string;
  days: CommerceDay[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const benefitFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const outcomeText = {
  purchased: 'Comprou',
  negative_benefit: 'Benefício negativo; não comprou',
  no_stock: 'Sem estoque',
  no_capacity: 'Sem capacidade',
  no_stock_or_capacity: 'Sem estoque e capacidade',
  demand_fulfilled: 'Demanda já atendida',
} as const;

export default function CommerceHistoryPanel({
  title,
  days,
  isLoading,
  error,
  onClose,
}: CommerceHistoryPanelProps) {
  return (
    <section className="warehouse-panel commerce-history-panel" aria-label="Histórico do comércio">
      <div className="panel-title">
        <div className="eyebrow">COMÉRCIO</div>
        <h1>{title}</h1>
        <button type="button" className="panel-close" aria-label="Fechar histórico" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Últimos 30 dias. Gastos com produtos consideram apenas pagamentos realizados; reposição interna pelo
        armazém do mesmo dono não gera cobrança.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        <div className="commerce-history-row warehouse-head">
          <span>Dia</span>
          <span>Funcionários</span>
          <span>Produtos</span>
          <span>Unidades</span>
          <span>Preço/un.</span>
          <span>Receita</span>
          <span>Lucro/prejuízo</span>
          <span>Cálculo da demanda</span>
        </div>
        {!isLoading && days.length === 0 && (
          <p className="warehouse-summary">Ainda sem registros diários do comércio.</p>
        )}
        {days.map((item) => (
          <div className="commerce-history-row" key={item.day}>
            <span>{formatDay(item.day)}</span>
            <span>{formatMoney(item.employeeExpense)}</span>
            <span>{formatMoney(item.productExpense)}</span>
            <span>{integer.format(item.unitsSold)}</span>
            <span>{formatMoney(item.salePrice)}</span>
            <span>{formatMoney(item.revenue)}</span>
            <span className={item.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
              {formatMoney(item.profitLoss)}
            </span>
            <details className="commerce-transaction-details">
              <summary>
                {item.transactions === null ? 'Ver cálculo' : `Ver cálculo (${item.transactions.length})`}
              </summary>
              {item.transactions === null ? (
                <p>Diagnóstico indisponível para esta data; será gravado nos próximos dias.</p>
              ) : item.transactions.length === 0 ? (
                <p>Sem residências no raio de compra nesta data.</p>
              ) : (
                item.transactions.map((transaction) => (
                  <section key={transaction.residenceId}>
                    <strong>
                      Residência {transaction.residenceId.slice(0, 8)} · {integer.format(transaction.occupants)} moradores ·
                      renda média {formatMoney(transaction.averageIncome)} · preço efetivo da área{' '}
                      {formatMoney(transaction.areaAveragePrice)} · demanda esperada{' '}
                      {decimal.format(transaction.expectedDemand)} · alvo após arredondamento{' '}
                      {integer.format(transaction.desiredQuantity)}
                    </strong>
                    <p className="commerce-candidate-list">
                      Loja classificada #{transaction.candidate.rank} · preço C$ {transaction.candidate.price} ·
                      distância {decimal.format(transaction.candidate.distance)} tiles · benefício{' '}
                      {benefitFormat.format(transaction.candidate.benefit)} · demanda desta loja{' '}
                      {decimal.format(transaction.candidate.desiredQuantity)} · estoque disponível{' '}
                      {integer.format(transaction.candidate.stockAvailable)} · capacidade disponível{' '}
                      {integer.format(transaction.candidate.capacityAvailable)} · disponível efetivo{' '}
                      {integer.format(transaction.candidate.available)} · demanda antes{' '}
                      {integer.format(transaction.candidate.demandBefore)} · comprado{' '}
                      {integer.format(transaction.candidate.purchased)} · demanda restante{' '}
                      {integer.format(transaction.candidate.demandAfter)} · {outcomeText[transaction.candidate.outcome]}
                    </p>
                  </section>
                ))
              )}
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}
