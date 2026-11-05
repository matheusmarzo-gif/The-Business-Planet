import { FormEvent, useEffect, useState } from 'react';
import {
  MAX_RENT,
  MAX_WAGE,
  MAX_WORK_HOURS,
  MIN_RENT,
  MIN_WORK_HOURS,
  RESIDENCE_STATS,
  WORKER_SEARCH_RADIUS,
  RESIDENCES,
  ResidentialBuilding,
} from '../types/residence';
import { canLinkToWarehouse } from '../types/logistics';
import {
  FARM_DAILY_WORK_POINTS,
  getHarvestDay,
  getMonthOfDay,
  getPlantingFactor,
  HARVEST_WORK_POINTS_PER_UNIT,
} from '../types/farming';

interface ResidencePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  isSaving: boolean;
  error: string;
  onSave: (settings: { wage: number; workHoursPerDay: number; desiredWorkers: number }) => void;
  onSaveRent: (rent: number) => void;
  onSavePrice: (price: number) => void;
  onOpenWarehouse: () => void;
  isLinking: boolean;
  onStartLink: () => void;
  onCancelLink: () => void;
  onUnlink: () => void;
  onPlant: () => void;
  onClose: () => void;
}

const number = new Intl.NumberFormat('pt-BR');
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

export default function ResidencePanel({
  building,
  isOwner,
  isSaving,
  error,
  onSave,
  onSaveRent,
  onSavePrice,
  onOpenWarehouse,
  isLinking,
  onStartLink,
  onCancelLink,
  onUnlink,
  onPlant,
  onClose,
}: ResidencePanelProps) {
  const definition = RESIDENCES[building.type];
  const [wage, setWage] = useState(String(building.wage));
  const [hours, setHours] = useState(String(building.workHoursPerDay));
  const [rent, setRent] = useState(String(building.rent));
  const [desired, setDesired] = useState(String(building.desiredWorkers));
  const [price, setPrice] = useState(String(building.price));

  useEffect(() => {
    setPrice(String(building.price));
  }, [building.id, building.price]);

  useEffect(() => {
    setWage(String(building.wage));
    setHours(String(building.workHoursPerDay));
    setRent(String(building.rent));
    setDesired(String(building.desiredWorkers));
  }, [building.id, building.wage, building.workHoursPerDay, building.rent, building.desiredWorkers]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      wage: Number(wage),
      workHoursPerDay: Number(hours),
      desiredWorkers: Number(desired),
    });
  };
  const submitRent = (event: FormEvent) => {
    event.preventDefault();
    onSaveRent(Number(rent));
  };

  const isResidence = definition.kind === 'residence';
  const isFarm = !isResidence;
  const openJobs = Math.max(0, Math.min(building.desiredWorkers, definition.maxWorkers) - building.employed);
  const jobRows: [string, string][] = [
    ['Funcionários atuais', number.format(building.employed)],
    ['Funcionários desejados', number.format(building.desiredWorkers)],
    ['Vagas ofertadas', number.format(openJobs)],
    ['Máximo de funcionários', number.format(definition.maxWorkers)],
    ['Raio de busca de trabalhadores', `${WORKER_SEARCH_RADIUS} tiles`],
  ];
  const rows: [string, string][] =
    building.status === 'under_construction'
      ? [
          ['Work Points completados', number.format(Math.floor(building.workPointsDone))],
          ['Work Points necessários', number.format(definition.workPoints)],
          ...jobRows,
        ]
      : isFarm
        ? [
            ...jobRows,
            definition.kind === 'warehouse'
              ? ['Espaço ocupado', `0 / ${number.format(definition.storageCapacityM3 ?? 0)} m³`]
              : [`Estoque de ${definition.stockProduct}`, `${number.format(building.stock)} / ${number.format(definition.stockCapacity ?? 0)}`],
          ]
        : [
            ['Ocupantes atuais', number.format(building.occupants)],
            ['Máximo de ocupantes', number.format(definition.capacity)],
            ['Técnica média dos trabalhadores', String(RESIDENCE_STATS.skill)],
            ['Saúde dos trabalhadores', String(RESIDENCE_STATS.health)],
            ['Felicidade dos trabalhadores', String(RESIDENCE_STATS.happiness)],
            ['Pessoas empregadas', number.format(building.employed)],
            ['Renda média dos trabalhadores', '0'],
          ];

  return (
    <aside className="realm-panel">
      <div className="panel-title">
        <div className="eyebrow">
          {building.status === 'under_construction'
            ? 'EM CONSTRUÇÃO'
            : definition.kind === 'farm'
              ? 'FAZENDA'
              : definition.kind === 'shop'
                ? 'COMÉRCIO'
                : definition.kind === 'warehouse'
                  ? 'INDÚSTRIA'
                  : 'RESIDÊNCIA'}
        </div>
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
      {definition.kind === 'warehouse' && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenWarehouse}>
          Produtos e estoque
        </button>
      )}
      {building.type === 'farm_rice' && building.status === 'completed' && (
        <div className="crop-panel">
          {building.crop === null ? (
            <p>Nenhum plantio. Plante para iniciar o ciclo de 6 meses.</p>
          ) : building.crop.phase === 'growing' ? (
            <p>
              Crescendo desde {formatDay(building.crop.plantedDay)}; colheita em{' '}
              {formatDay(getHarvestDay(building.crop.plantedDay))}. Fator do mês do plantio:{' '}
              {Math.round(getPlantingFactor(getMonthOfDay(building.crop.plantedDay)) * 100)}%
              {building.crop.days > 0 &&
                ` · Work Points até agora: ${Math.round((building.crop.ratioSum / building.crop.days) * 100)}% de ${number.format(FARM_DAILY_WORK_POINTS)}/dia`}
              .
            </p>
          ) : (
            <p>
              Colhendo: {number.format(building.crop.harvested)} / {number.format(building.crop.yieldUnits)}{' '}
              unidades ({number.format(HARVEST_WORK_POINTS_PER_UNIT)} Work Points por unidade).
            </p>
          )}
          {isOwner && building.crop?.phase !== 'harvesting' && (
            <button type="button" disabled={isSaving} onClick={onPlant}>
              {building.crop ? 'Replantar (zera o contador)' : 'Plantar arroz'}
            </button>
          )}
        </div>
      )}
      {isOwner && building.status === 'completed' && canLinkToWarehouse(building.type) && (
        <div className="warehouse-link">
          <p>{building.warehouseId ? 'Ligado a um armazém.' : 'Sem armazém ligado.'}</p>
          {isLinking ? (
            <button type="button" onClick={onCancelLink}>
              Cancelar: clique em um armazém no mapa…
            </button>
          ) : (
            <button type="button" disabled={isSaving} onClick={onStartLink}>
              Ligar a um armazém
            </button>
          )}
          {building.warehouseId && !isLinking && (
            <button type="button" disabled={isSaving} onClick={onUnlink}>
              Desligar
            </button>
          )}
        </div>
      )}
      {(building.status === 'under_construction' || isFarm) && (
        <form className="work-settings" onSubmit={submit}>
          <label>
            Funcionários desejados (0 a {definition.maxWorkers})
            <input
              type="number"
              min={0}
              max={definition.maxWorkers}
              step={1}
              value={desired}
              disabled={!isOwner || isSaving}
              onChange={(event) => setDesired(event.target.value)}
            />
          </label>
          <label>
            Salário ofertado (C$ por dia de trabalho)
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
            Carga horária por dia (horas)
            <input
              type="number"
              min={MIN_WORK_HOURS}
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
      {building.type === 'shop_rice' && (
        <form
          className="work-settings"
          onSubmit={(event) => {
            event.preventDefault();
            onSavePrice(Number(price));
          }}
        >
          <label>
            Preço do arroz (C$ por unidade)
            <input
              type="number"
              min={1}
              max={100000}
              step={1}
              value={price}
              disabled={!isOwner || isSaving}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          {isOwner ? (
            <button type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando…' : 'Salvar preço'}
            </button>
          ) : (
            <small>Somente o dono da loja pode editar.</small>
          )}
        </form>
      )}
      {!isFarm && (
      <form className="work-settings" onSubmit={submitRent}>
        <label>
          Aluguel (C$ por pessoa, cobrado às 00:00)
          <input
            type="number"
            min={MIN_RENT}
            max={MAX_RENT}
            step={1}
            value={rent}
            disabled={!isOwner || isSaving}
            onChange={(event) => setRent(event.target.value)}
          />
        </label>
        {isOwner ? (
          <button type="submit" disabled={isSaving}>
            {isSaving ? 'Salvando…' : 'Salvar aluguel'}
          </button>
        ) : (
          <small>Somente o dono da residência pode editar.</small>
        )}
        {building.status === 'completed' && error && <p role="alert">{error}</p>}
      </form>
      )}
    </aside>
  );
}
