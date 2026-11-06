import { Activity, RefreshCw } from 'lucide-react';
import type { PerformanceLogRecord } from '../types/performanceLog';

interface PerformanceLogPanelProps {
  logs: PerformanceLogRecord[];
  isLoading: boolean;
  error: string;
  onRefresh: () => void;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${decimal.format(milliseconds)} ms`
    : `${decimal.format(milliseconds / 1000)} s`;
}

export default function PerformanceLogPanel({
  logs,
  isLoading,
  error,
  onRefresh,
  onClose,
}: PerformanceLogPanelProps) {
  return (
    <section className="warehouse-panel performance-log-panel" aria-label="Logs de desempenho">
      <div className="panel-title">
        <div>
          <div className="eyebrow">PROCESSAMENTO DO MUNDO</div>
          <h1>Logs</h1>
        </div>
        <div className="performance-log-actions">
          <button type="button" className="accounting-view-button" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={13} />
            {isLoading ? 'Carregando…' : 'Atualizar'}
          </button>
          <button type="button" className="panel-close" aria-label="Fechar logs" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <p className="warehouse-summary">
        Até 100 etapas recentes. O tempo fora do banco inclui cálculo na aplicação e outras esperas.
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      {!isLoading && !error && logs.length === 0 && (
        <p className="warehouse-empty">
          Ainda não há medições. Os registros aparecem quando as etapas diárias forem executadas.
        </p>
      )}
      <div className="warehouse-list performance-log-list">
        {logs.map((log) => (
          <article className="performance-log-entry" key={log.id}>
            <div className="performance-log-heading">
              <strong><Activity size={13} /> {log.stage}</strong>
              <span>{log.phase} · dia {log.gameDay}</span>
              <time dateTime={log.recordedAt}>{dateTime.format(new Date(log.recordedAt))}</time>
            </div>
            <div className="performance-log-metrics">
              <span>Total <strong>{formatDuration(log.durationMs)}</strong></span>
              <span>Banco <strong>{formatDuration(log.databaseMs)}</strong></span>
              <span>Espera pelo lock <strong>{formatDuration(log.lockWaitMs)}</strong></span>
              <span>Fora do banco <strong>{formatDuration(Math.max(0, log.durationMs - log.databaseMs))}</strong></span>
              <span>Consultas <strong>{integer.format(log.queryCount)}</strong></span>
            </div>
            <div className="performance-log-counts">
              <span>Residências: {integer.format(log.counts.residences)}</span>
              <span>Locais de trabalho: {integer.format(log.counts.workplaces)}</span>
              <span>Lojas: {integer.format(log.counts.shops)}</span>
              <span>Armazéns: {integer.format(log.counts.warehouses)}</span>
              {log.status === 'error' && <strong className="commerce-loss">Etapa com falha</strong>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
