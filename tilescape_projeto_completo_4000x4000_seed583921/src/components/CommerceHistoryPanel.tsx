import { formatMoney } from '../types/wallet';

export interface CommerceDay {
  day: string;
  employeeExpense: number;
  productExpense: number;
  unitsSold: number;
  salePrice: number;
  revenue: number;
  profitLoss: number;
}

interface CommerceHistoryPanelProps {
  title: string;
  days: CommerceDay[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

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
          </div>
        ))}
      </div>
    </section>
  );
}
