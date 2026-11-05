export interface ProductionDay {
  day: string;
  workPoints: number;
  produced: number;
  transported: number;
  efficiency: number;
}

interface ProductionHistoryPanelProps {
  title: string;
  days: ProductionDay[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export default function ProductionHistoryPanel({ title, days, isLoading, error, onClose }: ProductionHistoryPanelProps) {
  return (
    <section className="warehouse-panel" aria-label="Histórico de produção">
      <div className="panel-title">
        <div className="eyebrow">HISTÓRICO</div>
        <h1>{title}</h1>
        <button type="button" className="panel-close" aria-label="Fechar histórico" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Últimos 30 dias de jogo. A eficiência considera a penalidade por falta de Ferramentas ou de Work Points.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        <div className="history-row warehouse-head">
          <span>Dia</span>
          <span>Work Points</span>
          <span>Produzidas</span>
          <span>No armazém</span>
          <span>Eficiência</span>
        </div>
        {!isLoading && days.length === 0 && <p className="warehouse-summary">Ainda sem registros de produção.</p>}
        {days.map((item) => (
          <div className="history-row" key={item.day}>
            <span>{formatDay(item.day)}</span>
            <span>{integer.format(item.workPoints)}</span>
            <span>{integer.format(item.produced)}</span>
            <span>{integer.format(item.transported)}</span>
            <span>{integer.format(item.efficiency)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
