import { Fragment, useMemo, useState } from 'react';
import { PRODUCTS } from '../types/product';
import {
  getResidentialBuildingName,
  MAX_WAGE,
  MAX_WAGE_PER_TECHNIQUE_RATE,
  MAX_WORKER_TECHNIQUE,
  MAX_WORK_HOURS,
  MIN_WORKER_TECHNIQUE,
  MIN_WORK_HOURS,
  RESIDENCES,
  type ResidenceType,
} from '../types/residence';
import { getMaxDesiredWorkers } from '../types/employment';
import { formatMoney } from '../types/wallet';
import {
  ADVANCED_BASKET_PRODUCT_IDS,
  ADVANCED_GOODS_BASKET_PRODUCT_IDS,
  BASIC_BASKET_PRODUCT_IDS,
  GOODS_BASKET_PRODUCT_IDS,
  INTERMEDIATE_BASKET_PRODUCT_IDS,
  INTERMEDIATE_GOODS_BASKET_PRODUCT_IDS,
  NOBLE_BASKET_PRODUCT_IDS,
  NOBLE_GOODS_BASKET_PRODUCT_IDS,
} from '../types/commerceDemand';
import {
  getAccountingPeriodLabel,
  getAccountingFarmWorkPointsNeeded,
  parseAccountingWeekOffset,
  parseAccountingPeriodDays,
  summarizeAccountingShops,
  type AccountingBuildingPosition,
  type AccountingFarm,
  type AccountingPeriodDays,
  type AccountingProductionBuilding,
  type AccountingShop,
  type AccountingWeekOffset,
  type AccountingSummary,
} from '../types/accounting';
import type { CityAssembly } from '../types/city';
import {
  getHarvestDay,
  getHarvestYield,
  getMonthOfDay,
  getPlantingFactor,
  isAutomatableFarmType,
  type FarmAutomationSettings,
} from '../types/farming';

interface AccountingPanelProps {
  summary: AccountingSummary | null;
  cities: Pick<CityAssembly, 'id' | 'name'>[];
  selectedCityId: string | null;
  onCityChange: (cityId: string | null) => void;
  isLoading: boolean;
  error: string;
  periodDays: AccountingPeriodDays;
  onPeriodChange: (days: AccountingPeriodDays) => void;
  weekOffset: AccountingWeekOffset;
  onWeekChange: (offset: AccountingWeekOffset) => void;
  onViewBuilding: (building: AccountingBuildingPosition) => void;
  onSaveWorkSettings: (
    buildingId: string,
    settings: {
      wage: number;
      wageByTechnique: boolean;
      wagePerTechniqueRate: number;
      workHoursPerDay: number;
      desiredWorkers: number;
      desiredWorkersByWorkPoints: boolean;
      desiredWorkPointsPerDay: number;
      minimumWorkerTechnique: number;
    },
  ) => Promise<void>;
  onSavePrice: (buildingId: string, price: number) => Promise<void>;
  onSaveFarmAutomation: (buildingId: string, settings: FarmAutomationSettings) => Promise<void>;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const unitCost = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const benefit = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const technique = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const FARM_MONTHS = [
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

const SHOP_BASKET_GROUPS = [
  { id: 'basic', label: 'Cesta básica', productIds: BASIC_BASKET_PRODUCT_IDS },
  { id: 'intermediate', label: 'Cesta intermediária', productIds: INTERMEDIATE_BASKET_PRODUCT_IDS },
  { id: 'advanced', label: 'Cesta avançada', productIds: ADVANCED_BASKET_PRODUCT_IDS },
  { id: 'noble', label: 'Cesta nobre', productIds: NOBLE_BASKET_PRODUCT_IDS },
  { id: 'goods', label: 'Cesta básica de bens', productIds: GOODS_BASKET_PRODUCT_IDS },
  { id: 'intermediateGoods', label: 'Cesta intermediária de bens', productIds: INTERMEDIATE_GOODS_BASKET_PRODUCT_IDS },
  { id: 'advancedGoods', label: 'Cesta avançada de bens', productIds: ADVANCED_GOODS_BASKET_PRODUCT_IDS },
  { id: 'nobleGoods', label: 'Cesta nobre de bens', productIds: NOBLE_GOODS_BASKET_PRODUCT_IDS },
] as const;
const SHOP_FILTER_BLOCKS = [
  ...SHOP_BASKET_GROUPS.map(({ id, label }) => ({ id, label })),
  { id: 'other', label: 'Outras lojas' },
] as const;
const SHOP_GROUP_BY_PRODUCT = new Map<string, string>(
  SHOP_BASKET_GROUPS.flatMap((group) =>
    group.productIds.map((productId) => [productId, group.id] as const),
  ),
);
const getShopBasketGroup = (type: ResidenceType) =>
  SHOP_GROUP_BY_PRODUCT.get(RESIDENCES[type].stockProductId ?? '') ?? 'other';

function AccountingBuildingDetails({
  building,
  onSaveWorkSettings,
  onSavePrice,
}: {
  building: AccountingShop | AccountingProductionBuilding | AccountingFarm;
  onSaveWorkSettings: AccountingPanelProps['onSaveWorkSettings'];
  onSavePrice: AccountingPanelProps['onSavePrice'];
}) {
  const [desiredWorkers, setDesiredWorkers] = useState(String(building.fixedDesiredWorkers));
  const [desiredWorkersByWorkPoints, setDesiredWorkersByWorkPoints] = useState(
    building.desiredWorkersByWorkPoints,
  );
  const [desiredWorkPointsPerDay, setDesiredWorkPointsPerDay] = useState(
    String(building.desiredWorkPointsPerDay),
  );
  const [workHoursPerDay, setWorkHoursPerDay] = useState(String(building.workHoursPerDay));
  const [wage, setWage] = useState(String(building.wage));
  const [wageByTechnique, setWageByTechnique] = useState(building.wageByTechnique);
  const [wagePerTechniqueRate, setWagePerTechniqueRate] = useState(
    String(
      building.wageByTechnique
        ? building.wagePerTechniqueRate
        : Number((building.wage / (building.averageWorkerTechnique ?? 10)).toFixed(2)),
    ),
  );
  const [minimumWorkerTechnique, setMinimumWorkerTechnique] = useState(
    String(building.minimumWorkerTechnique),
  );
  const [price, setPrice] = useState('price' in building ? String(building.price) : '');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [message, setMessage] = useState('');
  const isShop = 'price' in building;
  const farm = 'farmAutomation' in building ? building : null;

  return (
    <div
      className={`accounting-building-details${isShop ? ' accounting-shop-details' : ''}`}
      id={`accounting-building-${building.id}`}
    >
      <div className="accounting-building-fields">
        <label>
          Funcionários atuais
          <output>{integer.format(building.employed)}</output>
        </label>
        <label>
          {desiredWorkersByWorkPoints
            ? 'Work Points desejados por dia'
            : 'Funcionários desejados'}
          <input
            type="number"
            min={0}
            max={desiredWorkersByWorkPoints
              ? 1_000_000_000
              : getMaxDesiredWorkers(building.type, building.status)}
            step={1}
            required
            value={desiredWorkersByWorkPoints ? desiredWorkPointsPerDay : desiredWorkers}
            disabled={isSavingSettings || Boolean(farm?.farmAutomation.enabled)}
            onChange={(event) =>
              desiredWorkersByWorkPoints
                ? setDesiredWorkPointsPerDay(event.target.value)
                : setDesiredWorkers(event.target.value)
            }
          />
        </label>
        <label className="farm-automation-toggle">
          <input
            type="checkbox"
            checked={desiredWorkersByWorkPoints}
            disabled={isSavingSettings || Boolean(farm?.farmAutomation.enabled)}
            onChange={(event) => setDesiredWorkersByWorkPoints(event.target.checked)}
          />
          Definir por Work Points por dia
        </label>
        {desiredWorkersByWorkPoints && (
          <small>
            Meta diária de {integer.format(Number(desiredWorkPointsPerDay) || 0)} Work Points;
            equipe atual calculada: {integer.format(building.desiredWorkers)}.
          </small>
        )}
        {farm?.farmAutomation.enabled && (
          <small className="accounting-farm-automation-note">
            A quantidade de funcionários é controlada pela automação durante cada fase.
          </small>
        )}
        <label>
          Carga horária (horas/dia)
          <input
            type="number"
            min={MIN_WORK_HOURS}
            max={MAX_WORK_HOURS}
            step={1}
            required
            value={workHoursPerDay}
            disabled={isSavingSettings}
            onChange={(event) => setWorkHoursPerDay(event.target.value)}
          />
        </label>
        <label>
          {wageByTechnique
            ? 'Salário (C$ por ponto de técnica)'
            : 'Salário (C$ por dia)'}
          <input
            type="number"
            min={wageByTechnique ? 0 : 0}
            max={wageByTechnique ? MAX_WAGE_PER_TECHNIQUE_RATE : MAX_WAGE}
            step={0.01}
            required
            value={wageByTechnique ? wagePerTechniqueRate : wage}
            disabled={isSavingSettings}
            onChange={(event) =>
              wageByTechnique
                ? setWagePerTechniqueRate(event.target.value)
                : setWage(event.target.value)
            }
          />
        </label>
        <label className="farm-automation-toggle">
          <input
            type="checkbox"
            checked={wageByTechnique}
            disabled={isSavingSettings}
            onChange={(event) => setWageByTechnique(event.target.checked)}
          />
          Calcular salário pela técnica média
        </label>
        {wageByTechnique && (
          <small>Salário efetivo atual: {formatMoney(building.wage)} por dia.</small>
        )}
        <label>
          Técnica média atual
          <output>
            {building.averageWorkerTechnique === null
              ? '—'
              : technique.format(building.averageWorkerTechnique)}
          </output>
        </label>
        <label>
          Técnica mínima desejável
          <input
            type="number"
            min={MIN_WORKER_TECHNIQUE}
            max={MAX_WORKER_TECHNIQUE}
            step={1}
            required
            value={minimumWorkerTechnique}
            disabled={isSavingSettings}
            onChange={(event) => setMinimumWorkerTechnique(event.target.value)}
          />
        </label>
        {isShop && (
          <label>
            Preço de venda (C$)
            <input
              type="number"
              min={0.01}
              max={100000}
              step={0.01}
              required
              value={price}
              disabled={isSavingPrice}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
        )}
      </div>
      <div className="accounting-building-actions">
        <button
          type="button"
          disabled={isSavingSettings}
          onClick={async () => {
            setIsSavingSettings(true);
            setMessage('');
            try {
              await onSaveWorkSettings(building.id, {
                wage: Number(wage),
                wageByTechnique,
                wagePerTechniqueRate: Number(wagePerTechniqueRate),
                workHoursPerDay: Number(workHoursPerDay),
                desiredWorkers: Number(desiredWorkers),
                desiredWorkersByWorkPoints,
                desiredWorkPointsPerDay: Number(desiredWorkPointsPerDay),
                minimumWorkerTechnique: Number(minimumWorkerTechnique),
              });
              setMessage('Configurações salvas.');
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Não foi possível salvar as configurações.',
              );
            } finally {
              setIsSavingSettings(false);
            }
          }}
        >
          {isSavingSettings ? 'Salvando…' : 'Salvar funcionários e jornada'}
        </button>
        {isShop && (
          <button
            type="button"
            disabled={isSavingPrice}
            onClick={async () => {
              setIsSavingPrice(true);
              setMessage('');
              try {
                await onSavePrice(building.id, Number(price));
                setMessage('Preço de venda salvo.');
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : 'Não foi possível salvar o preço.',
                );
              } finally {
                setIsSavingPrice(false);
              }
            }}
          >
            {isSavingPrice ? 'Salvando…' : 'Salvar preço'}
          </button>
        )}
        {message && <small role="status">{message}</small>}
      </div>
    </div>
  );
}

function AccountingFarmAutomationEditor({
  building,
  onSave,
}: {
  building: AccountingFarm;
  onSave: AccountingPanelProps['onSaveFarmAutomation'];
}) {
  const [settings, setSettings] = useState<FarmAutomationSettings>(() => ({
    ...building.farmAutomation,
    plantingMonths: [...building.farmAutomation.plantingMonths],
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!isAutomatableFarmType(building.type)) return null;

  const isCattleFarm = building.type === 'farm_cattle';
  const toggleMonth = (month: number) => {
    setSettings((current) => ({
      ...current,
      plantingMonths: current.plantingMonths.includes(month)
        ? current.plantingMonths.filter((value) => value !== month)
        : [...current.plantingMonths, month].sort((a, b) => a - b),
    }));
  };

  return (
    <form
      className="farm-automation-settings accounting-farm-automation"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSaving(true);
        setMessage('');
        try {
          await onSave(building.id, settings);
          setMessage('Automação salva.');
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : 'Não foi possível salvar a automação da fazenda.',
          );
        } finally {
          setIsSaving(false);
        }
      }}
    >
      <label className="farm-automation-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={isSaving}
          onChange={(event) =>
            setSettings((current) => ({ ...current, enabled: event.target.checked }))
          }
        />
        Automatizar os ciclos desta fazenda
      </label>
      <p>
        Quando a fazenda estiver sem ciclo, {isCattleFarm ? 'a criação' : 'o plantio'} começará no
        primeiro processamento diário de um mês selecionado. Ciclos em andamento não serão interrompidos.
      </p>
      <fieldset>
        <legend>
          {isCattleFarm
            ? 'Meses permitidos para iniciar a criação'
            : 'Meses permitidos para iniciar ou replantar'}
        </legend>
        <div className="farm-automation-months">
          {FARM_MONTHS.map((monthName, index) => {
            const month = index + 1;
            return (
              <label key={month}>
                <input
                  type="checkbox"
                  checked={settings.plantingMonths.includes(month)}
                  disabled={isSaving}
                  onChange={() => toggleMonth(month)}
                />
                {monthName}
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="farm-automation-toggle">
        <input
          type="checkbox"
          checked={settings.plantingWorkersByWorkPoints}
          disabled={isSaving}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              plantingWorkersByWorkPoints: event.target.checked,
            }))
          }
        />
        Definir equipe de {isCattleFarm ? 'criação' : 'plantio e crescimento'} por Work Points?
      </label>
      <label>
        {settings.plantingWorkersByWorkPoints
          ? 'Work Points desejados por dia'
          : `Funcionários durante ${isCattleFarm ? 'a criação' : 'o plantio e crescimento'} (0 a ${RESIDENCES[building.type].maxWorkers})`}
        <input
          type="number"
          min={0}
          max={settings.plantingWorkersByWorkPoints
            ? 1_000_000_000
            : RESIDENCES[building.type].maxWorkers}
          step={1}
          value={settings.plantingWorkersByWorkPoints
            ? settings.plantingWorkPointsPerDay
            : settings.plantingWorkers}
          disabled={isSaving}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              ...(current.plantingWorkersByWorkPoints
                ? { plantingWorkPointsPerDay: Number(event.target.value) }
                : { plantingWorkers: Number(event.target.value) }),
            }))
          }
        />
      </label>
      <label className="farm-automation-toggle">
        <input
          type="checkbox"
          checked={settings.harvestWorkersByWorkPoints}
          disabled={isSaving}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              harvestWorkersByWorkPoints: event.target.checked,
            }))
          }
        />
        Definir equipe de {isCattleFarm ? 'abate' : 'colheita'} por Work Points?
      </label>
      <label>
        {settings.harvestWorkersByWorkPoints
          ? 'Work Points desejados por dia'
          : `Funcionários durante ${isCattleFarm ? 'o abate' : 'a colheita'} (0 a ${RESIDENCES[building.type].maxWorkers})`}
        <input
          type="number"
          min={0}
          max={settings.harvestWorkersByWorkPoints
            ? 1_000_000_000
            : RESIDENCES[building.type].maxWorkers}
          step={1}
          value={settings.harvestWorkersByWorkPoints
            ? settings.harvestWorkPointsPerDay
            : settings.harvestWorkers}
          disabled={isSaving}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              ...(current.harvestWorkersByWorkPoints
                ? { harvestWorkPointsPerDay: Number(event.target.value) }
                : { harvestWorkers: Number(event.target.value) }),
            }))
          }
        />
      </label>
      {settings.enabled && settings.plantingMonths.length === 0 && (
        <p role="alert">Selecione pelo menos um mês para ativar a automação.</p>
      )}
      <div className="farm-automation-actions">
        <button
          type="submit"
          disabled={isSaving || (settings.enabled && settings.plantingMonths.length === 0)}
        >
          {isSaving
            ? 'Salvando…'
            : settings.enabled
              ? 'Salvar automatização'
              : 'Salvar configurações'}
        </button>
        {message && <small role="status">{message}</small>}
      </div>
    </form>
  );
}

function getFarmHarvestForecast(farm: AccountingFarm): string {
  const definition = RESIDENCES[farm.type];
  const productName =
    PRODUCTS.find((product) => product.id === farm.stockProductId)?.name ?? farm.stockProductId;
  if (!farm.crop || !definition.cropRule) {
    return definition.cropRule
      ? 'Sem ciclo de colheita ativo.'
      : 'Produção contínua; sem previsão de colheita.';
  }

  const harvestDay = getHarvestDay(farm.crop.plantedDay, definition.cropRule.growthMonths);
  const forecastUnits =
    farm.crop.phase === 'harvesting'
      ? Math.max(0, farm.crop.yieldUnits - farm.crop.harvested)
      : getHarvestYield(
          farm.crop.plantedDay,
          farm.crop.ratioSum,
          farm.crop.days,
          definition.cropRule,
        );
  const date = `${harvestDay.slice(8, 10)}/${harvestDay.slice(5, 7)}/${harvestDay.slice(0, 4)}`;
  return farm.crop.phase === 'harvesting'
    ? `Safra pronta desde ${date}: ${integer.format(forecastUnits)} ${productName} restantes.`
    : `Previsão de colheita: ${integer.format(forecastUnits)} ${productName} em ${date}. Estimativa pela mão de obra acumulada.`;
}

export default function AccountingPanel({
  summary,
  cities,
  selectedCityId,
  onCityChange,
  isLoading,
  error,
  periodDays,
  onPeriodChange,
  weekOffset,
  onWeekChange,
  onViewBuilding,
  onSaveWorkSettings,
  onSavePrice,
  onSaveFarmAutomation,
  onClose,
}: AccountingPanelProps) {
  const [activeTab, setActiveTab] = useState<
    'summary' | 'shops' | 'warehouses' | 'residences' | 'production' | 'farms' | 'products'
  >('summary');
  const [productSearch, setProductSearch] = useState('');
  const [shopTypeFilter, setShopTypeFilter] = useState<ResidenceType | 'all'>('all');
  const [farmTypeFilter, setFarmTypeFilter] = useState<ResidenceType | 'all'>('all');
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(() => new Set());
  const toggleBuildingDetails = (buildingId: string) => {
    setExpandedBuildings((current) => {
      const next = new Set(current);
      if (next.has(buildingId)) next.delete(buildingId);
      else next.add(buildingId);
      return next;
    });
  };
  const periodLabel = getAccountingPeriodLabel(periodDays);
  const weeklySummary = summary?.weeklySummary;
  const shops = summary?.shops ?? [];
  const farms = summary?.farms ?? [];
  const farmTypes = useMemo(
    () =>
      [...new Set(farms.map((farm) => farm.type))].sort((a, b) =>
        RESIDENCES[a].name.localeCompare(RESIDENCES[b].name, 'pt-BR'),
      ),
    [farms],
  );
  const filteredFarms = useMemo(
    () => farms.filter((farm) => farmTypeFilter === 'all' || farm.type === farmTypeFilter),
    [farmTypeFilter, farms],
  );
  const productsById = useMemo(
    () => new Map((summary?.products ?? []).map((product) => [product.productId, product])),
    [summary?.products],
  );
  const shopTypesByBlock = useMemo(() => {
    const availableTypes = [...new Set(shops.map((shop) => shop.type))];
    return SHOP_FILTER_BLOCKS.map((group) => ({
      ...group,
      shopTypes: availableTypes
        .filter((type) => getShopBasketGroup(type) === group.id)
        .sort((a, b) => RESIDENCES[a].name.localeCompare(RESIDENCES[b].name, 'pt-BR')),
    }));
  }, [shops]);
  const filteredShops = useMemo(
    () => shops.filter((shop) => shopTypeFilter === 'all' || shop.type === shopTypeFilter),
    [shops, shopTypeFilter],
  );
  const visibleShopGroups = useMemo(
    () =>
      SHOP_FILTER_BLOCKS.map((group) => ({
        ...group,
        shops: filteredShops.filter((shop) => getShopBasketGroup(shop.type) === group.id),
      })).filter((group) => group.shops.length > 0),
    [filteredShops],
  );
  const shopTotals = useMemo(() => summarizeAccountingShops(filteredShops), [filteredShops]);
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase('pt-BR');
    return (summary?.products ?? []).filter((item) => {
      if (!query) return true;
      const product = PRODUCTS.find((entry) => entry.id === item.productId);
      return (product?.name ?? item.productId).toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [productSearch, summary?.products]);
  const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

  return (
    <section className="warehouse-panel accounting-panel" aria-label="Painel contábil">
      <div className="panel-title">
        <div className="eyebrow">FINANÇAS DO JOGADOR</div>
        <h1>Contábil</h1>
        <button type="button" className="panel-close" aria-label="Fechar contábil" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        {activeTab === 'summary'
          ? 'O resumo mostra os resultados semanais e as estimativas atuais da empresa.'
          : `Período: ${periodLabel} do relógio do jogo.`}{' '}
        {isLoading && 'Carregando…'}
      </p>
      <div className="accounting-filter-row">
        {activeTab !== 'summary' && (
          <label className="accounting-period">
            Período do relatório
            <select
              value={periodDays}
              disabled={isLoading}
              onChange={(event) => {
                const days = parseAccountingPeriodDays(event.target.value);
                if (days !== null) onPeriodChange(days);
              }}
            >
              <option value={1}>Último dia</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
            </select>
          </label>
        )}
        <label className="accounting-period">
          Filtrar por cidade
          <select
            value={selectedCityId ?? 'all'}
            disabled={isLoading}
            onChange={(event) =>
              onCityChange(event.target.value === 'all' ? null : event.target.value)
            }
          >
            <option value="all">Geral (todas as cidades)</option>
            {[...cities]
              .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'))
              .map((city) => (
                <option key={city.id} value={city.id}>{city.name}</option>
              ))}
          </select>
        </label>
      </div>
      <div className="accounting-tabs" role="tablist" aria-label="Relatórios contábeis">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={activeTab === 'summary' ? 'active' : ''}
          onClick={() => setActiveTab('summary')}
        >
          Resumo
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'shops'}
          className={activeTab === 'shops' ? 'active' : ''}
          onClick={() => setActiveTab('shops')}
        >
          Lojas comerciais
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'warehouses'}
          className={activeTab === 'warehouses' ? 'active' : ''}
          onClick={() => setActiveTab('warehouses')}
        >
          Armazéns
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'residences'}
          className={activeTab === 'residences' ? 'active' : ''}
          onClick={() => setActiveTab('residences')}
        >
          Residências
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'production'}
          className={activeTab === 'production' ? 'active' : ''}
          onClick={() => setActiveTab('production')}
        >
          Produção
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'farms'}
          className={activeTab === 'farms' ? 'active' : ''}
          onClick={() => setActiveTab('farms')}
        >
          Fazendas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'products'}
          className={activeTab === 'products' ? 'active' : ''}
          onClick={() => setActiveTab('products')}
        >
          Produto
        </button>
      </div>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      {activeTab === 'summary' ? (
        <>
          <label className="accounting-period">
            Semana do relatório
            <select
              value={weekOffset}
              disabled={isLoading}
              onChange={(event) => {
                const offset = parseAccountingWeekOffset(event.target.value);
                if (offset !== null) onWeekChange(offset);
              }}
            >
              <option value={0}>Semana atual</option>
              <option value={1}>Semana anterior</option>
              <option value={2}>2 semanas antes</option>
              <option value={3}>3 semanas antes</option>
              <option value={4}>4 semanas antes</option>
            </select>
          </label>
          {weeklySummary && (
            <>
              <p className="accounting-history-note">
                Semana do jogo: {formatDay(weeklySummary.startDay)} a {formatDay(weeklySummary.endDay)}.
                A empresa usa custos estimados dos materiais, com fallback para preços de venda dos armazéns;
                o estoque usa esses preços de venda.
              </p>
              <div className="accounting-summary-grid">
                <article>
                  <span>Lucro / prejuízo da semana</span>
                  <strong className={weeklySummary.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
                    {formatMoney(weeklySummary.profitLoss)}
                  </strong>
                  <small>Receitas {formatMoney(weeklySummary.revenue)} · despesas {formatMoney(weeklySummary.expenses)}</small>
                </article>
                <article>
                  <span>Funcionários empregados</span>
                  <strong>{integer.format(weeklySummary.employees)}</strong>
                  <small>Empregos atualmente preenchidos</small>
                </article>
                <article>
                  <span>Valor estimado da empresa</span>
                  <strong>{formatMoney(weeklySummary.companyValue)}</strong>
                  <small>Custo estimado dos materiais de construção</small>
                </article>
                <article>
                  <span>Produtos em estoque</span>
                  <strong>{formatMoney(weeklySummary.inventoryValue)}</strong>
                  <small>Estoque de armazéns e construções produtivas</small>
                </article>
              </div>
            </>
          )}
        </>
      ) : activeTab === 'shops' ? (
        <>
          <p className="accounting-history-note">
            Receita líquida estimada = receita − custo estimado atual do produto na aba Produto ×
            (unidades vendidas + perdidas) − salários. O custo atual é aplicado a todo o período selecionado;
            sem estimativa disponível, o resultado fica indisponível quando houve movimentação.
          </p>
          <div className="accounting-shop-filters" aria-label="Filtrar lojas comerciais por tipo">
            <div className="accounting-shop-filter-title">Filtrar por tipo de loja</div>
            <div className="accounting-shop-filter-groups">
              <fieldset className="accounting-shop-filter-block">
                <legend>Exibição</legend>
                <button
                  type="button"
                  className={`accounting-shop-filter-option${shopTypeFilter === 'all' ? ' active' : ''}`}
                  aria-pressed={shopTypeFilter === 'all'}
                  onClick={() => setShopTypeFilter('all')}
                >
                  Todas as lojas
                </button>
              </fieldset>
              {shopTypesByBlock.map((group) =>
                group.shopTypes.length > 0 ? (
                  <fieldset className="accounting-shop-filter-block" key={group.id}>
                    <legend>{group.label}</legend>
                    <div className="accounting-shop-filter-options">
                      {group.shopTypes.map((type) => (
                        <button
                          type="button"
                          className={`accounting-shop-filter-option${shopTypeFilter === type ? ' active' : ''}`}
                          aria-pressed={shopTypeFilter === type}
                          key={type}
                          onClick={() => setShopTypeFilter(type)}
                        >
                          {RESIDENCES[type].name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null,
              )}
            </div>
          </div>
          <div className="warehouse-list accounting-list">
            <div className="accounting-row accounting-shop-row warehouse-head">
              <span>Loja</span>
              <span>Gasto com salários</span>
              <span>Receita</span>
              <span>Unidades vendidas</span>
              <span>Unidades perdidas</span>
              <span>Receita líquida estimada</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.shops.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui lojas comerciais.</p>
            )}
            {!isLoading && !error && shops.length > 0 && filteredShops.length === 0 && (
              <p className="warehouse-summary">Nenhuma loja corresponde a esse filtro.</p>
            )}
            {visibleShopGroups.map((group) => (
              <Fragment key={group.id}>
                <div className="accounting-shop-group">{group.label}</div>
                {group.shops.map((shop) => (
                  <Fragment key={shop.id}>
                  <div className="accounting-row accounting-shop-row">
                    <span className="accounting-building-name">
                      {getResidentialBuildingName(shop.type, shop.buildingNumber)}
                      <button
                        type="button"
                        className="accounting-expand-button"
                        aria-label={`${expandedBuildings.has(shop.id) ? 'Ocultar' : 'Editar'} ${getResidentialBuildingName(shop.type, shop.buildingNumber)}`}
                        aria-expanded={expandedBuildings.has(shop.id)}
                        aria-controls={`accounting-building-${shop.id}`}
                        onClick={() => toggleBuildingDetails(shop.id)}
                      >
                        {expandedBuildings.has(shop.id) ? '−' : '+'}
                      </button>
                    </span>
                    <span>{formatMoney(shop.employeeExpense)}</span>
                    <span>{formatMoney(shop.revenue)}</span>
                    <span>{integer.format(shop.unitsSold)}</span>
                    <span>{integer.format(shop.unitsLost)}</span>
                    <span>
                      {shop.estimatedNetRevenue === null
                        ? 'Indisponível'
                        : formatMoney(shop.estimatedNetRevenue)}
                    </span>
                    <button
                      type="button"
                      className="accounting-view-button"
                      onClick={() => onViewBuilding(shop)}
                    >
                      Visualizar
                    </button>
                  </div>
                  {expandedBuildings.has(shop.id) && (
                    <AccountingBuildingDetails
                      building={shop}
                      onSaveWorkSettings={onSaveWorkSettings}
                      onSavePrice={onSavePrice}
                    />
                  )}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {filteredShops.length > 0 && (
              <div className="accounting-row accounting-shop-row accounting-shop-total">
                <strong>Total</strong>
                <span>{formatMoney(shopTotals.employeeExpense)}</span>
                <span>{formatMoney(shopTotals.revenue)}</span>
                <span>{integer.format(shopTotals.unitsSold)}</span>
                <span>{integer.format(shopTotals.unitsLost)}</span>
                <span>
                  {shopTotals.estimatedNetRevenue === null
                    ? 'Indisponível'
                    : formatMoney(shopTotals.estimatedNetRevenue)}
                </span>
                <span />
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'warehouses' ? (
        <>
          <p className="accounting-payroll">
            Salários pagos pelos armazéns: <strong>{formatMoney(summary?.warehouse.employeeExpense ?? 0)}</strong>
          </p>
          <p className="accounting-history-note">
            O histórico de compras, vendas e salários dos armazéns começa com esta atualização; operações
            anteriores não podem ser reconstruídas.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-row accounting-warehouse-building warehouse-head">
              <span>Armazém</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.warehouse.buildings.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui armazéns.</p>
            )}
            {summary?.warehouse.buildings.map((warehouse) => (
              <div className="accounting-row accounting-warehouse-building" key={warehouse.id}>
                <span>{getResidentialBuildingName('warehouse', warehouse.buildingNumber)}</span>
                <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(warehouse)}>
                  Visualizar
                </button>
              </div>
            ))}
          </div>
          <div className="warehouse-list accounting-list">
            <div className="accounting-warehouse-row warehouse-head">
              <span>Produto</span>
              <span>Comprado</span>
              <span>Gasto</span>
              <span>Vendido</span>
              <span>Receita</span>
              <span>Lucro/prejuízo</span>
            </div>
            {!isLoading && !error && (summary?.warehouse.products.length ?? 0) === 0 && (
              <p className="warehouse-summary">Nenhuma compra ou venda de produtos registrada no período.</p>
            )}
            {summary?.warehouse.products.map((item) => {
              const product = PRODUCTS.find((entry) => entry.id === item.productId);
              return (
                <div className="accounting-warehouse-row" key={item.productId}>
                  <span>{product?.name ?? item.productId}</span>
                  <span>{integer.format(item.boughtQuantity)}</span>
                  <span>{formatMoney(item.purchaseExpense)}</span>
                  <span>{integer.format(item.soldQuantity)}</span>
                  <span>{formatMoney(item.salesRevenue)}</span>
                  <span className={item.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
                    {formatMoney(item.profitLoss)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="accounting-history-note">
            O resultado por produto é a receita das vendas menos o custo das compras; não desconta salários.
          </p>
        </>
      ) : activeTab === 'residences' ? (
        <>
          <p className="accounting-history-note">
            A receita é o aluguel efetivamente gerado no período selecionado. Moradores são NPCs sem carteira
            individual; o valor é creditado diretamente ao proprietário. O histórico começa com esta atualização.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-four-row accounting-residence-row warehouse-head">
              <span>Residência</span>
              <span>Moradores / capacidade</span>
              <span>Aluguel gerado</span>
              <span>Benefício associado</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.residences.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui residências.</p>
            )}
            {summary?.residences.map((residence) => (
              <div className="accounting-four-row accounting-residence-row" key={residence.id}>
                <span>{getResidentialBuildingName(residence.type, residence.buildingNumber)}</span>
                <span>{integer.format(residence.occupants)} / {integer.format(residence.capacity)}</span>
                <span title={`Aluguel atual por pessoa: ${formatMoney(residence.rentPerPerson)}`}>
                  {formatMoney(residence.rentRevenue)}
                </span>
                <span>
                  {residence.associatedBenefit === null
                    ? '—'
                    : benefit.format(residence.associatedBenefit)}
                </span>
                <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(residence)}>
                  Visualizar
                </button>
              </div>
            ))}
          </div>
        </>
      ) : activeTab === 'production' ? (
        <>
          <p className="accounting-history-note">
            Salários e produção somam os registros diários do período selecionado. Não há dados recuperáveis de
            salários anteriores à implantação deste histórico.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-four-row warehouse-head">
              <span>Construção</span>
              <span>Gasto com salários</span>
              <span>Produção</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.production.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui construções produtivas.</p>
            )}
            {summary?.production.map((building) => {
              const product = PRODUCTS.find((entry) => entry.id === building.stockProductId);
              const produced = building.stockProductId
                ? `${integer.format(building.produced)} ${product?.name ?? building.stockProductId}`
                : integer.format(building.produced);
              return (
                <Fragment key={building.id}>
                  <div className="accounting-four-row">
                  <span className="accounting-building-name">
                    {getResidentialBuildingName(building.type, building.buildingNumber)}
                    <button
                      type="button"
                      className="accounting-expand-button"
                      aria-label={`${expandedBuildings.has(building.id) ? 'Ocultar' : 'Editar'} ${getResidentialBuildingName(building.type, building.buildingNumber)}`}
                      aria-expanded={expandedBuildings.has(building.id)}
                      aria-controls={`accounting-building-${building.id}`}
                      onClick={() => toggleBuildingDetails(building.id)}
                    >
                      {expandedBuildings.has(building.id) ? '−' : '+'}
                    </button>
                  </span>
                  <span>{formatMoney(building.employeeExpense)}</span>
                  <span>{produced}</span>
                  <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(building)}>
                    Visualizar
                  </button>
                  </div>
                  {expandedBuildings.has(building.id) && (
                    <AccountingBuildingDetails
                      building={building}
                      onSaveWorkSettings={onSaveWorkSettings}
                      onSavePrice={onSavePrice}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </>
      ) : activeTab === 'farms' ? (
        <>
          <p className="accounting-history-note">
            Work Points e produção somam o período selecionado; o estoque é atual. A eficiência do plantio
            usa o mês em que o ciclo começou, e a eficiência de mão de obra usa o ciclo atual (ou o último
            registro diário na fazenda leiteira, sem o fator sazonal). Work Points necessários são a meta
            diária pelos dias com ciclo ativo; em lavouras sem ciclo ativo, as eficiências ficam indisponíveis.
            Na fazenda leiteira, Work Points necessários são os Work Points por unidade produzida. Consumo
            mostra o total do produto nas construções do jogador, sem atribuí-lo a uma fazenda específica.
          </p>
          <label className="accounting-period">
            Filtrar por tipo de fazenda
            <select
              value={farmTypeFilter}
              disabled={isLoading}
              onChange={(event) => setFarmTypeFilter(event.target.value as ResidenceType | 'all')}
            >
              <option value="all">Todas as fazendas</option>
              {farmTypes.map((type) => (
                <option key={type} value={type}>{RESIDENCES[type].name}</option>
              ))}
            </select>
          </label>
          <div className="warehouse-list accounting-list">
            <div className="accounting-farm-row warehouse-head">
              <span>Fazenda</span>
              <span>Eficiência do plantio</span>
              <span>Eficiência atual (mão de obra)</span>
              <span>Work Points gerados</span>
              <span>Work Points necessários</span>
              <span>Estoque</span>
              <span>Produção</span>
              <span>Consumo</span>
              <span />
            </div>
            {!isLoading && !error && filteredFarms.length === 0 && (
              <p className="warehouse-summary">
                {farmTypeFilter === 'all'
                  ? 'Você ainda não possui fazendas.'
                  : 'Não há fazendas deste tipo.'}
              </p>
            )}
            {filteredFarms.map((farm) => {
              const definition = RESIDENCES[farm.type];
              const product = PRODUCTS.find((entry) => entry.id === farm.stockProductId);
              const productName = product?.name ?? farm.stockProductId;
              const productFlow = productsById.get(farm.stockProductId);
              const workPointsNeeded = getAccountingFarmWorkPointsNeeded(
                definition.cropRule?.dailyWorkPoints ?? null,
                farm.activeDays,
                farm.produced,
                definition.cropRule ? null : definition.production?.workPointsPerUnit ?? null,
              );
              const plantingEfficiency =
                definition.cropRule && farm.crop
                  ? getPlantingFactor(
                      getMonthOfDay(farm.crop.plantedDay),
                      definition.cropRule.plantingEfficiencyByQuarter,
                    )
                  : null;
              const consumptionTitle = productFlow
                ? `Consumo total de ${productName} nas construções do jogador no período selecionado: ${quantity.format(productFlow.consumedQuantity)}. Não é atribuído a esta fazenda.`
                : `Consumo total de ${productName} nas construções do jogador no período selecionado.`;
              return (
                <Fragment key={farm.id}>
                  <div className="accounting-farm-row">
                    <span className="accounting-farm-name">
                      <img
                        src={definition.asset}
                        alt=""
                        title={getFarmHarvestForecast(farm)}
                        className="accounting-farm-icon"
                      />
                      <span>{getResidentialBuildingName(farm.type, farm.buildingNumber)}</span>
                      <button
                        type="button"
                        className="accounting-expand-button"
                        aria-label={`${expandedBuildings.has(farm.id) ? 'Ocultar' : 'Editar'} ${getResidentialBuildingName(farm.type, farm.buildingNumber)}`}
                        aria-expanded={expandedBuildings.has(farm.id)}
                        aria-controls={`accounting-building-${farm.id}`}
                        onClick={() => toggleBuildingDetails(farm.id)}
                      >
                        {expandedBuildings.has(farm.id) ? '−' : '+'}
                      </button>
                    </span>
                    <span>
                      {plantingEfficiency === null ? '—' : `${percent.format(plantingEfficiency * 100)}%`}
                    </span>
                    <span>
                      {farm.efficiency === null ? '—' : `${percent.format(farm.efficiency)}%`}
                    </span>
                    <span>{quantity.format(farm.workPointsGenerated)}</span>
                    <span>{quantity.format(workPointsNeeded)}</span>
                    <span>{quantity.format(farm.stock)} {productName}</span>
                    <span>{quantity.format(farm.produced)} {productName}</span>
                    <span title={consumptionTitle}>
                      {quantity.format(productFlow?.consumedQuantity ?? 0)} {productName}
                    </span>
                    <button
                      type="button"
                      className="accounting-view-button"
                      onClick={() => onViewBuilding(farm)}
                    >
                      Visualizar
                    </button>
                  </div>
                  {expandedBuildings.has(farm.id) && (
                    <>
                      <AccountingBuildingDetails
                        building={farm}
                        onSaveWorkSettings={onSaveWorkSettings}
                        onSavePrice={onSavePrice}
                      />
                      <AccountingFarmAutomationEditor
                        building={farm}
                        onSave={onSaveFarmAutomation}
                      />
                    </>
                  )}
                </Fragment>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p className="accounting-history-note">
            Estoque atual e movimentações do período selecionado. Consumo inclui as residências e os insumos
            usados na produção. Custos são estimativas atualizadas diariamente, combinando Work Points,
            insumos avaliados pelo custo do dia anterior e compras de outros jogadores. A coluna lojas e perda
            de estoque soma vendas das lojas e perdas por validade em lojas, armazéns e demais locais.
          </p>
          <label className="warehouse-search accounting-product-search">
            <span>Buscar produto</span>
            <input
              type="search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Ex.: trigo, leite, madeira"
            />
          </label>
          <div className="warehouse-list accounting-list">
            <div className="accounting-product-row warehouse-head">
              <span>Produto</span>
              <span>Estoque</span>
              <span>Produzido</span>
              <span>Importado</span>
              <span>Exportado</span>
              <span>Lojas e perda de estoque</span>
              <span>Consumido</span>
              <span>Custo estimado</span>
            </div>
            {filteredProducts.map((item) => {
              const product = PRODUCTS.find((entry) => entry.id === item.productId);
              const totalStockLoss =
                item.shopStockLossQuantity +
                item.warehouseStockLossQuantity +
                item.otherStockLossQuantity;
              const shopsAndLoss = item.shopSalesQuantity + totalStockLoss;
              return (
                <div className="accounting-product-row" key={item.productId}>
                  <span>{product?.name ?? item.productId}</span>
                  <span>{quantity.format(item.stockQuantity)}</span>
                  <span>{quantity.format(item.producedQuantity)}</span>
                  <span>{quantity.format(item.importedQuantity)}</span>
                  <span>{quantity.format(item.exportedQuantity)}</span>
                  <span
                    title={`Vendas nas lojas: ${quantity.format(item.shopSalesQuantity)} · Perda de estoque: ${quantity.format(totalStockLoss)} (lojas: ${quantity.format(item.shopStockLossQuantity)} · armazéns: ${quantity.format(item.warehouseStockLossQuantity)} · demais locais: ${quantity.format(item.otherStockLossQuantity)})`}
                  >
                    {quantity.format(shopsAndLoss)}
                  </span>
                  <span title={`Residências: ${quantity.format(item.residentialConsumption)} · Produção: ${quantity.format(item.productionInputConsumption)}`}>
                    {quantity.format(item.consumedQuantity)}
                  </span>
                  <span>
                    {item.unitCostEstimate === null
                      ? 'Indisponível'
                      : `C$ ${unitCost.format(item.unitCostEstimate)} / un.`}
                  </span>
                </div>
              );
            })}
            {!isLoading && !error && filteredProducts.length === 0 && (
              <p className="warehouse-empty">Nenhum produto encontrado.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
