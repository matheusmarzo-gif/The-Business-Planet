import { useEffect, useMemo, useState } from 'react';
import {
  Clock3,
  Compass,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Radio,
} from 'lucide-react';
import CityAssemblyModal from './components/CityAssemblyModal';
import ConstructionBar, { ConstructionCategory } from './components/ConstructionBar';
import CityZoneEditor from './components/CityZoneEditor';
import ProductCatalog from './components/ProductCatalog';
import ResidencePanel from './components/ResidencePanel';
import WarehousePanel from './components/WarehousePanel';
import type { WarehouseProductSetting } from './types/warehouse';
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
  DEFAULT_RENT,
  DEFAULT_WAGE,
  DEFAULT_WORK_HOURS,
  RESIDENCES,
  ResidentialBuilding,
  ResidencePlacementError,
  ResidenceType,
} from './types/residence';
import type { RoadPlacementError, RoadPosition, RoadTile } from './types/road';
import { TileInfo } from './types/map';
import { formatMoney } from './types/wallet';
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

interface GameAppProps {
  user: {
    email: string;
    name: string;
    isMaster: boolean;
  };
  onSignOut: () => Promise<void>;
  signOutError: string;
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
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        errorCode = body.error;
        if (body.error === 'map_bounds') {
          error = path.startsWith('/api/residential-buildings')
            ? 'A residência precisa caber inteira dentro do mapa.'
            : 'A área municipal precisa caber inteira dentro do mapa.';
        } else if (body.error === 'water') {
          error = 'A construção só pode ser colocada em terra.';
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
          error = 'Essa construção não existe mais.';
        } else if (body.error === 'invalid_zones') {
          error = 'As regiões enviadas são inválidas.';
        } else if (body.error === 'zone_outside_municipality') {
          error = 'As regiões precisam ficar dentro da área municipal.';
        } else if (body.error === 'zone_overlap') {
          error = 'As áreas urbanas e rurais não podem se sobrepor.';
        } else if (body.error === 'road_not_owned') {
          error = 'Você só pode demolir estradas que construiu.';
        } else if (body.error === 'road_not_found') {
          error = 'Essa estrada não existe mais.';
        } else if (body.error === 'residence_not_owned') {
          error = 'Você só pode demolir residências que construiu.';
        } else if (body.error === 'residence_not_found') {
          error = 'Essa residência não existe mais.';
        } else if (body.error === 'outside_urban_zone') {
          error = 'A residência precisa ficar dentro de uma área urbana.';
        } else if (body.error === 'outside_rural_zone') {
          error = 'A construção precisa ficar dentro de uma área rural.';
        } else if (body.error === 'residence_outside_municipality') {
          error = 'A residência precisa ficar dentro da área municipal.';
        } else if (body.error === 'not_adjacent_to_road') {
          error = 'A residência precisa ficar ao lado de uma estrada.';
        } else if (body.error === 'road_overlap') {
          error = 'A residência não pode ocupar o espaço de uma estrada.';
        } else if (body.error === 'invalid_residence') {
          error = 'A residência ou o local escolhido é inválido.';
        } else if (body.error === 'insufficient_materials') {
          error = 'Você não possui materiais suficientes para iniciar essa construção.';
        } else if (body.error === 'invalid_work_settings') {
          error = 'Informe funcionários desejados (até o máximo da construção), salário (0 a 100.000) e carga horária de 4 a 14 horas.';
        } else if (body.error === 'invalid_rent') {
          error = 'O aluguel deve ser um número inteiro de C$ 1 a C$ 100.000.';
        } else if (body.error === 'invalid_warehouse_setting') {
          error = 'Informe estoque desejável e valor inteiros (0 a 1.000.000) e o tipo venda/compra.';
        } else if (body.error === 'not_a_warehouse') {
          error = 'Essa construção não é um armazém concluído.';
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
  const [hoveredTile, setHoveredTile] = useState<TileInfo | null>(null);
  const [selectedTile, setSelectedTile] = useState<TileInfo | null>(null);
  const [selectedResidenceId, setSelectedResidenceId] = useState<string | null>(null);
  const [isResidenceOwner, setIsResidenceOwner] = useState(false);
  const [isSavingWorkSettings, setIsSavingWorkSettings] = useState(false);
  const [workSettingsError, setWorkSettingsError] = useState('');
  const [isWarehouseOpen, setIsWarehouseOpen] = useState(false);
  const [warehouseSettings, setWarehouseSettings] = useState<Map<string, WarehouseProductSetting>>(new Map());
  const [warehouseError, setWarehouseError] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const gameTime = useWorldClock(snapshot);

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
    );
  }, []);

  const visibleCities = useMemo(() => {
    const byPosition = new Map(
      pendingCities.map((city) => [`${city.centerX},${city.centerY}`, city]),
    );
    for (const city of cities) {
      byPosition.set(`${city.centerX},${city.centerY}`, city);
    }
    return [...byPosition.values()];
  }, [cities, pendingCities]);
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
  const selectedResidenceKey = selectedResidence && !selectedResidence.id.startsWith('pending-')
    ? selectedResidence.id
    : null;

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
  }, [selectedResidenceKey]);

  const openWarehouse = async (buildingId: string) => {
    setIsWarehouseOpen(true);
    setWarehouseError('');
    try {
      const result = await cityRequest<{ settings: WarehouseProductSetting[] }>(
        `/api/residential-buildings/${buildingId}/warehouse`,
      );
      setWarehouseSettings(new Map(result.settings.map((setting) => [setting.productId, setting])));
    } catch (error) {
      setWarehouseError(error instanceof Error ? error.message : 'Não foi possível carregar o armazém.');
    }
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
        current.map((item) => (item.id === building.id ? building : item)),
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
        current.map((item) => (item.id === building.id ? building : item)),
      );
    } catch (error) {
      setWorkSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar o aluguel.',
      );
    } finally {
      setIsSavingWorkSettings(false);
    }
  };
  const zoomBy = (factor: number) =>
    setCamera((current) => {
      const zoom = Math.min(6, Math.max(0.004, current.zoom * factor));
      const ratio = zoom / current.zoom;
      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;
      return {
        zoom,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  const centerOnSpawn = () => {
    const tilePixels = BASE_TILE_SIZE * camera.zoom;
    const mapViewportWidth = viewport.width;
    setCamera({
      ...camera,
      x: mapViewportWidth / 2 - SPAWN.x * tilePixels,
      y: viewport.height / 2 - SPAWN.y * tilePixels,
    });
  };

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
    setActiveCategory(
      {
        farm: 'fazendas',
        shop: 'comerciais',
        residence: 'residencias',
        warehouse: 'industrias',
      }[RESIDENCES[type].kind] as ConstructionCategory,
    );
    setResidencePlacementType(type);
    setResidencePlacementMessage('');
    setConstructionMessage('');
  };

  const handleInvalidResidencePlacement = (reason: ResidencePlacementError) => {
    const messages: Record<ResidencePlacementError, string> = {
      invalid_residence: 'A residência ou o local escolhido é inválido.',
      map_bounds: 'A residência precisa caber inteira dentro do mapa.',
      outside_municipality: 'A residência precisa ficar dentro da área municipal.',
      outside_urban_zone: 'A residência precisa ficar inteiramente dentro de uma área urbana.',
      outside_rural_zone: 'A construção precisa ficar inteiramente dentro de uma área rural.',
      water: 'A residência só pode ser construída em terra.',
      building_overlap: 'A residência não pode ocupar o espaço de outra construção.',
      road_overlap: 'A residência não pode ocupar o espaço de uma estrada.',
      not_adjacent_to_road: 'A residência precisa ficar ao lado de uma estrada.',
    };
    setResidencePlacementMessage(messages[reason]);
  };

  const handleResidencePlace = async (type: ResidenceType, position: RoadPosition) => {
    if (!user.isMaster) {
      setResidencePlacementMessage(
        'Construção indisponível: ainda não há estoque de materiais implementado para conferir madeira e pedra.',
      );
      return;
    }

    const pending: ResidentialBuilding = {
      id: `pending-${Date.now()}-${position.x}-${position.y}`,
      type,
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
      employed: 0,
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
        building,
      ]);
      setPendingResidentialBuildings((current) =>
        current.filter((item) => item.id !== pending.id),
      );
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
        current.map((item) => (item.id === building.id ? building : item)),
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
    const zoneError = getCityZonePlacementError(bounds, city, existingZones);
    if (zoneError) {
      setZoneEditorError(
        zoneError === 'zone_outside_municipality'
          ? 'A região precisa ficar dentro da área municipal.'
          : zoneError === 'zone_overlap'
            ? 'As áreas urbanas e rurais não podem se sobrepor.'
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
        <div className="world-name">
          <span className="world-kicker">MUNDO COMPARTILHADO</span>
          <span className="world-title">As Terras de Valdora <span className="world-seed">#583921</span></span>
        </div>
        <div className="topbar-status">
          <span className={`connection-pill ${isOnline ? 'connected' : ''}`}>
            <Radio size={14} />
            {isOnline ? 'MUNDO AO VIVO' : 'CONECTANDO'}
          </span>
          <div className="player-money" title="Seu dinheiro">
            {balance === null ? 'C$ —' : formatMoney(balance)}
          </div>
          <div className="player-count"><span className="status-dot" />{snapshot?.onlinePlayers ?? '—'} <span>viajantes</span></div>
          {signOutError && <span className="account-error" role="alert">{signOutError}</span>}
          <div className="account-menu">
            <span title={user.email}>{user.name || user.email}</span>
            <button type="button" onClick={() => void onSignOut()}>Sair</button>
          </div>
        </div>
      </header>

      <section className="world-stage">
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
          zoneEditorCityId={zoneEditorCityId}
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
          onResidenceSelect={(building) => setSelectedResidenceId(building.id)}
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

        <div className="map-tools">
          <button aria-label="Aproximar mapa" onClick={() => zoomBy(1.3)}><Plus size={18} /></button>
          <button aria-label="Afastar mapa" onClick={() => zoomBy(1 / 1.3)}><Minus size={18} /></button>
          <span className="tool-divider" />
          <button aria-label="Centralizar no ponto de partida" onClick={centerOnSpawn}><LocateFixed size={17} /></button>
        </div>

        {selectedResidence && (
          <ResidencePanel
            building={selectedResidence}
            isOwner={isResidenceOwner}
            isSaving={isSavingWorkSettings}
            error={workSettingsError}
            onSave={(settings) => void saveWorkSettings(selectedResidence.id, settings)}
            onSaveRent={(rent) => void saveRent(selectedResidence.id, rent)}
            onOpenWarehouse={() => void openWarehouse(selectedResidence.id)}
            onClose={() => setSelectedResidenceId(null)}
          />
        )}
        {selectedResidence && selectedResidenceKey && isWarehouseOpen && (
          <WarehousePanel
            building={selectedResidence}
            isOwner={isResidenceOwner}
            settings={warehouseSettings}
            isSaving={isSavingWorkSettings}
            error={warehouseError}
            onSave={(setting) => void saveWarehouseSetting(selectedResidenceKey, setting)}
            onClose={() => setIsWarehouseOpen(false)}
          />
        )}

        <div className="map-coordinates">
          <span className="coordinate-cross">⌖</span>
          {mapPosition ? `X ${mapPosition.x.toLocaleString('pt-BR')}  /  Y ${mapPosition.y.toLocaleString('pt-BR')}` : '4000 × 4000 TILES'}
        </div>
        <div className="map-hint"><span className="mouse-icon">⤢</span> ARRASTE PARA EXPLORAR <i /> SCROLL PARA ZOOM</div>
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
            activeCategory === 'fazendas' ||
            activeCategory === 'comerciais' ||
            activeCategory === 'industrias' ? (
            <>
              {Object.values(RESIDENCES)
                .filter(
                  (residence) =>
                    residence.kind ===
                    { fazendas: 'farm', comerciais: 'shop', industrias: 'warehouse', residencias: 'residence' }[
                      activeCategory
                    ],
                )
                .map((residence) => (
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
                        ? `Até ${residence.maxWorkers} funcionários · Capacidade ${residence.storageCapacityM3} m³ de qualquer produto`
                        : residence.kind !== 'residence'
                        ? `Até ${residence.maxWorkers} funcionários · Estoque máx. ${residence.stockCapacity} ${residence.stockProduct}`
                        : `Capacidade ${residence.capacity} pessoas`}
                    </small>
                    <small>
                      Custo: {residence.cost.wood} madeira · {residence.cost.stone} pedra
                    </small>
                    <small>
                      {residence.kind === 'residence' && `Apreço local ${residence.localAppeal} · `}
                      {residence.workPoints.toLocaleString('pt-BR')} Work Points
                    </small>
                    {residencePlacementType === residence.type && (
                      <small className="construction-selected-hint">
                        Clique no mapa para posicionar · Master pode concluir a obra com duplo clique
                      </small>
                    )}
                  </span>
                </button>
              ))}
              {!user.isMaster && (
                <p className="construction-empty">
                  O estoque ainda não está disponível. Jogadores comuns não podem iniciar obras até madeira e pedra serem implementadas.
                </p>
              )}
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
        isMaster={user.isMaster}
        onSelect={(category) => {
          closeCityZoneEditor();
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
        onToggleDemolition={() => {
          closeCityZoneEditor();
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
          onChooseLocation={chooseCityLocation}
          onManageZones={openCityZoneEditor}
        />
      )}
    </main>
  );
}
