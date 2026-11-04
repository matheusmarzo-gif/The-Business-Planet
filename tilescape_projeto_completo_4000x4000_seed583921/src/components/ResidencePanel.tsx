import { FormEvent, useEffect, useState } from 'react';
import {
  MAX_WAGE,
  MAX_WORK_HOURS,
  RESIDENCE_STATS,
  RESIDENCES,
  ResidentialBuilding,
} from '../types/residence';

interface ResidencePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  isSaving: boolean;
  error: string;
  onSave: (settings: { wage: number; workHoursPerDay: number }) => void;
  onClose: () => void;
}

const number = new Intl.NumberFormat('pt-BR');

export default function ResidencePanel({
  building,
  isOwner,
  isSaving,
  error,
  onSave,
  onClose,
}: ResidencePanelProps) {
  const definition = RESIDENCES[building.type];
  const [wage, setWage] = useState(String(building.wage));
  const [hours, setHours] = useState(String(building.workHoursPerDay));

  useEffect(() => {
    setWage(String(building.wage));
    setHours(String(building.workHoursPerDay));
  }, [building.id, building.wage, building.workHoursPerDay]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ wage: Number(wage), workHoursPerDay: Number(hours) });
  };

  const rows: [string, string][] =
    building.status === 'completed'
      ? [
          ['Ocupantes atuais', '0'],
          ['Máximo de ocupantes', number.format(definition.capacity)],
          ['Técnica média dos trabalhadores', String(RESIDENCE_STATS.skill)],
          ['Saúde dos trabalhadores', String(RESIDENCE_STATS.health)],
          ['Felicidade dos trabalhadores', String(RESIDENCE_STATS.happiness)],
          ['Pessoas empregadas', '0'],
          ['Renda média dos trabalhadores', '0'],
        ]
      : [
          ['Work Points completados', '0'],
          ['Work Points necessários', number.format(definition.workPoints)],
          ['Empregados atuais', '0'],
          ['Máximo de empregados', number.format(definition.maxWorkers)],
        ];

  return (
    <aside className="realm-panel">
      <div className="panel-title">
        <div className="eyebrow">{building.status === 'completed' ? 'RESIDÊNCIA' : 'EM CONSTRUÇÃO'}</div>
        <h1>{definition.name}</h1>
        <button type="button" className="panel-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="panel-divider" />
      <dl className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {building.status === 'under_construction' && (
        <form className="work-settings" onSubmit={submit}>
          <label>
            Salário ofertado (por hora)
            <input
              type="number"
              min={0}
              max={MAX_WAGE}
              step={1}
              value={wage}
              disabled={!isOwner || isSaving}
              onChange={(event) => setWage(event.target.value)}
            />
          </label>
          <label>
            Carga horária por dia
            <input
              type="number"
              min={1}
              max={MAX_WORK_HOURS}
              step={1}
              value={hours}
              disabled={!isOwner || isSaving}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>
          {isOwner ? (
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando…' : 'Salvar'}
            </button>
          ) : (
            <small>Somente o dono da construção pode editar.</small>
          )}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </aside>
  );
}
