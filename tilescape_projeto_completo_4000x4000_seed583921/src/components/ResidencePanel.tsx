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
  getResidentialBuildingName,
  type ResidentialBuilding,
  type ResidenceType,
} from '../types/residence';
import { getMaxDesiredWorkers } from '../types/employment';
import { canLinkToWarehouse } from '../types/logistics';
import { PRODUCTS } from '../types/product';
import {
  getHarvestDay,
  getMonthOfDay,
  getPlantingFactor,
} from '../types/farming';
import { getDairyFarmEfficiency } from '../types/dairy';

interface ResidencePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  isSaving: boolean;
  error: string;
  onSave: (settings: { wage: number; workHoursPerDay: number; desiredWorkers: number }) => void;
  onSaveRent: (rent: number) => void;
  onSavePrice: (price: number) => void;
  onOpenWarehouse: () => void;
  warehouseStock: ReadonlyMap<string, number>;
  warehouseStockLoaded: boolean;
  onOpenConsumption: () => void;
  onOpenProductionHistory: () => void;
  onOpenCommerceHistory: () => void;
  onOpenWarehouseLog: () => void;
  isLinking: boolean;
  onStartLink: () => void;
  onCancelLink: () => void;
  onUnlink: () => void;
  onPlant: () => void;
  showInfluence: boolean;
  onToggleInfluence: () => void;
  onClose: () => void;
}

const number = new Intl.NumberFormat('pt-BR');
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

function getProductionDescription(type: ResidenceType): string | null {
  const definition = RESIDENCES[type];
  if (definition.kind === 'farm') {
    if (type === 'farm_dairy' && definition.production) {
      return `Produção sazonal de leite: ${number.format(definition.production.workPointsPerUnit)} Work Points efetivos por litro. Eficiência: meses 1–3, ${number.format(getDairyFarmEfficiency(1) * 100)}%; 4–6, ${number.format(getDairyFarmEfficiency(4) * 100)}%; 7–9, ${number.format(getDairyFarmEfficiency(7) * 100)}%; 10–12, ${number.format(getDairyFarmEfficiency(10) * 100)}%.`;
    }
    const cropRule = definition.cropRule;
    if (cropRule) {
      const seasonalEfficiency = cropRule.plantingEfficiencyByQuarter
        .map((efficiency, index) => `${index * 3 + 1}–${index * 3 + 3}: ${number.format(efficiency * 100)}%`)
        .join(', ');
      return `Ciclo de ${number.format(cropRule.growthMonths)} meses: ${number.format(cropRule.dailyWorkPoints)} Work Points por dia garantem produtividade plena; na colheita ou corte, cada unidade consome ${number.format(cropRule.harvestWorkPointsPerUnit)} Work Points. Eficiência pelo mês do plantio: ${seasonalEfficiency}.`;
    }
  }
  if (definition.kind === 'shop') {
    const workPointsPerUnit = type === 'shop_milk' ? 1 : 20;
    const unit = definition.stockProductId === 'milk' ? 'litro' : 'unidade';
    return `A cada ${number.format(workPointsPerUnit)} Work Point${workPointsPerUnit === 1 ? '' : 's'} gerados pelos funcionários, a loja ganha capacidade para vender até 1 ${unit}. As vendas dependem da demanda e do estoque disponível, abastecido pelo armazém ligado.`;
  }
  if (definition.kind === 'warehouse') {
    return 'Não fabrica produtos: os Work Points dos funcionários são usados no transporte de mercadorias; cada carga consome 100 Work Points por m³ e 0,125 por kg.';
  }

  const rule = definition.production;
  if (!rule || !definition.stockProduct) return null;
  const product = definition.stockProduct.toLocaleLowerCase('pt-BR');
  if (rule.mode === 'batch') {
    const inputs = [
      rule.batchStockProductId
        ? `${number.format(rule.batchStockAmount ?? 0)} ${PRODUCTS.find(({ id }) => id === rule.batchStockProductId)?.name.toLocaleLowerCase('pt-BR') ?? rule.batchStockProductId}`
        : '',
      rule.batchWood ? `${number.format(rule.batchWood)} madeiras` : '',
      rule.batchIron ? `${number.format(rule.batchIron)} ferro` : '',
      rule.batchCharcoal ? `${number.format(rule.batchCharcoal)} carvões` : '',
    ].filter(Boolean);
    return `A cada ${number.format(rule.workPointsPerUnit)} Work Points${inputs.length ? ` + ${inputs.join(' + ')}` : ''}, produz ${number.format(rule.batchSize ?? 1)} ${product}.`;
  }
  if (rule.mode === 'chance') {
    return `Cada bloco completo de ${number.format(rule.workPointsPerUnit)} Work Points efetivos produz 1 ${product}; o restante dá chance proporcional de produzir mais uma unidade.`;
  }
  return `Cada ${number.format(rule.workPointsPerUnit)} Work Points efetivos produz 1 ${product}; o progresso restante é acumulado para o próximo dia.`;
}

export default function ResidencePanel({
  building,
  isOwner,
  isSaving,
  error,
  onSave,
  onSaveRent,
  onSavePrice,
  onOpenWarehouse,
  warehouseStock,
  warehouseStockLoaded,
  onOpenConsumption,
  onOpenProductionHistory,
  onOpenCommerceHistory,
  onOpenWarehouseLog,
  isLinking,
  onStartLink,
  onCancelLink,
  onUnlink,
  onPlant,
  showInfluence,
  onToggleInfluence,
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
  const cropRule = definition.cropRule;
  const cropProduct = definition.stockProduct ?? 'produto';
  const cropAction =
    building.type === 'farm_cattle' ? 'Iniciar criação' : `Plantar ${cropProduct.toLowerCase()}`;
  const productionDescription = getProductionDescription(building.type);
  const maxDesiredWorkers = getMaxDesiredWorkers(building.type, building.status);
  const openJobs = Math.max(0, Math.min(building.desiredWorkers, maxDesiredWorkers) - building.employed);
  const jobRows: [string, string][] = [
    ['Funcionários atuais', number.format(building.employed)],
    ['Funcionários desejados', number.format(building.desiredWorkers)],
    ['Vagas ofertadas', number.format(openJobs)],
    ['Máximo de funcionários', number.format(maxDesiredWorkers)],
    ['Raio de busca de trabalhadores', `${WORKER_SEARCH_RADIUS} tiles`],
  ];
  const warehouseUsedM3 = PRODUCTS.reduce(
    (total, product) => total + (warehouseStock.get(product.id) ?? 0) * product.volumeM3,
    0,
  );
  const detailRows: [string, string][] =
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
              ? [
                  'Espaço ocupado',
                  warehouseStockLoaded
                    ? `${number.format(Math.round(warehouseUsedM3 * 1000) / 1000)} / ${number.format(definition.storageCapacityM3 ?? 0)} m³`
                    : 'Consulte em Produtos e estoque',
                ]
              : [`Estoque de ${definition.stockProduct}`, `${number.format(building.stock)} / ${number.format(definition.stockCapacity ?? 0)}`],
            ...(definition.toolCapacity
              ? ([
                  ['Estoque de Ferramentas', `${number.format(building.toolStock)} / ${number.format(definition.toolCapacity)}`],
                  ...(definition.toolDemandPerWorker
                    ? [
                        ['Demanda de Ferramentas por dia', `${(building.employed * definition.toolDemandPerWorker).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`],
                        ['Penalidade de eficiência', `${building.efficiencyPenalty}%`],
                      ]
                    : []),
                ] as [string, string][])
              : []),
            ...(definition.woodCapacity
              ? ([['Estoque de Madeira', `${number.format(building.woodStock)} / ${number.format(definition.woodCapacity)}`]] as [string, string][])
              : []),
            ...(definition.ironCapacity
              ? ([['Estoque de Ferro', `${number.format(building.ironStock)} / ${number.format(definition.ironCapacity)}`]] as [string, string][])
              : []),
            ...(definition.charcoalCapacity
              ? ([['Estoque de Carvão', `${number.format(building.charcoalStock)} / ${number.format(definition.charcoalCapacity)}`]] as [string, string][])
              : []),
            ...(definition.sugarcaneCapacity
              ? ([['Estoque de Cana', `${number.format(building.sugarcaneStock)} / ${number.format(definition.sugarcaneCapacity)}`]] as [string, string][])
              : []),
          ]
        : [
            ['Ocupantes atuais', number.format(building.occupants)],
            ['Máximo de ocupantes', number.format(definition.capacity)],
            ['Técnica média dos trabalhadores', String(RESIDENCE_STATS.skill)],
            ['Saúde dos trabalhadores', String(RESIDENCE_STATS.health)],
            ['Felicidade dos trabalhadores', String(RESIDENCE_STATS.happiness)],
            ['Pessoas empregadas', number.format(building.employed)],
            ['Renda média dos trabalhadores', `C$ ${building.averageIncome.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`],
          ];
  const rows: [string, string][] = [
    ['Proprietário', building.ownerName || 'Jogador'],
    ...detailRows,
  ];

  return (
    <aside className="realm-panel">
      <div className="panel-title">
        <div className="eyebrow">
          {building.status === 'under_construction'
            ? 'EM CONSTRUÇÃO'
            : definition.kind === 'farm'
              ? 'FAZENDA'
              : definition.kind === 'resource'
                ? 'RECURSO'
                : definition.kind === 'fishery' || definition.kind === 'workshop'
                ? 'CONSTRUÇÃO ARTESANAL'
                : definition.kind === 'shop'
                ? 'COMÉRCIO'
                : definition.kind === 'warehouse'
                  ? 'INDÚSTRIA'
                  : 'RESIDÊNCIA'}
        </div>
        <h1>{getResidentialBuildingName(building.type, building.buildingNumber)}</h1>
        <button type="button" className="panel-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </div>
      {productionDescription && <p className="production-description">{productionDescription}</p>}
      <div className="panel-divider" />
      <dl className="detail-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="crop-panel">
        <button type="button" aria-pressed={showInfluence} onClick={onToggleInfluence}>
          {showInfluence ? 'Ocultar influência' : 'Ver influência'}
        </button>
      </div>
      {definition.kind === 'residence' && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenConsumption}>
          Ver consumo da casa
        </button>
      )}
      {['farm', 'resource', 'fishery', 'workshop'].includes(definition.kind) && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenProductionHistory}>
          Histórico de produção
        </button>
      )}
      {isOwner && definition.kind === 'shop' && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenCommerceHistory}>
          Histórico do comércio
        </button>
      )}
      {definition.kind === 'warehouse' && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenWarehouse}>
          Produtos e estoque
        </button>
      )}
      {definition.kind === 'warehouse' && building.status === 'completed' && (
        <button type="button" className="warehouse-open" onClick={onOpenWarehouseLog}>
          Histórico do armazém
        </button>
      )}
      {cropRule && building.status === 'completed' && (
        <div className="crop-panel">
          {building.crop === null ? (
            <p>Nenhum ciclo ativo. {cropAction} para iniciar o ciclo de {cropRule.growthMonths} meses.</p>
          ) : building.crop.phase === 'growing' ? (
            <p>
              {building.type === 'farm_cattle' ? 'Em criação' : 'Crescendo'} desde{' '}
              {formatDay(building.crop.plantedDay)};{' '}
              {building.type === 'farm_cattle' ? 'corte' : 'colheita'} em{' '}
              {formatDay(getHarvestDay(building.crop.plantedDay, cropRule.growthMonths))}. Fator do mês do plantio:{' '}
              {Math.round(
                getPlantingFactor(
                  getMonthOfDay(building.crop.plantedDay),
                  cropRule.plantingEfficiencyByQuarter,
                ) * 100,
              )}%
              {building.crop.days > 0 &&
                ` · Work Points até agora: ${Math.round((building.crop.ratioSum / building.crop.days) * 100)}% de ${number.format(cropRule.dailyWorkPoints)}/dia`}
              .
            </p>
          ) : (
            <p>
              {building.type === 'farm_cattle' ? 'Cortando' : 'Colhendo'}: {number.format(building.crop.harvested)} /{' '}
              {number.format(building.crop.yieldUnits)} unidades de {cropProduct.toLowerCase()} (
              {number.format(cropRule.harvestWorkPointsPerUnit)} Work Points por unidade).
            </p>
          )}
          {isOwner && building.crop?.phase !== 'harvesting' && (
            <button type="button" disabled={isSaving} onClick={onPlant}>
              {building.crop ? 'Reiniciar ciclo (zera o contador)' : cropAction}
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
            Funcionários desejados (0 a {maxDesiredWorkers})
            <input
              type="number"
              min={0}
              max={maxDesiredWorkers}
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
              step={0.01}
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
      {definition.kind === 'shop' && (
        <form
          className="work-settings"
          onSubmit={(event) => {
            event.preventDefault();
            onSavePrice(Number(price));
          }}
        >
          <label>
            Preço do {definition.stockProduct?.toLocaleLowerCase('pt-BR') ?? 'produto'} (C$ por {definition.stockProductId === 'milk' ? 'litro' : 'unidade'})
            <input
              type="number"
              min={0.01}
              max={100000}
              step={0.01}
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
            step={0.01}
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
