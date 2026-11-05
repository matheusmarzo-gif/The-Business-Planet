import { PRODUCTS } from '../types/product';
import { RESIDENCES, type ResidenceType } from '../types/residence';

export interface WarehouseLogEvent {
  day: string;
  buildingType: string;
  productId: string;
  direction: 'in' | 'out';
  wanted: number;
  moved: number;
  reason: string | null;
}

export interface WarehouseLogDay {
  day: string;
  workPoints: number;
}

interface WarehouseLogPanelProps {
  days: WarehouseLogDay[];
  events: WarehouseLogEvent[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const REASONS: Record<string, string> = {
  desired_reached: 'Estoque desejado do armazém atingido',
  no_space: 'Sem espaço livre no armazém (m³)',
  no_work_points: 'Work Points de transporte insuficientes',
  warehouse_empty: 'Armazém sem estoque do produto',
};

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export default function WarehouseLogPanel({ days, events, isLoading, error, onClose }: WarehouseLogPanelProps) {
  const pointsByDay = new Map(days.map((item) => [item.day, item.workPoints]));
  const eventDays = [...new Set([...days.map((item) => item.day), ...events.map((item) => item.day)])].sort().reverse();

  return (
    <section className="warehouse-panel" aria-label="Histórico do armazém">
      <div className="panel-title">
        <div className="eyebrow">ARMAZÉM</div>
        <h1>Histórico do armazém</h1>
        <button type="button" className="panel-close" aria-label="Fechar histórico" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Work Points gerados e cada transporte tentado nos últimos dias, com o motivo de não ter transportado tudo.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        {!isLoading && eventDays.length === 0 && (
          <p className="warehouse-summary">Ainda sem registros. O primeiro aparece na próxima meia-noite do jogo.</p>
        )}
        {eventDays.map((day) => (
          <div key={day} className="log-day">
            <h2 className="master-heading">
              {formatDay(day)} · Work Points gerados: {integer.format(pointsByDay.get(day) ?? 0)}
            </h2>
            {events
              .filter((item) => item.day === day)
              .map((item, index) => {
                const product = PRODUCTS.find((entry) => entry.id === item.productId);
                const building = RESIDENCES[item.buildingType as ResidenceType]?.name ?? item.buildingType;
                return (
                  <div className="log-row" key={`${day}-${index}`}>
                    <span>
                      {item.direction === 'out' ? `${building} → Armazém` : `Armazém → ${building}`}
                    </span>
                    <span>{product?.name ?? item.productId}</span>
                    <span>
                      {integer.format(item.moved)} de {integer.format(item.wanted)}
                    </span>
                    <span>{item.reason ? REASONS[item.reason] ?? item.reason : 'Concluído'}</span>
                  </div>
                );
              })}
            {!events.some((item) => item.day === day) && (
              <p className="warehouse-summary">Nenhum transporte tentado neste dia.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
