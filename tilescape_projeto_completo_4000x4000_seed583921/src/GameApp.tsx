import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock3,
  Compass,
  Map as MapIcon,
  Radio,
  Activity,
} from 'lucide-react';
import CityAssemblyModal from './components/CityAssemblyModal';
import ConstructionBar, { ConstructionCategory } from './components/ConstructionBar';
import AccountingPanel from './components/AccountingPanel';
import CityZoneEditor from './components/CityZoneEditor';
import ProductCatalog from './components/ProductCatalog';
import ResidencePanel from './components/ResidencePanel';
import MasterPanel, { type OnlinePlayer } from './components/MasterPanel';
import WarehousePanel from './components/WarehousePanel';
import WarehouseTransferPanel from './components/WarehouseTransferPanel';
import ConsumptionPanel, { type ProductConsumption } from './components/ConsumptionPanel';
import ProductionHistoryPanel, { type ProductionDay } from './components/ProductionHistoryPanel';
import CommerceHistoryPanel, { type CommerceDay } from './components/CommerceHistoryPanel';
import WarehouseLogPanel, { type WarehouseLogDay, type WarehouseLogEvent } from './components/WarehouseLogPanel';
import PerformanceLogPanel from './components/PerformanceLogPanel';
import type { WarehouseDemand, WarehouseProductSetting } from './types/warehouse';
import { GameMap } from './game/GameMap';
import { getAccessToken } from './auth/authClient';
import { connectToWorld, WorldSnapshot } from './game/worldClient';
import {
  CityAssembly,
  CityPlacementError,
  CityZoneBounds,
  CityZoneType,
  getCityZonePlacementError,
  getRequiredCityZone,
  MAX_CITY_ZONES,
} from './types/city';
import {
  DEFAULT_SHOP_PRICE,
  getShopSalesCapacity,
  simulateShopSales,
} from './types/commerce';
import { LINK_RADIUS } from './types/logistics';
import {
  type AccountingBuildingPosition,
  type AccountingPeriodDays,
  type AccountingWeekOffset,
  type AccountingSummary,
} from './types/accounting';
import type { FarmAutomationSettings } from './types/farming';
import {
  MAX_WAGE,
  MAX_WORK_HOURS,
  MIN_WORK_HOURS,
  DEFAULT_RENT,
  DEFAULT_WAGE,
  DEFAULT_WORK_HOURS,
  RESIDENCES,
  getConstructionMenuDefinitions,
  getResidentialBuildingName,
  isStorageBuilding,
  RESIDENCE_STATS,
  KIND_CATEGORY,
  ResidentialBuilding,
  ResidencePlacementError,
  ResidenceType,
} from './types/residence';
import type { RoadPlacementError, RoadPosition, RoadTile } from './types/road';
import { TileInfo } from './types/map';
import { formatMoney } from './types/wallet';
import { allocateWorkers, getDailyWorkPoints } from './types/employment';
import { PRODUCTS } from './types/product';
import type { PerformanceLogRecord } from './types/performanceLog';
import type { ResidenceBenefitCalculation } from './types/residence-relocation';
import { loadCommerceDiagnostics, saveCommerceDiagnostics } from './utils/commerceDiagnosticsStorage';
import { createMapGenerator } from './utils/mapGenerator';
import { DEFAULT_TILE_LIST } from './utils/tileAssets';
import { WORLD_CONFIG } from './utils/worldConfig';

const SPAWN = { x: 2000, y: 2000 };
const BASE_TILE_SIZE = 24;
const generator = createMapGenerator(WORLD_CONFIG, DEFAULT_TILE_LIST);
const formatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'UTC',
});
const CATEGORY_LABELS: Record<ConstructionCategory, string> = {
  artesanais: 'Construções Artesanais',
  comerciais: 'Comerciais',
  fazendas: 'Fazendas',
  residencias: 'Residências',
  recursos: 'Recursos',
  industrias: 'Indústrias',
  prefeitura: 'Prefeitura',
};
interface WarehouseTransferFlow {
  sourceId: string;
  productId: string;
  destination: ResidentialBuilding | null;
  quote: {
    maxQuantity: number;
    workPoints: number;
    destinationStock: number;
    destinationCapacity: number | null;
  } | null;
  isLoadingQuote: boolean;
  isSubmitting: boolean;
  error: string;
}

interface GameAppProps {
  user: {
    email: string;
    name: string;
    isMaster: boolean;
  };
  onSignOut: () => Promise<void>;
  signOutError: string;
}

function isCityErrorResponse(body: unknown): body is { error: string; [key: string]: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    'error' in body &&
    typeof body.error === 'string'
  );
}

async function cityRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init?.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let error = 'Não foi possível concluir a operação da cidade.';
    let errorCode = '';
    try {
      const body: unknown = await response.json();
      if (isCityErrorResponse(body)) {
        errorCode = body.error;
        if (body.error === 'map_bounds') {
          error = path.startsWith('/api/residential-buildings')
            ? 'A residência precisa caber inteira dentro do mapa.'
            : 'A área municipal precisa caber inteira dentro do mapa.';
        } else if (body.error === 'water') {
          error = 'A construção só pode ser colocada em terra.';
        } else if (body.error === 'not_on_water') {
          error = 'O Pesqueiro precisa ter pelo menos um tile sobre a água.';
        } else if (body.error === 'not_adjacent_to_water') {
          error = 'A Coleta de Sal precisa ficar ao lado de um tile de água.';
        } else if (body.error === 'building_overlap') {
          error = 'Esse local já está ocupado por outra construção.';
        } else if (body.error === 'municipal_area_overlap') {
          error = 'A área municipal sobrepõe outra cidade.';
        } else if (body.error === 'outside_municipality') {
          error = path.startsWith('/api/residential-buildings')
            ? 'A residência precisa ficar dentro da área municipal.'
            : 'A estrada só pode ser construída dentro de uma área municipal.';
        } else if (body.error === 'path_too_long') {
          error = 'O trajeto pode ter no máximo 600 tiles. Faça estradas menores.';
        } else if (body.error === 'invalid_road') {
          error = 'O trajeto enviado não é válido.';
        } else if (body.error === 'master_required') {
          error = 'Somente a conta master pode gerenciar estruturas da prefeitura.';
        } else if (body.error === 'city_not_owned') {
          error = 'Você só pode demolir construções que criou.';
        } else if (body.error === 'city_not_found') {
          error = 'Essa cidade não existe mais.';
        } else if (body.error === 'invalid_city') {
          error = 'Essa cidade é inválida.';
        } else if (body.error === 'invalid_minimum_wage') {
          error = 'O salário mínimo deve ficar entre C$ 1 e C$ 100.000, com até 2 casas decimais.';
        } else if (body.error === 'minimum_wage_update_unavailable') {
          error = 'Não foi possível atualizar o salário mínimo da cidade.';
        } else if (body.error === 'wage_below_minimum') {
          error = 'O salário ofertado não pode ser menor que o salário mínimo da cidade.';
        } else if (body.error === 'invalid_zones') {
          error = 'As regiões enviadas são inválidas.';
        } else if (body.error === 'zone_outside_municipality') {
          error = 'As regiões precisam ficar dentro da área municipal.';
        } else if (body.error === 'zone_overlap') {
          error = 'Áreas urbanas e rurais não podem se sobrepor.';
        } else if (body.error === 'road_not_owned') {
          error = 'Você só pode demolir estradas que construiu.';
        } else if (body.error === 'road_not_found') {
          error = 'Essa estrada não existe mais.';
        } else if (body.error === 'residence_not_owned') {
          error = 'Você só pode demolir residências que construiu.';
        } else if (body.error === 'residence_not_found') {
          error = 'Essa residência não existe mais.';
        } else if (body.error === 'outside_urban_zone') {
          error = 'Cada tile da construção precisa estar coberto por uma ou mais áreas urbanas.';
        } else if (body.error === 'outside_rural_zone') {
          error = 'Cada tile da construção precisa estar coberto por uma ou mais áreas rurais.';
        } else if (body.error === 'residence_outside_municipality') {
          error = 'A construção precisa ficar dentro da área municipal.';
        } else if (body.error === 'not_adjacent_to_road') {
          error = 'A construção precisa ficar ao lado de uma estrada.';
        } else if (body.error === 'road_overlap') {
          error = 'A construção não pode ocupar o espaço de uma estrada.';
        } else if (body.error === 'invalid_residence') {
          error = 'A construção ou o local escolhido é inválido.';
        } else if (body.error === 'insufficient_materials') {
          error = `Estoque próximo insuficiente de Madeira, Pedra, Ferro e/ou Aço. Os materiais devem estar em armazéns concluídos a até ${LINK_RADIUS} tiles da construção.`;
        } else if (body.error === 'invalid_work_settings') {
          error = `Informe funcionários desejados (até o máximo da construção), salário (C$ 0 a C$ ${MAX_WAGE.toLocaleString('pt-BR')}, com até 2 casas decimais) e carga horária de ${MIN_WORK_HOURS} a ${MAX_WORK_HOURS} horas.`;
        } else if (body.error === 'harvest_in_progress') {
          error = 'A colheita está em andamento; só é possível plantar de novo ao terminar.';
        } else if (body.error === 'cannot_plant') {
          error = 'Somente fazendas agrícolas concluídas podem plantar.';
        } else if (body.error === 'invalid_farm_automation') {
          error = 'Confira os meses selecionados e mantenha os funcionários entre zero e o limite da fazenda.';
        } else if (body.error === 'invalid_warehouse_link') {
          error = 'Essa construção não pode ser ligada a esse destino.';
        } else if (body.error === 'warehouse_out_of_range') {
          error = `O armazém precisa estar a até ${LINK_RADIUS} tiles da construção.`;
        } else if (body.error === 'warehouse_not_owned') {
          error = 'Você só pode ligar a armazéns que construiu.';
        } else if (body.error === 'invalid_price') {
          error = 'O preço deve ser de C$ 0,01 a C$ 100.000, com até 2 casas decimais.';
        } else if (body.error === 'invalid_rent') {
          error = 'O aluguel deve ser de C$ 0,01 a C$ 100.000, com até 2 casas decimais.';
        } else if (body.error === 'invalid_warehouse_setting') {
          error = 'Informe estoques desejáveis inteiros (0 a 1.000.000), valor entre C$ 0 e C$ 1.000.000 com até 2 casas decimais e o tipo venda/compra.';
        } else if (body.error === 'not_a_warehouse') {
          error = 'Essa construção não é um armazém concluído.';
        } else if (body.error === 'invalid_transfer_request') {
          error = 'Os dados da transferência são inválidos.';
        } else if (body.error === 'transfer_building_not_found') {
          error = 'A construção de origem ou destino não existe mais.';
        } else if (body.error === 'transfer_building_not_owned') {
          error = 'A origem e o destino da transferência precisam pertencer a você.';
        } else if (body.error === 'transfer_source_not_warehouse') {
          error = 'A construção de origem precisa ser um armazém concluído.';
        } else if (body.error === 'transfer_destination_not_completed') {
          error = 'A construção de destino precisa estar concluída.';
        } else if (body.error === 'transfer_out_of_range') {
          error = `O destino precisa estar a até ${LINK_RADIUS} tiles do armazém.`;
        } else if (body.error === 'transfer_product_not_storable') {
          error = 'Essa construção não armazena esse produto.';
        } else if (body.error === 'transfer_limit_exceeded') {
          error = 'O limite mudou. Confira o estoque, o espaço e os Work Points disponíveis.';
        } else if (body.error === 'transfer_destination_full') {
          error = 'Não há espaço suficiente no estoque do destino.';
        } else if (body.error === 'transfer_stock_changed') {
          error = 'O estoque de origem mudou antes da transferência.';
        } else if (body.error === 'transfer_unavailable') {
          if (
            typeof body.reason === 'string' ||
            typeof body.failureStage === 'string' ||
            typeof body.failureReference === 'string'
          ) {
            const failureReasons: Record<string, string> = {
              concurrent_change: 'Outra operação alterou os dados ao mesmo tempo; atualize os estoques e tente novamente.',
              database_constraint: 'O banco de dados recusou uma gravação por uma regra de integridade.',
              database_unavailable: 'O banco de dados ficou indisponível durante a operação.',
              unexpected_failure: 'Ocorreu uma falha inesperada no servidor.',
            };
            const failureStages: Record<string, string> = {
              connecting_to_database: 'conectar ao banco de dados',
              beginning_transaction: 'iniciar a operação',
              acquiring_world_lock: 'reservar o estado do mundo',
              rechecking_transfer_limits: 'validar novamente os limites',
              removing_product_from_source: 'retirar o produto da origem',
              adding_product_to_destination: 'adicionar o produto ao destino',
              recording_transfer_history: 'registrar o histórico da transferência',
              registering_transport_work_points: 'registrar o custo de transporte',
              committing_transaction: 'confirmar as alterações',
            };
            const reason =
              typeof body.reason === 'string'
                ? failureReasons[body.reason] ?? failureReasons.unexpected_failure
                : failureReasons.unexpected_failure;
            const stage =
              typeof body.failureStage === 'string'
                ? failureStages[body.failureStage] ?? 'uma etapa não identificada'
                : 'uma etapa não identificada';
            const reference =
              typeof body.failureReference === 'string' ? body.failureReference : null;
            error = `${reason} Etapa: ${stage}.${reference ? ` Código de diagnóstico: ${reference}.` : ''}`;
          } else {
            error = 'Não foi possível processar a transferência agora. Tente novamente.';
          }
        } else if (body.error === 'building_already_complete') {
          error = 'Essa construção já foi concluída.';
        } else if (body.error === 'building_not_found') {
          error = 'Essa construção não existe mais.';
        }
      }
    } catch (parseError) {
      console.error('Não foi possível ler a resposta da cidade:', parseError);
    }
    throw new CityRequestError(error, errorCode);
  }
  return (await response.json()) as T;
}

class CityRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CityRequestError';
  }
}

function useWorldClock(snapshot: WorldSnapshot | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (!snapshot) return null;
  const elapsed = Math.max(0, now - Date.parse(snapshot.serverTime));
  return new Date(Date.parse(snapshot.worldTime) + elapsed * snapshot.timeScale);
}

export default function GameApp({ user, onSignOut, signOutError }: GameAppProps) {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [cities, setCities] = useState<CityAssembly[]>([]);
  const [roads, setRoads] = useState<RoadTile[]>([]);
  const [residentialBuildings, setResidentialBuildings] = useState<ResidentialBuilding[]>([]);
  const [pendingResidentialBuildings, setPendingResidentialBuildings] = useState<ResidentialBuilding[]>([]);
  const [pendingResidentialDemolitionIds, setPendingResidentialDemolitionIds] = useState<string[]>([]);
  const [pendingCities, setPendingCities] = useState<CityAssembly[]>([]);
  const [pendingRoads, setPendingRoads] = useState<RoadTile[]>([]);
  const [pendingRoadDemolitionKeys, setPendingRoadDemolitionKeys] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<ConstructionCategory | null>(null);
  const [isProductCatalogOpen, setIsProductCatalogOpen] = useState(false);
  const [isDemolitionMode, setIsDemolitionMode] = useState(false);
  const [demolitionMessage, setDemolitionMessage] = useState('');
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [isCreatingCity, setIsCreatingCity] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CityAssembly | null>(null);
  const [cityName, setCityName] = useState('');
  const [cityError, setCityError] = useState('');
  const [isCitySaving, setIsCitySaving] = useState(false);
  const [zoneEditorCityId, setZoneEditorCityId] = useState<string | null>(null);
  const [zoneDrawingType, setZoneDrawingType] = useState<CityZoneType | null>(null);
  const [zoneEditorError, setZoneEditorError] = useState('');
  const [isSavingZones, setIsSavingZones] = useState(false);
  const [isPlacingCity, setIsPlacingCity] = useState(false);
  const [residencePlacementType, setResidencePlacementType] = useState<ResidenceType | null>(null);
  const [residencePlacementMessage, setResidencePlacementMessage] = useState('');
  const [constructionMessage, setConstructionMessage] = useState('');
  const [cityPlacementMessage, setCityPlacementMessage] = useState('');
  const [isPlacingRoads, setIsPlacingRoads] = useState(false);
  const [roadPlacementMessage, setRoadPlacementMessage] = useState('');
  const [camera, setCamera] = useState(() => {
    const zoom = 0.14;
    const mapViewportWidth = Math.max(320, window.innerWidth);
    return {
      x: mapViewportWidth / 2 - SPAWN.x * BASE_TILE_SIZE * zoom,
      y: window.innerHeight / 2 - SPAWN.y * BASE_TILE_SIZE * zoom,
      zoom,
    };
  });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const worldStageRef = useRef<HTMLElement | null>(null);
  const localResourceRequestRef = useRef(0);
  const [hoveredTile, setHoveredTile] = useState<TileInfo | null>(null);
  const [selectedTile, setSelectedTile] = useState<TileInfo | null>(null);
  const [selectedResidenceId, setSelectedResidenceId] = useState<string | null>(null);
  const [residenceBenefit, setResidenceBenefit] = useState<ResidenceBenefitCalculation | null>(null);
  const selectedResidenceIdRef = useRef(selectedResidenceId);
  selectedResidenceIdRef.current = selectedResidenceId;
  const [isResidenceOwner, setIsResidenceOwner] = useState(false);
  const [isSavingWorkSettings, setIsSavingWorkSettings] = useState(false);
  const [workSettingsError, setWorkSettingsError] = useState('');
  const [isWarehouseOpen, setIsWarehouseOpen] = useState(false);
  const [warehouseSettings, setWarehouseSettings] = useState<Map<string, WarehouseProductSetting>>(new Map());
  const [warehouseError, setWarehouseError] = useState('');
  const [warehouseStock, setWarehouseStock] = useState<Map<string, number>>(new Map());
  const [warehouseAveragePrices, setWarehouseAveragePrices] = useState<Map<string, number>>(new Map());
  const [warehouseStockLoaded, setWarehouseStockLoaded] = useState(false);
  const [warehouseDemand, setWarehouseDemand] = useState<WarehouseDemand | null>(null);
  const [isSearchingSuppliers, setIsSearchingSuppliers] = useState(false);
  const [warehouseSupplierMessage, setWarehouseSupplierMessage] = useState('');
  const [warehouseTransfer, setWarehouseTransfer] = useState<WarehouseTransferFlow | null>(null);
  const [localResources, setLocalResources] = useState<{ wood: number; stone: number } | null>(null);
  const [isConsumptionOpen, setIsConsumptionOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyDays, setHistoryDays] = useState<ProductionDay[]>([]);
  const [isCommerceHistoryOpen, setIsCommerceHistoryOpen] = useState(false);
  const [isCommerceHistoryLoading, setIsCommerceHistoryLoading] = useState(false);
  const [commerceHistoryError, setCommerceHistoryError] = useState('');
  const [commerceDiagnosticsStorageError, setCommerceDiagnosticsStorageError] = useState('');
  const [commerceHistoryDays, setCommerceHistoryDays] = useState<CommerceDay[]>([]);
  const [isWarehouseLogOpen, setIsWarehouseLogOpen] = useState(false);
  const [isWarehouseLogLoading, setIsWarehouseLogLoading] = useState(false);
  const [warehouseLogError, setWarehouseLogError] = useState('');
  const [warehouseLogDays, setWarehouseLogDays] = useState<WarehouseLogDay[]>([]);
  const [warehouseLogEvents, setWarehouseLogEvents] = useState<WarehouseLogEvent[]>([]);
  const [isAccountingOpen, setIsAccountingOpen] = useState(false);
  const [isAccountingLoading, setIsAccountingLoading] = useState(false);
  const [accountingError, setAccountingError] = useState('');
  const [accountingSummary, setAccountingSummary] = useState<AccountingSummary | null>(null);
  const [accountingPeriodDays, setAccountingPeriodDays] = useState<AccountingPeriodDays>(30);
  const [accountingWeekOffset, setAccountingWeekOffset] = useState<AccountingWeekOffset>(0);
  const [isPerformanceLogOpen, setIsPerformanceLogOpen] = useState(false);
  const [isPerformanceLogLoading, setIsPerformanceLogLoading] = useState(false);
  const [performanceLogError, setPerformanceLogError] = useState('');
  const [performanceLogs, setPerformanceLogs] = useState<PerformanceLogRecord[]>([]);
  const [isConsumptionLoading, setIsConsumptionLoading] = useState(false);
  const [consumptionError, setConsumptionError] = useState('');
  const [consumption, setConsumption] = useState<Map<string, ProductConsumption>>(new Map());
  const [consumptionScope, setConsumptionScope] = useState<'RESIDÊNCIA' | 'CIDADE'>('RESIDÊNCIA');
  const [consumptionTitle, setConsumptionTitle] = useState('Consumo da casa');
  const [returnToCityAfterConsumption, setReturnToCityAfterConsumption] = useState(false);
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [showInfluence, setShowInfluence] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const gameTime = useWorldClock(snapshot);
  const [isMasterPanelOpen, setIsMasterPanelOpen] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [isMasterBusy, setIsMasterBusy] = useState(false);
  const [masterError, setMasterError] = useState('');
  const [masterMessage, setMasterMessage] = useState('');

  const refreshOnlinePlayers = () => {
    setIsLoadingPlayers(true);
    cityRequest<{ players: OnlinePlayer[] }>('/api/master/online-players')
      .then((result) => setOnlinePlayers(result.players))
      .catch((error: unknown) => setMasterError(error instanceof Error ? error.message : 'Falha ao listar jogadores.'))
      .finally(() => setIsLoadingPlayers(false));
  };

  const runMasterCommand = async (action: () => Promise<string>) => {
    setIsMasterBusy(true);
    setMasterError('');
    setMasterMessage('');
    try {
      setMasterMessage(await action());
    } catch (error: unknown) {
      setMasterError(error instanceof Error ? error.message : 'Não foi possível executar o comando.');
    } finally {
      setIsMasterBusy(false);
    }
  };

  const changeTimeScale = (timeScale: number) =>
    void runMasterCommand(async () => {
      await cityRequest<{ timeScale: number }>('/api/master/time-scale', {
        method: 'POST',
        body: JSON.stringify({ timeScale }),
      });
      return `Velocidade alterada para 1:${timeScale}.`;
    });

  const grantMoney = (amount: number) =>
    void runMasterCommand(async () => {
      const wallet = await cityRequest<{ balance: number }>('/api/master/grant-money', {
        method: 'POST',
        body: JSON.stringify({ amount }),
      });
      setBalance(wallet.balance);
      return `${formatMoney(amount)} adicionados à sua conta.`;
    });

  useEffect(() => {
    let cancelled = false;
    const loadBalance = () =>
      cityRequest<{ balance: number }>('/api/wallet')
        .then((wallet) => {
          if (!cancelled && Number.isFinite(wallet.balance)) setBalance(wallet.balance);
        })
        .catch((error: unknown) => console.error('Não foi possível carregar o dinheiro:', error));
    void loadBalance();
    const timer = window.setInterval(() => void loadBalance(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const refreshLocalResources = useCallback(async () => {
    const requestId = ++localResourceRequestRef.current;
    const stage = worldStageRef.current;
    const width = stage?.clientWidth ?? viewport.width;
    const height = stage?.clientHeight ?? viewport.height;
    const scale = BASE_TILE_SIZE * camera.zoom;
    const x = Math.max(0, Math.min(WORLD_CONFIG.width - 1, Math.floor((width / 2 - camera.x) / scale)));
    const y = Math.max(0, Math.min(WORLD_CONFIG.height - 1, Math.floor((height / 2 - camera.y) / scale)));
    try {
      const resources = await cityRequest<{ wood: number; stone: number }>(
        `/api/player/resources?${new URLSearchParams({ x: String(x), y: String(y) })}`,
      );
      if (requestId === localResourceRequestRef.current) setLocalResources(resources);
    } catch (error) {
      console.error('Não foi possível carregar madeira e pedra próximas:', error);
    }
  }, [camera, viewport]);

  useEffect(() => {
    const debounce = window.setTimeout(() => void refreshLocalResources(), 300);
    const interval = window.setInterval(() => void refreshLocalResources(), 30000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(interval);
    };
  }, [refreshLocalResources]);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return connectToWorld(
      setSnapshot,
      setIsOnline,
      setCities,
      setRoads,
      setResidentialBuildings,
      (update) => {
        try {
          saveCommerceDiagnostics(window.localStorage, user.email, update);
          setCommerceDiagnosticsStorageError('');
          setCommerceHistoryDays((current) =>
            current.map((item) =>
              item.day === update.day && selectedResidenceIdRef.current === update.buildingId
                ? { ...item, transactions: update.transactions }
                : item,
            ),
          );
        } catch (error) {
          console.error('Não foi possível salvar o cálculo da demanda neste navegador:', error);
          setCommerceDiagnosticsStorageError(
            'Não foi possível salvar o cálculo da demanda neste navegador. Verifique o espaço disponível.',
          );
        }
      },
    );
  }, [user.email]);

  const visibleCities = useMemo(() => {
    const byPosition = new Map(
      pendingCities.map((city) => [`${city.centerX},${city.centerY}`, city]),
    );
    for (const city of cities) {
      byPosition.set(`${city.centerX},${city.centerY}`, city);
    }
    return [...byPosition.values()];
  }, [cities, pendingCities]);
  useEffect(() => {
    if (!selectedCity) return;
    const updatedCity = cities.find((city) => city.id === selectedCity.id);
    if (updatedCity) setSelectedCity(updatedCity);
  }, [cities, selectedCity?.id]);
  const cityZoneEditorCity = zoneEditorCityId
    ? visibleCities.find((city) => city.id === zoneEditorCityId) ?? null
    : null;
  const zoneOverlay = zoneEditorCityId
    ? 'all'
    : activeCategory
      ? getRequiredCityZone(activeCategory)
      : null;
  const activeZoneCount = zoneOverlay
    ? visibleCities.reduce(
        (count, city) => count + city.zones.filter((zone) => zone.type === zoneOverlay).length,
        0,
      )
    : 0;
  const visibleRoads = useMemo(() => {
    const byPosition = new Map(roads.map((road) => [`${road.x},${road.y}`, road]));
    for (const road of pendingRoads) {
      const key = `${road.x},${road.y}`;
      if (!byPosition.has(key)) byPosition.set(key, road);
    }
    const pendingDemolitions = new Set(pendingRoadDemolitionKeys);
    return [...byPosition.values()].filter(
      (road) => !pendingDemolitions.has(`${road.x},${road.y}`),
    );
  }, [pendingRoadDemolitionKeys, pendingRoads, roads]);
  const visibleResidentialBuildings = useMemo(() => {
    const byId = new Map(residentialBuildings.map((building) => [building.id, building]));
    for (const building of pendingResidentialBuildings) {
      if (!byId.has(building.id)) byId.set(building.id, building);
    }
    const pendingDemolitions = new Set(pendingResidentialDemolitionIds);
    return [...byId.values()].filter((building) => !pendingDemolitions.has(building.id));
  }, [pendingResidentialBuildings, pendingResidentialDemolitionIds, residentialBuildings]);

  const mapPosition = useMemo(() => selectedTile ?? hoveredTile, [selectedTile, hoveredTile]);
  const selectedResidence = selectedResidenceId
    ? visibleResidentialBuildings.find((building) => building.id === selectedResidenceId) ?? null
    : null;
  const selectedResidenceMinimumWage = selectedResidence
    ? cities.find((city) => city.id === selectedResidence.cityId)?.minimumWage ?? 1
    : 1;
  const selectedResidenceKey = selectedResidence && !selectedResidence.id.startsWith('pending-')
    ? selectedResidence.id
    : null;

  useEffect(() => {
    setResidenceBenefit(null);
    if (!selectedResidenceKey || selectedResidence?.status !== 'completed' ||
        RESIDENCES[selectedResidence.type].kind !== 'residence') return;
    let cancelled = false;
    cityRequest<ResidenceBenefitCalculation>(
      `/api/residential-buildings/${selectedResidenceKey}/residence-benefit`,
    )
      .then((calculation) => {
        if (!cancelled) setResidenceBenefit(calculation);
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o benefício da residência:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResidence?.status, selectedResidence?.type, selectedResidenceKey]);

  useEffect(() => {
    setIsResidenceOwner(false);
    setWorkSettingsError('');
    if (!selectedResidenceKey) return;
    let cancelled = false;
    cityRequest<{ isOwner: boolean }>(`/api/residential-buildings/${selectedResidenceKey}/ownership`)
      .then((result) => {
        if (!cancelled) setIsResidenceOwner(result.isOwner);
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o dono da construção:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResidenceKey]);

  useEffect(() => {
    setIsWarehouseOpen(false);
    setWarehouseError('');
    setWarehouseSettings(new Map());
    setWarehouseStock(new Map());
    setWarehouseAveragePrices(new Map());
    setWarehouseStockLoaded(false);
    setWarehouseDemand(null);
    setWarehouseSupplierMessage('');
    setIsConsumptionOpen(false);
    setConsumptionError('');
    setConsumption(new Map());
    setIsHistoryOpen(false);
    setHistoryError('');
    setHistoryDays([]);
    setIsCommerceHistoryOpen(false);
    setCommerceHistoryError('');
    setCommerceHistoryDays([]);
    setIsWarehouseLogOpen(false);
    setWarehouseLogError('');
    setWarehouseLogDays([]);
    setWarehouseLogEvents([]);
  }, [selectedResidenceKey]);

  const openWarehouseLog = async (buildingId: string) => {
    setIsWarehouseLogOpen(true);
    setIsWarehouseLogLoading(true);
    setWarehouseLogError('');
    try {
      const result = await cityRequest<{ days: WarehouseLogDay[]; events: WarehouseLogEvent[] }>(
        `/api/residential-buildings/${buildingId}/warehouse-log`,
      );
      setWarehouseLogDays(result.days);
      setWarehouseLogEvents(result.events);
    } catch (error) {
      setWarehouseLogError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setIsWarehouseLogLoading(false);
    }
  };

  const openProductionHistory = async (buildingId: string) => {
    setIsHistoryOpen(true);
    setIsHistoryLoading(true);
    setHistoryError('');
    try {
      const result = await cityRequest<{ days: ProductionDay[] }>(
        `/api/residential-buildings/${buildingId}/production-history`,
      );
      setHistoryDays(result.days);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openCommerceHistory = async (buildingId: string) => {
    setIsCommerceHistoryOpen(true);
    setIsCommerceHistoryLoading(true);
    setCommerceHistoryError('');
    try {
      const result = await cityRequest<{ days: CommerceDay[] }>(
        `/api/residential-buildings/${buildingId}/commerce-history`,
      );
      const localDiagnostics = loadCommerceDiagnostics(window.localStorage, user.email, buildingId);
      setCommerceHistoryDays(
        result.days.map((item) => ({
          ...item,
          transactions: localDiagnostics.get(item.day) ?? item.transactions,
        })),
      );
    } catch (error) {
      setCommerceHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.');
    } finally {
      setIsCommerceHistoryLoading(false);
    }
  };

  const loadAccounting = async (
    periodDays: AccountingPeriodDays = accountingPeriodDays,
    weekOffset: AccountingWeekOffset = accountingWeekOffset,
  ) => {
    setIsAccountingOpen(true);
    setIsAccountingLoading(true);
    setAccountingError('');
    setAccountingSummary(null);
    try {
      setAccountingSummary(
        await cityRequest<AccountingSummary>(
          `/api/accounting?days=${periodDays}&week=${weekOffset}`,
        ),
      );
    } catch (error) {
      setAccountingError(error instanceof Error ? error.message : 'Não foi possível carregar o painel contábil.');
    } finally {
      setIsAccountingLoading(false);
    }
  };

  const loadPerformanceLogs = async () => {
    setIsPerformanceLogLoading(true);
    setPerformanceLogError('');
    try {
      const result = await cityRequest<{ logs: PerformanceLogRecord[] }>('/api/performance-logs');
      setPerformanceLogs(result.logs);
    } catch (error) {
      setPerformanceLogError(error instanceof Error ? error.message : 'Não foi possível carregar os logs.');
    } finally {
      setIsPerformanceLogLoading(false);
    }
  };

  const togglePerformanceLogs = () => {
    const shouldOpen = !isPerformanceLogOpen;
    setIsAccountingOpen(false);
    setIsMasterPanelOpen(false);
    setIsPerformanceLogOpen(shouldOpen);
    if (shouldOpen) void loadPerformanceLogs();
  };

  const toggleAccounting = () => {
    closeCityZoneEditor();
    setActiveCategory(null);
    setIsProductCatalogOpen(false);
    setIsDemolitionMode(false);
    setDemolitionMessage('');
    setIsPlacingCity(false);
    setIsPlacingRoads(false);
    setResidencePlacementType(null);
    setResidencePlacementMessage('');
    setRoadPlacementMessage('');
    if (isAccountingOpen) {
      setIsAccountingOpen(false);
    } else {
      void loadAccounting();
    }
  };

  const viewAccountingBuilding = (position: AccountingBuildingPosition) => {
    const building = visibleResidentialBuildings.find((item) => item.id === position.id);
    if (!building) {
      setAccountingError('Essa construção não está disponível no mapa. Atualize a página e tente novamente.');
      return;
    }
    const stage = worldStageRef.current;
    if (stage) {
      const { width, height } = RESIDENCES[building.type];
      const tilePixels = BASE_TILE_SIZE * camera.zoom;
      setCamera({
        x: stage.clientWidth / 2 - (building.x + width / 2) * tilePixels,
        y: stage.clientHeight / 2 - (building.y + height / 2) * tilePixels,
        zoom: camera.zoom,
      });
    }
    setSelectedTile(null);
    setHoveredTile(null);
    setSelectedResidenceId(building.id);
    setIsAccountingOpen(false);
  };

  const openConsumption = async (buildingId: string) => {
    setReturnToCityAfterConsumption(false);
    setConsumptionScope('RESIDÊNCIA');
    setConsumptionTitle('Consumo da casa');
    setIsConsumptionOpen(true);
    setIsConsumptionLoading(true);
    setConsumptionError('');
    try {
      const result = await cityRequest<{ products: ProductConsumption[] }>(
        `/api/residential-buildings/${buildingId}/consumption`,
      );
      setConsumption(new Map(result.products.map((item) => [item.productId, item])));
    } catch (error) {
      setConsumptionError(error instanceof Error ? error.message : 'Não foi possível carregar o consumo.');
    } finally {
      setIsConsumptionLoading(false);
    }
  };

  const openCityConsumption = async (city: CityAssembly) => {
    setIsCityModalOpen(false);
    setReturnToCityAfterConsumption(true);
    setConsumptionScope('CIDADE');
    setConsumptionTitle(`Consumo médio: ${city.name}`);
    setIsConsumptionOpen(true);
    setIsConsumptionLoading(true);
    setConsumptionError('');
    try {
      const result = await cityRequest<{ products: ProductConsumption[] }>(
        `/api/cities/${city.id}/consumption`,
      );
      setConsumption(new Map(result.products.map((item) => [item.productId, item])));
    } catch (error) {
      setConsumptionError(error instanceof Error ? error.message : 'Não foi possível carregar o consumo da cidade.');
    } finally {
      setIsConsumptionLoading(false);
    }
  };

  const closeConsumption = () => {
    setIsConsumptionOpen(false);
    if (returnToCityAfterConsumption) {
      setIsCityModalOpen(true);
      setReturnToCityAfterConsumption(false);
    }
  };

  const refreshWarehouse = async (buildingId: string, includeSettings = false): Promise<boolean> => {
    try {
      const result = await cityRequest<{
        settings: WarehouseProductSetting[];
        stock: { productId: string; quantity: number }[];
        averagePrices: { productId: string; averagePrice: number }[];
        demand: WarehouseDemand;
      }>(`/api/residential-buildings/${buildingId}/warehouse`);
      setWarehouseDemand(result.demand);
      if (includeSettings) {
        setWarehouseSettings(new Map(result.settings.map((setting) => [setting.productId, setting])));
      }
      setWarehouseStock(new Map(result.stock.map((item) => [item.productId, item.quantity])));
      setWarehouseAveragePrices(
        new Map(result.averagePrices.map((item) => [item.productId, item.averagePrice])),
      );
      setWarehouseStockLoaded(true);
      setWarehouseError('');
      return true;
    } catch (error) {
      setWarehouseError(error instanceof Error ? error.message : 'Não foi possível carregar o armazém.');
      return false;
    }
  };

  const searchWarehouseSuppliers = async (buildingId: string) => {
    setIsSearchingSuppliers(true);
    setWarehouseError('');
    setWarehouseSupplierMessage('');
    try {
      const result = await cityRequest<{
        trades: { productId: string; quantity: number }[];
      }>(`/api/residential-buildings/${buildingId}/warehouse/suppliers`, { method: 'POST' });
      setWarehouseSupplierMessage(
        result.trades.length
          ? `${result.trades.length} compra(s) realizada(s); estoque atualizado.`
          : 'Nenhum fornecedor elegível ou nenhuma necessidade de compra no momento.',
      );
      const refreshed = await refreshWarehouse(buildingId);
      if (!refreshed) {
        setWarehouseSupplierMessage('Compra processada; não foi possível atualizar o estoque exibido.');
      }
      await refreshLocalResources();
      try {
        const wallet = await cityRequest<{ balance: number }>('/api/wallet');
        setBalance(wallet.balance);
      } catch (error) {
        console.error('A compra foi concluída, mas não foi possível atualizar o saldo exibido:', error);
      }
    } catch (error) {
      setWarehouseError(error instanceof Error ? error.message : 'Não foi possível procurar fornecedores.');
    } finally {
      setIsSearchingSuppliers(false);
    }
  };

  const refreshWarehouseRef = useRef(refreshWarehouse);
  useEffect(() => {
    refreshWarehouseRef.current = refreshWarehouse;
  }, [refreshWarehouse]);

  useEffect(() => {
    if (selectedResidenceKey && selectedResidence && isStorageBuilding(selectedResidence.type)) {
      void refreshWarehouseRef.current(selectedResidenceKey);
    }
  }, [selectedResidenceKey, selectedResidence?.type]);

  useEffect(() => {
    if (
      !selectedResidenceKey ||
      !selectedResidence ||
      !isStorageBuilding(selectedResidence.type) ||
      !warehouseStockLoaded
    ) return;
    const timer = window.setInterval(() => {
      void refreshWarehouseRef.current(selectedResidenceKey);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [selectedResidenceKey, selectedResidence?.type, warehouseStockLoaded]);

  const openWarehouse = async (buildingId: string) => {
    setIsWarehouseOpen(true);
    setWarehouseError('');
    setWarehouseSupplierMessage('');
    await refreshWarehouse(buildingId, true);
  };

  const saveWarehouseSetting = async (buildingId: string, setting: WarehouseProductSetting) => {
    setIsSavingWorkSettings(true);
    setWarehouseError('');
    try {
      const saved = await cityRequest<WarehouseProductSetting>(
        `/api/residential-buildings/${buildingId}/warehouse`,
        { method: 'PUT', body: JSON.stringify(setting) },
      );
      setWarehouseSettings((current) => new Map(current).set(saved.productId, saved));
    } catch (error) {
      setWarehouseError(error instanceof Error ? error.message : 'Não foi possível salvar o produto.');
    } finally {
      setIsSavingWorkSettings(false);
    }
  };

  const linkWarehouse = async (
    buildingId: string,
    warehouseId: string | null,
    linked = true,
  ) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      await cityRequest<ResidentialBuilding>(`/api/residential-buildings/${buildingId}/warehouse-link`, {
        method: 'PUT',
        body: JSON.stringify({ warehouseId, linked }),
      });
    } catch (error) {
      setWorkSettingsError(error instanceof Error ? error.message : 'Não foi possível atualizar o vínculo.');
    } finally {
      setLinkingFromId(null);
      setIsSavingWorkSettings(false);
    }
  };

  const plantCrop = async (buildingId: string) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      await cityRequest<ResidentialBuilding>(`/api/residential-buildings/${buildingId}/plant`, {
        method: 'POST',
      });
    } catch (error) {
      setWorkSettingsError(error instanceof Error ? error.message : 'Não foi possível plantar.');
    } finally {
      setIsSavingWorkSettings(false);
    }
  };

  const saveFarmAutomation = async (buildingId: string, settings: FarmAutomationSettings) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/farm-automation`,
        { method: 'PUT', body: JSON.stringify(settings) },
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar a automação da fazenda.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };

  const beginWarehouseTransfer = (sourceId: string, productId: string) => {
    setIsWarehouseOpen(false);
    setSelectedResidenceId(null);
    setWarehouseTransfer({
      sourceId,
      productId,
      destination: null,
      quote: null,
      isLoadingQuote: false,
      isSubmitting: false,
      error: '',
    });
  };

  const chooseWarehouseTransferDestination = async (
    transfer: WarehouseTransferFlow,
    destination: ResidentialBuilding,
  ) => {
    setSelectedResidenceId(destination.id);
    setWarehouseTransfer((current) =>
      current?.sourceId === transfer.sourceId && current.productId === transfer.productId
        ? { ...current, destination, quote: null, isLoadingQuote: true, error: '' }
        : current,
    );
    try {
      const query = new URLSearchParams({
        destinationId: destination.id,
        productId: transfer.productId,
      });
      const quote = await cityRequest<NonNullable<WarehouseTransferFlow['quote']>>(
        `/api/residential-buildings/${transfer.sourceId}/warehouse-transfer-quote?${query}`,
      );
      setWarehouseTransfer((current) =>
        current?.sourceId === transfer.sourceId &&
        current.productId === transfer.productId &&
        current.destination?.id === destination.id
          ? { ...current, quote, isLoadingQuote: false, error: '' }
          : current,
      );
    } catch (error) {
      setWarehouseTransfer((current) =>
        current?.sourceId === transfer.sourceId && current.productId === transfer.productId
          ? {
              ...current,
              destination: null,
              quote: null,
              isLoadingQuote: false,
              error: error instanceof Error ? error.message : 'Não foi possível verificar esse destino.',
            }
          : current,
      );
    }
  };

  const executeWarehouseTransfer = async (quantity: number) => {
    const destination = warehouseTransfer?.destination;
    if (!warehouseTransfer || !destination) return;
    const transfer = { ...warehouseTransfer, destination };
    setWarehouseTransfer({ ...transfer, isSubmitting: true, error: '' });
    try {
      await cityRequest<{ quantity: number; workPoints: number }>(
        `/api/residential-buildings/${transfer.sourceId}/warehouse-transfer`,
        {
          method: 'POST',
          body: JSON.stringify({
            destinationId: transfer.destination.id,
            productId: transfer.productId,
            quantity,
          }),
        },
      );
      setWarehouseTransfer(null);
      if (isStorageBuilding(transfer.destination.type)) {
        setIsWarehouseOpen(true);
        await refreshWarehouse(transfer.destination.id, true);
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Não foi possível transferir o produto.';
      if (
        error instanceof CityRequestError &&
        (error.code === 'transfer_limit_exceeded' || error.code === 'transfer_stock_changed')
      ) {
        try {
          const query = new URLSearchParams({
            destinationId: transfer.destination.id,
            productId: transfer.productId,
          });
          const quote = await cityRequest<NonNullable<WarehouseTransferFlow['quote']>>(
            `/api/residential-buildings/${transfer.sourceId}/warehouse-transfer-quote?${query}`,
          );
          setWarehouseTransfer({
            ...transfer,
            quote,
            isSubmitting: false,
            error: `${message} O novo limite é ${quote.maxQuantity}.`,
          });
          return;
        } catch (quoteError) {
          message = quoteError instanceof Error ? quoteError.message : message;
        }
      }
      setWarehouseTransfer({ ...transfer, isSubmitting: false, error: message });
    }
  };

  const handleResidenceSelect = (building: ResidentialBuilding) => {
    if (warehouseTransfer) {
      if (warehouseTransfer.destination) return;
      if (building.id === warehouseTransfer.sourceId) {
        setWarehouseTransfer({
          ...warehouseTransfer,
          error: 'Escolha uma construção de destino diferente do armazém de origem.',
        });
        return;
      }
      if (!building.isOwnedByCurrentUser) {
        setWarehouseTransfer({
          ...warehouseTransfer,
          error: 'O destino precisa ser uma construção sua.',
        });
        return;
      }
      if (building.status !== 'completed') {
        setWarehouseTransfer({
          ...warehouseTransfer,
          error: 'O destino precisa estar concluído.',
        });
        return;
      }
      void chooseWarehouseTransferDestination(warehouseTransfer, building);
      return;
    }
    if (linkingFromId && linkingFromId !== building.id) {
      if (!isStorageBuilding(building.type)) {
        setWorkSettingsError('Escolha um armazém ou silo para criar o vínculo.');
        return;
      }
      void linkWarehouse(linkingFromId, building.id);
      return;
    }
    setLinkingFromId(null);
    setSelectedResidenceId(building.id);
  };

  const moveResidentialBuilding = async (buildingId: string, position: RoadPosition) => {
    setConstructionMessage('');
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/position`,
        { method: 'PATCH', body: JSON.stringify(position) },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
      setConstructionMessage('Construção reposicionada pela conta Master.');
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : 'Não foi possível reposicionar a construção.',
      );
    }
  };

  const saveWorkSettings = async (
    buildingId: string,
    settings: { wage: number; workHoursPerDay: number; desiredWorkers: number },
  ) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/work-settings`,
        { method: 'PATCH', body: JSON.stringify(settings) },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar as configurações.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };
  const saveRent = async (buildingId: string, rent: number) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/rent`,
        { method: 'PATCH', body: JSON.stringify({ rent }) },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar o aluguel.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };
  const savePrice = async (buildingId: string, price: number) => {
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/price`,
        { method: 'PATCH', body: JSON.stringify({ price }) },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar o preço.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };
  const saveInputProduct = async (buildingId: string, productId: string) => {
    if (!window.confirm('Trocar a matéria-prima descartará o estoque atual dela. Deseja continuar?')) {
      return;
    }
    setIsSavingWorkSettings(true);
    setWorkSettingsError('');
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/input-product`,
        { method: 'PATCH', body: JSON.stringify({ productId }) },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível trocar a matéria-prima.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };
  const cameraKeys = useRef(new Set<string>());
  useEffect(() => {
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!arrows.includes(event.key) || isTyping(event.target)) return;
      event.preventDefault();
      cameraKeys.current.add(event.key);
    };
    const onKeyUp = (event: KeyboardEvent) => cameraKeys.current.delete(event.key);
    const onBlur = () => cameraKeys.current.clear();
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keys = cameraKeys.current;
      const dx = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
      const dy = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const distance = 700 * seconds;
        setCamera((current) => ({ ...current, x: current.x + dx * distance, y: current.y + dy * distance }));
      }
      frame = requestAnimationFrame(step);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(frame);
    };
  }, []);

  const openNewAssembly = () => {
    closeCityZoneEditor();
    setResidencePlacementType(null);
    setActiveCategory(null);
    setIsPlacingRoads(false);
    setSelectedCity(null);
    setCityName('Nova cidade');
    setCityError('');
    setCityPlacementMessage('');
    setIsCreatingCity(true);
    setIsCityModalOpen(true);
  };

  const openCityDetails = (city: CityAssembly) => {
    closeCityZoneEditor();
    setSelectedCity(city);
    setCityName(city.name);
    setCityError('');
    setIsCreatingCity(false);
    setIsCityModalOpen(true);
  };

  const chooseCityLocation = () => {
    const trimmedName = cityName.trim();
    if (!trimmedName || trimmedName.length > 80) {
      setCityError('Informe um nome com até 80 caracteres.');
      return;
    }
    setCityName(trimmedName);
    setCityError('');
    setCityPlacementMessage('');
    setIsCityModalOpen(false);
    setIsPlacingCity(true);
  };

  const handleCityPlace = async (center: { x: number; y: number }) => {
    if (!user.isMaster) return;
    const pendingCity: CityAssembly = {
      id: `pending-${Date.now()}-${center.x}-${center.y}`,
      name: cityName,
      centerX: center.x,
      centerY: center.y,
      minimumWage: 1,
      population: 0,
      wellbeing: 0,
      economy: 0,
      zones: [],
    };
    setPendingCities((current) => [...current, pendingCity]);
    setIsPlacingCity(false);
    setIsCitySaving(true);
    setCityError('');
    try {
      const city = await cityRequest<CityAssembly>('/api/cities', {
        method: 'POST',
        body: JSON.stringify({ name: cityName, centerX: center.x, centerY: center.y }),
      });
      setCities((current) => [...current.filter((item) => item.id !== city.id), city]);
      setPendingCities((current) => current.filter((item) => item.id !== pendingCity.id));
      setSelectedCity(city);
      setCityName(city.name);
      setIsCreatingCity(false);
      setIsPlacingCity(false);
      setIsCityModalOpen(true);
    } catch (error) {
      setPendingCities((current) => current.filter((item) => item.id !== pendingCity.id));
      if (
        error instanceof CityRequestError &&
        ['map_bounds', 'water', 'building_overlap', 'municipal_area_overlap'].includes(error.code)
      ) {
        setCityPlacementMessage(error.message);
        setIsPlacingCity(true);
      } else {
        setCityError(error instanceof Error ? error.message : 'Não foi possível criar a assembleia.');
        setIsPlacingCity(false);
        setIsCreatingCity(true);
        setIsCityModalOpen(true);
      }
    } finally {
      setIsCitySaving(false);
    }
  };

  const handleInvalidCityPlacement = (reason: CityPlacementError) => {
    const messages: Record<CityPlacementError, string> = {
      map_bounds: 'A área municipal precisa caber inteira dentro do mapa.',
      water: 'A Assembleia só pode ser construída totalmente em terra.',
      building_overlap: 'Esse local já está ocupado por outra construção.',
      municipal_area_overlap: 'A área municipal sobrepõe outra cidade.',
    };
    setCityPlacementMessage(messages[reason]);
  };

  const startRoadPlacement = () => {
    setResidencePlacementType(null);
    setActiveCategory(null);
    setIsPlacingCity(false);
    setRoadPlacementMessage('');
    setIsPlacingRoads(true);
  };

  const handleInvalidRoadPlacement = (reason: RoadPlacementError) => {
    const messages: Record<RoadPlacementError, string> = {
      outside_municipality: 'A estrada só pode ser construída dentro de uma área municipal.',
      water: 'A estrada só pode ser construída em terra.',
      building_overlap: 'A estrada não pode passar sobre outra construção.',
      path_too_long: 'O trajeto pode ter no máximo 600 tiles. Faça estradas menores.',
    };
    setRoadPlacementMessage(messages[reason]);
  };

  const handleRoadPlace = async (path: RoadPosition[]) => {
    const pendingPath = path.map((position) => ({ ...position, cityId: '' }));
    setPendingRoads((current) => {
      const positions = new Set(current.map((road) => `${road.x},${road.y}`));
      return [...current, ...pendingPath.filter((road) => !positions.has(`${road.x},${road.y}`))];
    });
    try {
      const updatedRoads = await cityRequest<RoadTile[]>('/api/roads', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      setRoads(updatedRoads);
      setPendingRoads((current) =>
        current.filter(
          (road) => !path.some((position) => position.x === road.x && position.y === road.y),
        ),
      );
      setRoadPlacementMessage('');
    } catch (error) {
      setPendingRoads((current) =>
        current.filter(
          (road) => !path.some((position) => position.x === road.x && position.y === road.y),
        ),
      );
      setRoadPlacementMessage(
        error instanceof Error ? error.message : 'Não foi possível construir a estrada.',
      );
    }
  };

  const startResidencePlacement = (type: ResidenceType) => {
    closeCityZoneEditor();
    setIsProductCatalogOpen(false);
    setIsDemolitionMode(false);
    setIsPlacingCity(false);
    setIsPlacingRoads(false);
    setActiveCategory(KIND_CATEGORY[RESIDENCES[type].kind]);
    setResidencePlacementType(type);
    setResidencePlacementMessage('');
    setConstructionMessage('');
  };

  const handleInvalidResidencePlacement = (reason: ResidencePlacementError) => {
    const messages: Record<ResidencePlacementError, string> = {
      invalid_residence: 'A residência ou o local escolhido é inválido.',
      map_bounds: 'A residência precisa caber inteira dentro do mapa.',
      outside_municipality: 'A residência precisa ficar dentro da área municipal.',
      outside_urban_zone: 'Cada tile da construção precisa estar coberto por uma ou mais áreas urbanas.',
      outside_rural_zone: 'Cada tile da construção precisa estar coberto por uma ou mais áreas rurais.',
      water: 'A residência só pode ser construída em terra.',
      not_on_water: 'O Pesqueiro precisa ter pelo menos um tile sobre a água.',
      not_adjacent_to_water: 'A Coleta de Sal precisa ficar ao lado de um tile de água.',
      warehouse_out_of_range: `O armazém precisa estar a até ${LINK_RADIUS} tiles da construção.`,
      building_overlap: 'A residência não pode ocupar o espaço de outra construção.',
      road_overlap: 'A residência não pode ocupar o espaço de uma estrada.',
      not_adjacent_to_road: 'A residência precisa ficar ao lado de uma estrada.',
    };
    setResidencePlacementMessage(messages[reason]);
    if (!residencePlacementType) setConstructionMessage(messages[reason]);
  };

  const handleResidencePlace = async (type: ResidenceType, position: RoadPosition) => {
    const buildingNumber =
      Math.max(
        0,
        ...visibleResidentialBuildings
          .filter((building) => building.type === type && building.isOwnedByCurrentUser)
          .map((building) => building.buildingNumber ?? 0),
      ) + 1;
    const pending: ResidentialBuilding = {
      id: `pending-${Date.now()}-${position.x}-${position.y}`,
      type,
      buildingNumber,
      x: position.x,
      y: position.y,
      cityId: '',
      status: 'under_construction',
      startedAt: new Date().toISOString(),
      completedAt: null,
      wage: DEFAULT_WAGE,
      workHoursPerDay: DEFAULT_WORK_HOURS,
      rent: DEFAULT_RENT,
      occupants: 0,
      desiredWorkers: 0,
      workPointsDone: 0,
      price: DEFAULT_SHOP_PRICE,
      stock: 0,
      warehouseIds: [],
      toolStock: 0,
      woodStock: 0,
      ironStock: 0,
      charcoalStock: 0,
      sugarcaneStock: 0,
      inputStocks: {},
      selectedInputProductId: RESIDENCES[type].defaultInputProductId ?? null,
      averageIncome: 0,
      efficiencyPenalty: 0,
      farmAutomation: {
        enabled: false,
        plantingMonths: [],
        plantingWorkers: 0,
        harvestWorkers: 0,
      },
      crop: null,
      employed: 0,
      ownerName: user.name || user.email,
      isOwnedByCurrentUser: true,
    };
    setPendingResidentialBuildings((current) => [...current, pending]);
    setResidencePlacementMessage('');
    setConstructionMessage('');
    try {
      const building = await cityRequest<ResidentialBuilding>('/api/residential-buildings', {
        method: 'POST',
        body: JSON.stringify({ type, ...position }),
      });
      setResidentialBuildings((current) => [
        ...current.filter((item) => item.id !== building.id),
        {
          ...building,
          ownerName: user.name || user.email,
          isOwnedByCurrentUser: true,
        },
      ]);
      setPendingResidentialBuildings((current) =>
        current.filter((item) => item.id !== pending.id),
      );
      void refreshLocalResources();
    } catch (error) {
      setPendingResidentialBuildings((current) =>
        current.filter((item) => item.id !== pending.id),
      );
      setResidencePlacementMessage(
        error instanceof Error ? error.message : 'Não foi possível iniciar a construção.',
      );
    }
  };

  const completeResidence = async (buildingId: string) => {
    if (!user.isMaster) return;
    try {
      const building = await cityRequest<ResidentialBuilding>(
        `/api/residential-buildings/${buildingId}/complete`,
        { method: 'POST' },
      );
      setResidentialBuildings((current) =>
        current.map((item) =>
          item.id === building.id
            ? {
                ...building,
                ownerName: building.ownerName ?? item.ownerName,
                isOwnedByCurrentUser: item.isOwnedByCurrentUser,
              }
            : item,
        ),
      );
      setConstructionMessage('Residência concluída instantaneamente pela conta Master.');
    } catch (error) {
      setConstructionMessage(
        error instanceof Error ? error.message : 'Não foi possível concluir a residência.',
      );
    }
  };

  const saveCityName = async () => {
    if (!selectedCity || !user.isMaster) return;
    const name = cityName.trim();
    if (!name || name.length > 80) {
      setCityError('Informe um nome com até 80 caracteres.');
      return;
    }
    setIsCitySaving(true);
    setCityError('');
    try {
      const updated = await cityRequest<Pick<CityAssembly, 'id' | 'name'>>(
        `/api/cities/${selectedCity.id}`,
        { method: 'PATCH', body: JSON.stringify({ name }) },
      );
      setCities((current) =>
        current.map((city) => (city.id === updated.id ? { ...city, name: updated.name } : city)),
      );
      setSelectedCity({ ...selectedCity, name: updated.name });
      setCityName(updated.name);
    } catch (error) {
      setCityError(error instanceof Error ? error.message : 'Não foi possível salvar o nome.');
    } finally {
      setIsCitySaving(false);
    }
  };

  const saveCityMinimumWage = async (minimumWage: number) => {
    if (!selectedCity || !user.isMaster) return;
    setIsCitySaving(true);
    setCityError('');
    try {
      const updated = await cityRequest<Pick<CityAssembly, 'id' | 'minimumWage'>>(
        `/api/cities/${selectedCity.id}/minimum-wage`,
        { method: 'PATCH', body: JSON.stringify({ minimumWage }) },
      );
      setCities((current) =>
        current.map((city) =>
          city.id === updated.id ? { ...city, minimumWage: updated.minimumWage } : city,
        ),
      );
      setSelectedCity((current) =>
        current?.id === updated.id
          ? { ...current, minimumWage: updated.minimumWage }
          : current,
      );
    } catch (error) {
      setCityError(error instanceof Error ? error.message : 'Não foi possível salvar o salário mínimo.');
    } finally {
      setIsCitySaving(false);
    }
  };

  const saveCityZones = async (
    city: CityAssembly,
    zones: (CityZoneBounds & { type: CityZoneType })[],
  ) => {
    setIsSavingZones(true);
    setZoneDrawingType(null);
    setZoneEditorError('');
    try {
      const updated = await cityRequest<CityAssembly>(`/api/cities/${city.id}/zones`, {
        method: 'PUT',
        body: JSON.stringify({ zones }),
      });
      setCities((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedCity((current) => (current?.id === updated.id ? updated : current));
    } catch (error) {
      setZoneEditorError(error instanceof Error ? error.message : 'Não foi possível salvar as regiões.');
    } finally {
      setIsSavingZones(false);
    }
  };

  const handleCityZoneDraw = (bounds: CityZoneBounds) => {
    if (!user.isMaster || !zoneEditorCityId || !zoneDrawingType) return;
    const city = visibleCities.find((item) => item.id === zoneEditorCityId);
    if (!city) return;
    const existingZones = city.zones;
    const zoneError = getCityZonePlacementError(bounds, zoneDrawingType, city, existingZones);
    if (zoneError) {
      setZoneEditorError(
        zoneError === 'zone_outside_municipality'
          ? 'A região precisa ficar dentro da área municipal.'
          : zoneError === 'zone_overlap'
            ? 'Áreas urbanas e rurais não podem se sobrepor.'
            : 'A região desenhada é inválida.',
      );
      return;
    }
    if (existingZones.length >= MAX_CITY_ZONES) {
      setZoneEditorError(`Cada cidade pode ter até ${MAX_CITY_ZONES} regiões.`);
      return;
    }
    void saveCityZones(city, [
      ...existingZones.map(({ type, minX, minY, maxX, maxY }) => ({ type, minX, minY, maxX, maxY })),
      { ...bounds, type: zoneDrawingType },
    ]);
  };

  const openCityZoneEditor = () => {
    if (!selectedCity || !user.isMaster) return;
    setZoneEditorCityId(selectedCity.id);
    setZoneDrawingType(null);
    setZoneEditorError('');
    setIsCityModalOpen(false);
    setActiveCategory(null);
    setIsPlacingCity(false);
    setIsPlacingRoads(false);
    setIsDemolitionMode(false);
  };

  const closeCityZoneEditor = () => {
    setZoneEditorCityId(null);
    setZoneDrawingType(null);
    setZoneEditorError('');
  };

  const handleCityZoneDelete = (zoneId: string) => {
    if (!zoneEditorCityId || !user.isMaster) return;
    const city = visibleCities.find((item) => item.id === zoneEditorCityId);
    if (!city) return;
    void saveCityZones(
      city,
      city.zones
        .filter((zone) => zone.id !== zoneId)
        .map(({ type, minX, minY, maxX, maxY }) => ({ type, minX, minY, maxX, maxY })),
    );
  };

  const demolishCity = async (city: CityAssembly) => {
    if (
      !window.confirm(
        `Demolir a Assembleia de "${city.name}"? A área municipal será removida também.`,
      )
    ) {
      return;
    }

    setDemolitionMessage('');
    try {
      await cityRequest<{ id: string }>(`/api/cities/${city.id}`, { method: 'DELETE' });
      setCities((current) => current.filter((item) => item.id !== city.id));
      setSelectedCity((current) => (current?.id === city.id ? null : current));
      setIsCityModalOpen(false);
      setDemolitionMessage(`A Assembleia de "${city.name}" foi demolida.`);
    } catch (error) {
      setDemolitionMessage(
        error instanceof Error ? error.message : 'Não foi possível demolir essa construção.',
      );
    }
  };

  const demolishRoads = async (roadsToDemolish: RoadTile[]) => {
    const keys = roadsToDemolish.map((road) => `${road.x},${road.y}`);
    setPendingRoadDemolitionKeys((current) => [...new Set([...current, ...keys])]);
    setDemolitionMessage('');
    try {
      const { removed } = await cityRequest<{ removed: RoadPosition[] }>(
        '/api/roads',
        {
          method: 'DELETE',
          body: JSON.stringify({
            path: roadsToDemolish.map(({ x, y }) => ({ x, y })),
          }),
        },
      );
      const removedKeys = new Set(removed.map((road) => `${road.x},${road.y}`));
      setRoads((current) =>
        current.filter((road) => !removedKeys.has(`${road.x},${road.y}`)),
      );
      setPendingRoadDemolitionKeys((current) =>
        current.filter((key) => !keys.includes(key)),
      );
      setDemolitionMessage(
        removed.length === roadsToDemolish.length
          ? `${removed.length === 1 ? 'Estrada demolida.' : `${removed.length} estradas demolidas.`}`
          : `${removed.length} de ${roadsToDemolish.length} estradas demolidas; só é possível demolir as que você construiu.`,
      );
    } catch (error) {
      setPendingRoadDemolitionKeys((current) =>
        current.filter((key) => !keys.includes(key)),
      );
      setDemolitionMessage(
        error instanceof Error ? error.message : 'Não foi possível demolir as estradas.',
      );
    }
  };

  const demolishResidence = async (building: ResidentialBuilding) => {
    setPendingResidentialDemolitionIds((current) =>
      current.includes(building.id) ? current : [...current, building.id],
    );
    setDemolitionMessage('');
    try {
      await cityRequest<{ id: string }>(
        `/api/residential-buildings/${building.id}`,
        { method: 'DELETE' },
      );
      setResidentialBuildings((current) =>
        current.filter((item) => item.id !== building.id),
      );
      setPendingResidentialDemolitionIds((current) =>
        current.filter((id) => id !== building.id),
      );
      setDemolitionMessage('Residência demolida.');
    } catch (error) {
      setPendingResidentialDemolitionIds((current) =>
        current.filter((id) => id !== building.id),
      );
      setDemolitionMessage(
        error instanceof Error ? error.message : 'Não foi possível demolir essa residência.',
      );
    }
  };

  return (
    <main className="realm-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Reinos de Valdora, início">
          <span className="brand-mark"><Compass size={21} strokeWidth={1.7} /></span>
          <span className="brand-copy">
            <strong>VALDORA</strong>
            <small>CRÔNICAS DE UM REINO</small>
          </span>
        </a>
        <div className="topbar-status">
          <span className={`connection-pill ${isOnline ? 'connected' : ''}`}>
            <Radio size={14} />
            {isOnline ? 'MUNDO AO VIVO' : 'CONECTANDO'}
          </span>
          <div className="player-money" title="Seu dinheiro">
            {balance === null ? 'C$ —' : formatMoney(balance)}
          </div>
          <div
            className="player-resources"
            aria-label={`Madeira ${localResources?.wood ?? 'indisponível'} e Pedra ${localResources?.stone ?? 'indisponível'} nos armazéns próprios a até ${LINK_RADIUS} tiles da área visível`}
          >
            <span title="Madeira nos armazéns próximos">
              <img src="/products/madeira.png" alt="" />
              {localResources ? localResources.wood.toLocaleString('pt-BR') : '—'}
            </span>
            <span title="Pedra nos armazéns próximos">
              <img src="/products/pedra.png" alt="" />
              {localResources ? localResources.stone.toLocaleString('pt-BR') : '—'}
            </span>
          </div>
          <div className="player-count"><span className="status-dot" />{snapshot?.onlinePlayers ?? '—'} <span>viajantes</span></div>
          <button
            type="button"
            className={`master-button${isPerformanceLogOpen ? ' active' : ''}`}
            aria-expanded={isPerformanceLogOpen}
            onClick={togglePerformanceLogs}
          >
            <Activity size={14} />
            Log
          </button>
          {user.isMaster && (
            <button
              type="button"
              className="master-button"
              aria-expanded={isMasterPanelOpen}
              onClick={() => setIsMasterPanelOpen((open) => !open)}
            >
              Master
            </button>
          )}
          {signOutError && <span className="account-error" role="alert">{signOutError}</span>}
          <div className="account-menu">
            <span title={user.email}>{user.name || user.email}</span>
            <button type="button" onClick={() => void onSignOut()}>Sair</button>
          </div>
        </div>
      </header>

      <section className="world-stage" ref={worldStageRef}>
        <GameMap
          generator={generator}
          camera={camera}
          cities={visibleCities}
          roads={visibleRoads}
          placementMode={isPlacingCity}
          placementName={cityName}
          roadMode={isPlacingRoads}
          demolitionMode={isDemolitionMode}
          zoneOverlay={zoneOverlay}
          influenceBuilding={showInfluence ? selectedResidence : null}          zoneEditorCityId={zoneEditorCityId}
          zoneDrawingType={isSavingZones ? null : zoneDrawingType}
          residentialBuildings={visibleResidentialBuildings}
          residencePlacementType={residencePlacementType}
          isMaster={user.isMaster}
          onCameraChange={setCamera}
          onTileHover={setHoveredTile}
          onTileSelect={(tile) => {
            setSelectedTile(tile);
            setSelectedResidenceId(null);
          }}
          onCitySelect={openCityDetails}
          onCityPlace={(center) => void handleCityPlace(center)}
          onInvalidCityPlacement={handleInvalidCityPlacement}
          onRoadPlace={(path) => void handleRoadPlace(path)}
          onInvalidRoadPlacement={handleInvalidRoadPlacement}
          onRoadDemolish={(roadsToDemolish) => void demolishRoads(roadsToDemolish)}
          onCityDemolish={(city) => void demolishCity(city)}
          onCityZoneDraw={handleCityZoneDraw}
          onResidencePlace={(type, position) => void handleResidencePlace(type, position)}
          onResidenceDemolish={(building) => void demolishResidence(building)}
          onInvalidResidencePlacement={handleInvalidResidencePlacement}
          onResidenceComplete={(buildingId) => void completeResidence(buildingId)}
          onResidenceSelect={handleResidenceSelect}
          onResidenceMove={(buildingId, position) => void moveResidentialBuilding(buildingId, position)}
        />
        <div className="map-vignette" />

        <div className="map-heading">
          <div className="map-heading-icon"><MapIcon size={17} /></div>
          <div><span>MAPA DO MUNDO</span><strong>Terras conhecidas</strong></div>
        </div>
        <div className="map-scale"><span /><span /><span /> 4.000 × 4.000 tiles</div>

        <div className="time-card">
          <div className="time-icon"><Clock3 size={17} /></div>
          <div className="time-copy">
            <span>HORA DO REINO <i className={isOnline ? 'live-dot' : ''} /></span>
            <strong>{gameTime ? formatter.format(gameTime).replace(' às ', ' · ') : 'Sincronizando…'}</strong>
            <small>1 minuto real <b>·</b> 15 minutos no jogo</small>
          </div>
        </div>

        {selectedResidence && (
          <ResidencePanel
            building={selectedResidence}
            cityMinimumWage={selectedResidenceMinimumWage}
            isOwner={isResidenceOwner}
            isSaving={isSavingWorkSettings}
            error={workSettingsError}
            onSave={(settings) => void saveWorkSettings(selectedResidence.id, settings)}
            onSaveRent={(rent) => void saveRent(selectedResidence.id, rent)}
            residenceBenefit={residenceBenefit}
            onSavePrice={(price) => void savePrice(selectedResidence.id, price)}
            onSimulateSale={(settings) => {
              try {
                const cachedDays = loadCommerceDiagnostics(
                  window.localStorage,
                  user.email,
                  selectedResidence.id,
                );
                const transactions = [...cachedDays.entries()]
                  .sort(([firstDay], [secondDay]) => secondDay.localeCompare(firstDay))[0]?.[1];
                if (!transactions || transactions.length === 0) return null;
                const workers = selectedResidence.employed;
                const workPoints = workers * getDailyWorkPoints(
                  settings.workHoursPerDay,
                  RESIDENCE_STATS.health,
                  RESIDENCE_STATS.happiness,
                );
                return simulateShopSales(transactions, {
                  price: settings.price,
                  stock: selectedResidence.stock,
                  dailyCapacity: getShopSalesCapacity(
                    selectedResidence.type,
                    workPoints,
                    workers,
                  ),
                  wage: settings.wage,
                  workers,
                });
              } catch (error) {
                return {
                  unitsSold: 0,
                  profitLoss: 0,
                  error: error instanceof Error
                    ? error.message
                    : 'Não foi possível simular as vendas com o cache local.',
                };
              }
            }}
            onSimulateHiring={(settings) => {
              const residences = residentialBuildings
                .filter((building) =>
                  RESIDENCES[building.type].kind === 'residence' &&
                  building.status === 'completed',
                )
                .map((building) => ({
                  id: building.id,
                  type: building.type,
                  x: building.x,
                  y: building.y,
                  occupants: building.occupants,
                }));
              const workplaces = residentialBuildings
                .filter((building) => RESIDENCES[building.type].kind !== 'residence')
                .map((building) => ({
                  id: building.id,
                  type: building.type,
                  x: building.x,
                  y: building.y,
                  wage: building.id === selectedResidence.id ? settings.wage : building.wage,
                  workHoursPerDay:
                    building.id === selectedResidence.id
                      ? settings.workHoursPerDay
                      : building.workHoursPerDay,
                  desiredWorkers:
                    building.id === selectedResidence.id
                      ? settings.desiredWorkers
                      : building.desiredWorkers,
                  status: building.status,
                }));
              return allocateWorkers(residences, workplaces)
                .filter((assignment) => assignment.workplaceId === selectedResidence.id)
                .reduce((total, assignment) => total + assignment.count, 0);
            }}
            onSaveInputProduct={(productId) =>
              void saveInputProduct(selectedResidence.id, productId)
            }
            onOpenWarehouse={() => void openWarehouse(selectedResidence.id)}
            warehouseStock={warehouseStock}
            warehouseStockLoaded={warehouseStockLoaded}
            onOpenConsumption={() => void openConsumption(selectedResidence.id)}
            onOpenProductionHistory={() => void openProductionHistory(selectedResidence.id)}
            onOpenCommerceHistory={() => void openCommerceHistory(selectedResidence.id)}
            onOpenWarehouseLog={() => void openWarehouseLog(selectedResidence.id)}
            linkedWarehouses={residentialBuildings
              .filter(
                (building) =>
                  selectedResidence.warehouseIds.includes(building.id) &&
                  isStorageBuilding(building.type),
              )
              .map((building) => ({
                id: building.id,
                name: getResidentialBuildingName(building.type, building.buildingNumber),
              }))}
            isLinking={linkingFromId === selectedResidence.id}
            onStartLink={() => {
              setWorkSettingsError('');
              setLinkingFromId(selectedResidence.id);
            }}
            onCancelLink={() => setLinkingFromId(null)}
            onUnlink={(warehouseId) =>
              void linkWarehouse(selectedResidence.id, warehouseId, false)
            }
            onPlant={() => void plantCrop(selectedResidence.id)}
            onSaveFarmAutomation={(settings) =>
              void saveFarmAutomation(selectedResidence.id, settings)
            }
            showInfluence={showInfluence}
            onToggleInfluence={() => setShowInfluence((current) => !current)}
            onClose={() => {
              setLinkingFromId(null);
              setSelectedResidenceId(null);
            }}
          />
        )}
        {user.isMaster && isMasterPanelOpen && (
          <MasterPanel
            timeScale={snapshot?.timeScale ?? 15}
            players={onlinePlayers}
            isLoadingPlayers={isLoadingPlayers}
            isBusy={isMasterBusy}
            error={masterError}
            message={masterMessage}
            onSetTimeScale={changeTimeScale}
            onGrantMoney={grantMoney}
            onRefreshPlayers={refreshOnlinePlayers}
            onClose={() => setIsMasterPanelOpen(false)}
          />
        )}
        {isPerformanceLogOpen && (
          <PerformanceLogPanel
            logs={performanceLogs}
            isLoading={isPerformanceLogLoading}
            error={performanceLogError}
            onRefresh={() => void loadPerformanceLogs()}
            onClose={() => setIsPerformanceLogOpen(false)}
          />
        )}
        {selectedResidence && isWarehouseLogOpen && (
          <WarehouseLogPanel
            days={warehouseLogDays}
            events={warehouseLogEvents}
            isLoading={isWarehouseLogLoading}
            error={warehouseLogError}
            onClose={() => setIsWarehouseLogOpen(false)}
          />
        )}
        {selectedResidence && isHistoryOpen && (
          <ProductionHistoryPanel
            title={`Produção: ${RESIDENCES[selectedResidence.type].name}`}
            days={historyDays}
            isLoading={isHistoryLoading}
            error={historyError}
            onClose={() => setIsHistoryOpen(false)}
          />
        )}
        {selectedResidence && isCommerceHistoryOpen && (
          <CommerceHistoryPanel
            title={`Histórico: ${RESIDENCES[selectedResidence.type].name}`}
            days={commerceHistoryDays}
            isLoading={isCommerceHistoryLoading}
            error={commerceHistoryError || commerceDiagnosticsStorageError}
            onClose={() => setIsCommerceHistoryOpen(false)}
          />
        )}
        {isConsumptionOpen && (
          <ConsumptionPanel
            consumption={consumption}
            isLoading={isConsumptionLoading}
            error={consumptionError}
            scope={consumptionScope}
            title={consumptionTitle}
            onClose={closeConsumption}
          />
        )}
        {isAccountingOpen && (
          <AccountingPanel
            summary={accountingSummary}
            isLoading={isAccountingLoading}
            error={accountingError}
            periodDays={accountingPeriodDays}
            onPeriodChange={(days) => {
              setAccountingPeriodDays(days);
              void loadAccounting(days);
            }}
            weekOffset={accountingWeekOffset}
            onWeekChange={(offset) => {
              setAccountingWeekOffset(offset);
              void loadAccounting(accountingPeriodDays, offset);
            }}
            onViewBuilding={viewAccountingBuilding}
            onClose={() => setIsAccountingOpen(false)}
          />
        )}
        {selectedResidence && selectedResidenceKey && isWarehouseOpen && (
          <WarehousePanel
            building={selectedResidence}
            isOwner={isResidenceOwner}
            settings={warehouseSettings}
            stock={warehouseStock}
            averagePrices={warehouseAveragePrices}
            demand={warehouseDemand}
            isSaving={isSavingWorkSettings}
            isSearchingSuppliers={isSearchingSuppliers}
            error={warehouseError}
            supplierMessage={warehouseSupplierMessage}
            onSave={(setting) => void saveWarehouseSetting(selectedResidenceKey, setting)}
            onTransfer={(productId) => beginWarehouseTransfer(selectedResidenceKey, productId)}
            onSearchSuppliers={() => void searchWarehouseSuppliers(selectedResidenceKey)}
            onClose={() => setIsWarehouseOpen(false)}
          />
        )}
        {warehouseTransfer && (!warehouseTransfer.destination || warehouseTransfer.isLoadingQuote) && (
          <div className="placement-banner" role="status">
            {warehouseTransfer.error ||
              (warehouseTransfer.isLoadingQuote
                ? 'Verificando estoque, espaço e Work Points disponíveis…'
                : `Clique em uma construção sua, concluída e a até ${LINK_RADIUS} tiles, para escolher o destino.`)}
            <button type="button" onClick={() => setWarehouseTransfer(null)}>Cancelar</button>
          </div>
        )}
        {warehouseTransfer?.destination && warehouseTransfer.quote && (
          <WarehouseTransferPanel
            productId={warehouseTransfer.productId}
            destination={warehouseTransfer.destination}
            maxQuantity={warehouseTransfer.quote.maxQuantity}
            workPoints={warehouseTransfer.quote.workPoints}
            destinationStock={warehouseTransfer.quote.destinationStock}
            destinationCapacity={warehouseTransfer.quote.destinationCapacity}
            isSubmitting={warehouseTransfer.isSubmitting}
            error={warehouseTransfer.error}
            onSubmit={(quantity) => void executeWarehouseTransfer(quantity)}
            onClose={() => setWarehouseTransfer(null)}
          />
        )}

        <div className="map-coordinates">
          <span className="coordinate-cross">⌖</span>
          {mapPosition ? `X ${mapPosition.x.toLocaleString('pt-BR')}  /  Y ${mapPosition.y.toLocaleString('pt-BR')}` : '4000 × 4000 TILES'}
        </div>
        <div className="map-hint">
          <span className="mouse-icon">⤢</span> ARRASTE PARA EXPLORAR
          {user.isMaster && <> <i /> ARRASTE CONSTRUÇÕES PARA MOVÊ-LAS</>}
          <i /> SCROLL PARA ZOOM
        </div>
        <div className="map-credit">UM REINO · UM MUNDO · UMA HISTÓRIA</div>
        {isPlacingCity && (
          <div className="placement-banner" role="status">
            {cityPlacementMessage || 'Mova o mouse para ver a prévia. Verde: local válido; vermelho: local inválido.'}
            <button type="button" onClick={() => {
              setIsPlacingCity(false);
              setCityPlacementMessage('');
            }}>Cancelar</button>
          </div>
        )}
        {residencePlacementType && (
          <div className="placement-banner" role="status">
            {residencePlacementMessage ||
              'Mova o cursor para ver a residência. Verde: local válido; vermelho: local inválido. O tile selecionado será o canto superior esquerdo.'}
            <button type="button" onClick={() => {
              setResidencePlacementType(null);
              setResidencePlacementMessage('');
            }}>Cancelar</button>
          </div>
        )}
        {constructionMessage && !residencePlacementType && (
          <div className="placement-banner" role="status">
            {constructionMessage}
            <button type="button" onClick={() => setConstructionMessage('')}>Fechar</button>
          </div>
        )}
        {isPlacingRoads && (
          <div className="placement-banner" role="status">
            {roadPlacementMessage || 'Clique e arraste sobre terra dentro de uma área municipal para traçar até 600 tiles de estrada.'}
            <button type="button" onClick={() => {
              setIsPlacingRoads(false);
              setRoadPlacementMessage('');
            }}>Cancelar</button>
          </div>
        )}
        {isDemolitionMode && (
          <div className="placement-banner demolition-banner" role="status">
            {demolitionMessage || 'Clique numa construção para demoli-la ou clique e arraste pelas estradas. Você só pode demolir o que construiu; estradas não exigem confirmação.'}
            <button
              type="button"
              onClick={() => {
                setIsDemolitionMode(false);
                setDemolitionMessage('');
              }}
            >
              Cancelar
            </button>
          </div>
        )}
        {cityZoneEditorCity && (
          <CityZoneEditor
            city={cityZoneEditorCity}
            drawingType={zoneDrawingType}
            isSaving={isSavingZones}
            error={zoneEditorError}
            onDraw={setZoneDrawingType}
            onDelete={handleCityZoneDelete}
            onClose={closeCityZoneEditor}
          />
        )}
      </section>
      {activeCategory && (
        <section className="construction-drawer" aria-label={CATEGORY_LABELS[activeCategory]}>
          <div className="construction-drawer-heading">
            <h2>{CATEGORY_LABELS[activeCategory]}</h2>
            <button type="button" aria-label="Fechar categoria" onClick={() => setActiveCategory(null)}>
              ×
            </button>
          </div>
          {zoneOverlay && (
            <p className={`zone-category-hint ${zoneOverlay}`}>
              Áreas {zoneOverlay === 'urban' ? 'urbanas (azul)' : 'rurais (verde)'} destacadas no mapa
              {activeZoneCount === 0
                ? ': nenhuma região foi definida.'
                : `: ${activeZoneCount === 1 ? '1 região' : `${activeZoneCount} regiões`}.`}
            </p>
          )}
          {activeCategory === 'prefeitura' && user.isMaster ? (
            <>
              <button className="construction-card" type="button" onClick={openNewAssembly}>
                <img src="/buildings/assembleia.png" alt="" />
                <span><strong>Assembleia</strong><small>Ocupa 3 × 3 tiles · Área municipal 303 × 303</small></span>
              </button>
              <button className="construction-card" type="button" onClick={startRoadPlacement}>
                <img src="/buildings/roads/grass_dirt1.png?v=11" alt="" />
                <span><strong>Estrada de Terra</strong><small>Clique e arraste para traçar · Somente em áreas municipais</small></span>
              </button>
            </>
          ) : activeCategory === 'residencias' ||
            activeCategory === 'artesanais' ||
            activeCategory === 'recursos' ||
            activeCategory === 'fazendas' ||
            activeCategory === 'comerciais' ||
            activeCategory === 'industrias' ? (
            <>
              {getConstructionMenuDefinitions(activeCategory).map((residence) => (
                <button
                  className={`construction-card${residencePlacementType === residence.type ? ' active' : ''}`}
                  key={residence.type}
                  type="button"
                  onClick={() => startResidencePlacement(residence.type)}
                >
                  <img src={residence.asset} alt="" />
                  <span>
                    <strong>{residence.name}</strong>
                    <small>
                      {residence.width} × {residence.height} tiles ·{' '}
                      {residence.kind === 'warehouse'
                        ? `Até ${residence.maxWorkers} funcionários · Capacidade ${residence.storageCapacityM3} m³${residence.allowedStorageProductIds ? ` · Recursos: ${residence.allowedStorageProductIds.map((productId) => PRODUCTS.find((product) => product.id === productId)?.name ?? productId).join(', ')}` : ' de qualquer produto'}`
                        : residence.kind !== 'residence'
                        ? `Até ${residence.maxWorkers} funcionários · Estoque máx. ${residence.stockCapacity} ${residence.stockProduct}${Object.entries(residence.inputCapacities ?? {}).map(([productId, capacity]) => {
                            const product = PRODUCTS.find((entry) => entry.id === productId);
                            return ` · ${capacity}${product?.unit === 'liter' ? ' litros de ' : ' '}${product?.name ?? productId}`;
                          }).join('')}${residence.toolCapacity ? ` · ${residence.toolCapacity} Ferramentas` : ''}${residence.woodCapacity ? ` · ${residence.woodCapacity} Madeira` : ''}${residence.ironCapacity ? ` · ${residence.ironCapacity} Ferro` : ''}`
                        : `Capacidade ${residence.capacity} pessoas`}
                    </small>
                    <small>
                      {residence.type === 'warehouse'
                        ? `Primeiro armazém gratuito e instantâneo · seguintes: ${residence.cost.wood} madeira, ${residence.cost.stone} pedra`
                        : `Custo: ${residence.cost.wood} madeira · ${residence.cost.stone} pedra${residence.cost.iron ? ` · ${residence.cost.iron} ferro` : ''}${residence.cost.steel ? ` · ${residence.cost.steel} aço` : ''}`}
                    </small>
                    <small>
                      {residence.type === 'warehouse'
                        ? `Primeiro armazém: sem espera · seguintes: ${residence.workPoints.toLocaleString('pt-BR')} Work Points`
                        : `${residence.kind === 'residence' ? `Apreço local ${residence.localAppeal} · ` : ''}${residence.workPoints.toLocaleString('pt-BR')} Work Points`}
                    </small>
                    {residencePlacementType === residence.type && (
                      <small className="construction-selected-hint">
                        Clique no mapa para posicionar
                      </small>
                    )}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <p className="construction-empty">
              As construções desta categoria serão adicionadas em uma próxima etapa.
            </p>
          )}
        </section>
      )}
      <ConstructionBar
        activeCategory={activeCategory}
        demolitionMode={isDemolitionMode}
        productCatalogOpen={isProductCatalogOpen}
        accountingOpen={isAccountingOpen}
        isMaster={user.isMaster}
        onSelect={(category) => {
          closeCityZoneEditor();
          setSelectedResidenceId(null);
          setSelectedTile(null);
          setIsAccountingOpen(false);
          setIsProductCatalogOpen(false);
          setIsDemolitionMode(false);
          setDemolitionMessage('');
          setIsPlacingCity(false);
          setIsPlacingRoads(false);
          setResidencePlacementType(null);
          setResidencePlacementMessage('');
          setRoadPlacementMessage('');
          setActiveCategory((current) => (current === category ? null : category));
        }}
        onToggleProductCatalog={() => {
          closeCityZoneEditor();
          setIsAccountingOpen(false);
          setActiveCategory(null);
          setIsDemolitionMode(false);
          setDemolitionMessage('');
          setIsPlacingCity(false);
          setIsPlacingRoads(false);
          setResidencePlacementType(null);
          setResidencePlacementMessage('');
          setRoadPlacementMessage('');
          setIsProductCatalogOpen((current) => !current);
        }}
        onToggleAccounting={toggleAccounting}
        onToggleDemolition={() => {
          closeCityZoneEditor();
          setIsAccountingOpen(false);
          setIsProductCatalogOpen(false);
          setActiveCategory(null);
          setIsPlacingCity(false);
          setIsPlacingRoads(false);
          setResidencePlacementType(null);
          setResidencePlacementMessage('');
          setRoadPlacementMessage('');
          setDemolitionMessage('');
          setIsDemolitionMode((current) => !current);
        }}
      />
      {isProductCatalogOpen && (
        <ProductCatalog onClose={() => setIsProductCatalogOpen(false)} />
      )}
      {isCityModalOpen && (
        <CityAssemblyModal
          city={isCreatingCity ? null : selectedCity}
          name={cityName}
          isMaster={user.isMaster}
          isCreating={isCreatingCity}
          isBusy={isCitySaving}
          error={cityError}
          onNameChange={setCityName}
          onClose={() => {
            setIsCityModalOpen(false);
            setCityError('');
          }}
          onSave={() => void saveCityName()}
          onSaveMinimumWage={(minimumWage) => void saveCityMinimumWage(minimumWage)}
          onChooseLocation={chooseCityLocation}
          onManageZones={openCityZoneEditor}
          onOpenConsumption={() => {
            if (selectedCity) void openCityConsumption(selectedCity);
          }}
        />
      )}
    </main>
  );
}
