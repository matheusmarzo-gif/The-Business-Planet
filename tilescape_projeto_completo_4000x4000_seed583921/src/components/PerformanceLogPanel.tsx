import { Activity, RefreshCw } from 'lucide-react';
import type { PerformanceLogRecord } from '../types/performanceLog';
import type { WebSocketTrafficSnapshot } from '../types/websocketTraffic';

interface PerformanceLogPanelProps {
  logs: PerformanceLogRecord[];
  websocketTraffic: WebSocketTrafficSnapshot | null;
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
const trafficHourTime = new Intl.DateTimeFormat('pt-BR', {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${decimal.format(milliseconds)} ms`
    : `${decimal.format(milliseconds / 1000)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${integer.format(bytes)} B`;
  if (bytes < 1_000_000) return `${decimal.format(bytes / 1000)} kB`;
  if (bytes < 1_000_000_000) return `${decimal.format(bytes / 1_000_000)} MB`;
  return `${decimal.format(bytes / 1_000_000_000)} GB`;
}

export default function PerformanceLogPanel({
  logs,
  websocketTraffic,
  isLoading,
  error,
  onRefresh,
  onClose,
}: PerformanceLogPanelProps) {
  const trafficHours = websocketTraffic?.hours ?? [];
  const totalPayloadBytes = trafficHours.reduce(
    (total, hour) =>
      total +
      hour.snapshots.payloadBytes +
      hour.worldUpdates.payloadBytes +
      hour.commerceDiagnostics.payloadBytes,
    0,
  );
  const totalConnectionHours = trafficHours.reduce((total, hour) => total + hour.connectionHours, 0);
  const totalReconnections = trafficHours.reduce((total, hour) => total + hour.reconnections, 0);
  const peakConcurrentConnections = trafficHours.reduce(
    (peak, hour) => Math.max(peak, hour.peakConcurrentConnections),
    0,
  );
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
      <section className="websocket-traffic" aria-label="Tráfego WebSocket nas últimas 24 horas">
        <h2>WebSocket · últimas 24 horas</h2>
        <p className="warehouse-summary">
          Métricas coletadas após esta versão entrar em produção. Bytes representam o payload UTF-8
          das mensagens; não incluem overhead de WebSocket, TLS ou transporte. Cada aba conectada
          conta como um socket; o pico é amostrado a cada 10 segundos.
        </p>
        <div className="performance-log-metrics">
          <span>Conexões agora <strong>{integer.format(websocketTraffic?.activeConnections ?? 0)}</strong></span>
          <span>Pico amostrado <strong>{integer.format(peakConcurrentConnections)}</strong></span>
          <span>Reconexões <strong>{integer.format(totalReconnections)}</strong></span>
          <span>Horas-socket <strong>{decimal.format(totalConnectionHours)} h</strong></span>
          <span>Payload enviado <strong>{formatBytes(totalPayloadBytes)}</strong></span>
          <span>Por socket-hora <strong>
            {totalConnectionHours > 0
              ? `${formatBytes(totalPayloadBytes / totalConnectionHours)}`
              : '—'}
          </strong></span>
        </div>
        <div className="warehouse-list performance-log-list">
          {trafficHours.slice().reverse().map((hour) => (
            <article className="performance-log-entry" key={hour.hour}>
              <div className="performance-log-heading">
                <strong>{trafficHourTime.format(new Date(`${hour.hour}:00:00.000Z`))} UTC</strong>
                <span>{decimal.format(hour.connectionHours)} socket-h</span>
                <span>pico {integer.format(hour.peakConcurrentConnections)}</span>
                <span>{integer.format(hour.connections)} conexões · {integer.format(hour.reconnections)} reconexões</span>
              </div>
              <div className="performance-log-metrics">
                <span>Snapshots <strong>{integer.format(hour.snapshots.messages)} · {formatBytes(hour.snapshots.payloadBytes)}</strong></span>
                <span>Mundo <strong>{integer.format(hour.worldUpdates.messages)} · {formatBytes(hour.worldUpdates.payloadBytes)}</strong></span>
                <span>Diagnósticos <strong>{integer.format(hour.commerceDiagnostics.messages)} · {formatBytes(hour.commerceDiagnostics.payloadBytes)}</strong></span>
              </div>
            </article>
          ))}
        </div>
      </section>
      {!isLoading && !error && logs.length === 0 && (
        <p className="warehouse-empty">
          Ainda não há medições de processamento. Os registros aparecem quando as etapas diárias forem executadas.
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
