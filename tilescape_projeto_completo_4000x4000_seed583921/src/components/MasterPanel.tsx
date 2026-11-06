import { useEffect, useState } from 'react';
import { MAX_MASTER_GRANT, WORLD_TIME_SCALES } from '../types/worldClock';
import { formatMoney } from '../types/wallet';
import { isCurrencyAmount } from '../types/currency';

export interface OnlinePlayer {
  id: string;
  name: string;
  email: string;
  connections: number;
}

interface MasterPanelProps {
  timeScale: number;
  players: OnlinePlayer[];
  isLoadingPlayers: boolean;
  isBusy: boolean;
  error: string;
  message: string;
  onSetTimeScale: (timeScale: number) => void;
  onGrantMoney: (amount: number) => void;
  onRefreshPlayers: () => void;
  onClose: () => void;
}

export default function MasterPanel({
  timeScale,
  players,
  isLoadingPlayers,
  isBusy,
  error,
  message,
  onSetTimeScale,
  onGrantMoney,
  onRefreshPlayers,
  onClose,
}: MasterPanelProps) {
  const [amount, setAmount] = useState('1000');
  const parsed = Number(amount);
  const isValidAmount = isCurrencyAmount(parsed) && parsed >= 0.01 && parsed <= MAX_MASTER_GRANT;

  useEffect(() => {
    onRefreshPlayers();
    const timer = window.setInterval(onRefreshPlayers, 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="warehouse-panel master-panel" aria-label="Comandos do Master">
      <div className="panel-title">
        <div className="eyebrow">MASTER</div>
        <h1>Comandos do Master</h1>
        <button type="button" className="panel-close" aria-label="Fechar comandos" onClick={onClose}>
          ×
        </button>
      </div>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      {message && <p role="status" className="master-message">{message}</p>}

      <h2 className="master-heading">Velocidade do mundo</h2>
      <div className="master-row">
        {WORLD_TIME_SCALES.map((scale) => (
          <button
            key={scale}
            type="button"
            className={`master-button${scale === timeScale ? ' active' : ''}`}
            disabled={isBusy || scale === timeScale}
            onClick={() => onSetTimeScale(scale)}
          >
            1:{scale}
          </button>
        ))}
      </div>

      <h2 className="master-heading">Adicionar C$ à sua conta</h2>
      <form
        className="master-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValidAmount) onGrantMoney(parsed);
        }}
      >
        <input
          className="master-input"
          type="number"
          min={0.01}
          max={MAX_MASTER_GRANT}
          step={0.01}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-label="Valor em C$"
        />
        <button className="master-button" type="submit" disabled={isBusy || !isValidAmount}>
          Adicionar {isValidAmount ? formatMoney(parsed) : ''}
        </button>
      </form>

      <h2 className="master-heading">
        Jogadores online ({players.length})
        <button type="button" className="master-link" onClick={onRefreshPlayers}>
          {isLoadingPlayers ? 'Atualizando…' : 'Atualizar'}
        </button>
      </h2>
      <ul className="master-players">
        {players.length === 0 && <li>Nenhum jogador conectado.</li>}
        {players.map((player) => (
          <li key={player.id}>
            <strong>{player.name}</strong>
            <span>{player.email}</span>
            {player.connections > 1 && <small>{player.connections} abas</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
