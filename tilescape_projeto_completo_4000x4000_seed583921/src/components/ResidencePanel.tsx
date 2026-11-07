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
  isAutomatableFarmType,
  type FarmAutomationSettings,
} from '../types/farming';
import { getDairyFarmEfficiency } from '../types/dairy';
import { GAME_RULES } from '../generated/gameConfig';

interface ResidencePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  isSaving: boolean;
  error: string;
  onSave: (settings: { wage: number; workHoursPerDay: number; desiredWorkers: number }) => void;
  onSaveRent: (rent: number) => void;
  onSavePrice: (price: number) => void;
  onSaveInputProduct: (productId: string) => void;
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
  onSaveFarmAutomation: (settings: FarmAutomationSettings) => void;
  showInfluence: boolean;
  onToggleInfluence: () => void;
  onClose: () => void;
}

const number = new Intl.NumberFormat('pt-BR');
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function getProductionDescription(
  type: ResidenceType,
  selectedInputProductId: string | null,
): string | null {
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
    if (definition.salesPerWorkerPerDay) {
      return `Cada funcionário permite vender até ${number.format(definition.salesPerWorkerPerDay)} ${definition.stockProduct?.toLowerCase() ?? 'unidades'} por dia, limitado pela demanda e pelo estoque abastecido pelo armazém ligado.`;
    }
    const workPointsPerUnit =
      type === 'shop_milk'
        ? GAME_RULES.consumption.salesCapacity.literWorkPointsPerSale
        : GAME_RULES.consumption.salesCapacity.unitWorkPointsPerSale;
    const unit = definition.stockProductId === 'milk' ? 'litro' : 'unidade';
    return `A cada ${number.format(workPointsPerUnit)} Work Point${workPointsPerUnit === 1 ? '' : 's'} gerados pelos funcionários, a loja ganha capacidade para vender até 1 ${unit}. As vendas dependem da demanda e do estoque disponível, abastecido pelo armazém ligado.`;
  }
  if (definition.kind === 'warehouse') {
    return `Não fabrica produtos: os Work Points dos funcionários são usados no transporte de mercadorias; cada carga consome ${number.format(GAME_RULES.transport.workPointsPerCubicMeter)} Work Points por m³ e ${number.format(GAME_RULES.transport.workPointsPerKilogram)} por kg.`;
  }

  const rule = definition.production;
  if (!rule || !definition.stockProduct) return null;
  const product = definition.stockProduct.toLocaleLowerCase('pt-BR');
  if (rule.mode === 'batch') {
    const batchProductId = definition.selectableInputProductIds
      ? selectedInputProductId ?? definition.defaultInputProductId
      : rule.batchStockProductId;
    const batchProduct = PRODUCTS.find(({ id }) => id === batchProductId);
    const inputs = [
      batchProductId
        ? `${number.format(rule.batchStockAmount ?? 0)}${batchProduct?.unit === 'liter' ? ' litros de ' : ' '}${batchProduct?.name.toLocaleLowerCase('pt-BR') ?? batchProductId}`
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
  onSaveInputProduct,
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
  onSaveFarmAutomation,
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
  const [inputProductId, setInputProductId] = useState(
    building.selectedInputProductId ?? definition.defaultInputProductId ?? '',
  );
  const [isFarmAdvancedOpen, setIsFarmAdvancedOpen] = useState(false);
  const [farmAutomation, setFarmAutomation] = useState<FarmAutomationSettings>(building.farmAutomation);

  useEffect(() => {
    setPrice(String(building.price));
  }, [building.id, building.price]);

  useEffect(() => {
    setInputProductId(building.selectedInputProductId ?? definition.defaultInputProductId ?? '');
  }, [building.id, building.selectedInputProductId, definition.defaultInputProductId]);

  useEffect(() => {
    setWage(String(building.wage));
    setHours(String(building.workHoursPerDay));
    setRent(String(building.rent));
    setDesired(String(building.desiredWorkers));
  }, [building.id, building.wage, building.workHoursPerDay, building.rent, building.desiredWorkers]);

  useEffect(() => {
    setFarmAutomation({
      ...building.farmAutomation,
      plantingMonths: [...building.farmAutomation.plantingMonths],
    });
  }, [
    building.id,
    building.farmAutomation.enabled,
    building.farmAutomation.plantingMonths.join(','),
    building.farmAutomation.plantingWorkers,
    building.farmAutomation.harvestWorkers,
  ]);

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
  const submitFarmAutomation = (event: FormEvent) => {
    event.preventDefault();
    onSaveFarmAutomation(farmAutomation);
  };
  const togglePlantingMonth = (month: number) => {
    setFarmAutomation((current) => ({
      ...current,
      plantingMonths: current.plantingMonths.includes(month)
        ? current.plantingMonths.filter((value) => value !== month)
        : [...current.plantingMonths, month].sort((a, b) => a - b),
    }));
  };

  const isResidence = definition.kind === 'residence';
  const isFarm = !isResidence;
  const cropRule = definition.cropRule;
  const cropProduct = definition.stockProduct ?? 'produto';
  const cropAction =
    building.type === 'farm_cattle' ? 'Iniciar criação' : `Plantar ${cropProduct.toLowerCase()}`;
  const productionDescription = getProductionDescription(
    building.type,
    building.selectedInputProductId,
  );
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
            ...Object.entries(definition.inputCapacities ?? {}).map(([productId, capacity]) => {
              const product = PRODUCTS.find((entry) => entry.id === productId);
              const activeCapacity =
                !definition.selectableInputProductIds ||
                building.selectedInputProductId === productId
                  ? capacity
                  : 0;
              return [
                `Estoque de ${product?.name ?? productId}${product?.unit === 'liter' ? ' (litros)' : ''}`,
                `${number.format(building.inputStocks[productId] ?? 0)} / ${number.format(activeCapacity)}`,
              ] as [string, string];
            }),
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
                : definition.kind === 'industry'
                  ? 'INDÚSTRIA'
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
      {['farm', 'resource', 'fishery', 'workshop', 'industry'].includes(definition.kind) && building.status === 'completed' && (
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
          {isOwner && isAutomatableFarmType(building.type) && (
            <>
              <button
                type="button"
                aria-expanded={isFarmAdvancedOpen}
                onClick={() => setIsFarmAdvancedOpen((open) => !open)}
              >
                {isFarmAdvancedOpen ? 'Fechar configurações avançadas' : 'Configurações avançadas'}
              </button>
              {isFarmAdvancedOpen && (
                <form className="farm-automation-settings" onSubmit={submitFarmAutomation}>
                  <label className="farm-automation-toggle">
                    <input
                      type="checkbox"
                      checked={farmAutomation.enabled}
                      disabled={isSaving}
                      onChange={(event) =>
                        setFarmAutomation((current) => ({ ...current, enabled: event.target.checked }))
                      }
                    />
                    Automatizar os ciclos desta fazenda
                  </label>
                  <p>
                    Quando a fazenda estiver sem ciclo, o plantio começará no primeiro processamento
                    diário de um mês selecionado. Ciclos em andamento não serão interrompidos.
                  </p>
                  <fieldset>
                    <legend>Meses permitidos para replantar</legend>
                    <div className="farm-automation-months">
                      {monthNames.map((monthName, index) => {
                        const month = index + 1;
                        return (
                          <label key={month}>
                            <input
                              type="checkbox"
                              checked={farmAutomation.plantingMonths.includes(month)}
                              disabled={isSaving}
                              onChange={() => togglePlantingMonth(month)}
                            />
                            {monthName}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  <label>
                    Funcionários durante o plantio e crescimento (0 a {definition.maxWorkers})
                    <input
                      type="number"
                      min={0}
                      max={definition.maxWorkers}
                      step={1}
                      value={farmAutomation.plantingWorkers}
                      disabled={isSaving}
                      onChange={(event) =>
                        setFarmAutomation((current) => ({
                          ...current,
                          plantingWorkers: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Funcionários durante a colheita (0 a {definition.maxWorkers})
                    <input
                      type="number"
                      min={0}
                      max={definition.maxWorkers}
                      step={1}
                      value={farmAutomation.harvestWorkers}
                      disabled={isSaving}
                      onChange={(event) =>
                        setFarmAutomation((current) => ({
                          ...current,
                          harvestWorkers: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  {farmAutomation.enabled && farmAutomation.plantingMonths.length === 0 && (
                    <p role="alert">Selecione pelo menos um mês para ativar a automação.</p>
                  )}
                  <div className="farm-automation-actions">
                    <button
                      type="submit"
                      disabled={
                        isSaving ||
                        (farmAutomation.enabled && farmAutomation.plantingMonths.length === 0)
                      }
                    >
                      {isSaving
                        ? 'Salvando…'
                        : farmAutomation.enabled
                          ? 'Salvar automatização'
                          : 'Salvar configurações'}
                    </button>
                    {building.farmAutomation.enabled && (
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() =>
                          onSaveFarmAutomation({ ...farmAutomation, enabled: false })
                        }
                      >
                        Desativar automatização
                      </button>
                    )}
                  </div>
                </form>
              )}
            </>
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
              disabled={!isOwner || isSaving || (cropRule !== undefined && building.farmAutomation.enabled)}
              onChange={(event) => setDesired(event.target.value)}
            />
          </label>
          {cropRule && building.farmAutomation.enabled && (
            <small>A quantidade de funcionários é controlada pelas configurações avançadas durante cada fase.</small>
          )}
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
          {definition.selectableInputProductIds && (
            <form
              className="work-settings"
              onSubmit={(event) => {
                event.preventDefault();
                if (inputProductId) onSaveInputProduct(inputProductId);
              }}
            >
              <label>
                Matéria-prima do moinho
                <select
                  value={inputProductId}
                  disabled={!isOwner || isSaving || building.status !== 'completed'}
                  onChange={(event) => setInputProductId(event.target.value)}
                >
                  {definition.selectableInputProductIds.map((productId) => (
                    <option key={productId} value={productId}>
                      {PRODUCTS.find((product) => product.id === productId)?.name ?? productId}
                    </option>
                  ))}
                </select>
              </label>
              {inputProductId !== building.selectedInputProductId &&
                (building.inputStocks[building.selectedInputProductId ?? ''] ?? 0) > 0 && (
                  <small>
                    Ao salvar, as{' '}
                    {number.format(building.inputStocks[building.selectedInputProductId ?? ''] ?? 0)} unidades
                    restantes da matéria-prima atual serão descartadas.
                  </small>
                )}
              {isOwner ? (
                <button
                  type="submit"
                  disabled={
                    isSaving ||
                    building.status !== 'completed' ||
                    inputProductId === building.selectedInputProductId
                  }
                >
                  {isSaving ? 'Salvando…' : 'Salvar matéria-prima'}
                </button>
              ) : (
                <small>Somente o dono do moinho pode alterar a matéria-prima.</small>
              )}
            </form>
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
