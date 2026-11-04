import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Clock3,
  Compass,
  LocateFixed,
  Map as MapIcon,
  Minus,
  Plus,
  Radio,
  Sparkles,
  Waves,
  Wind,
} from 'lucide-react';
import CityAssemblyModal from './components/CityAssemblyModal';
import ConstructionBar, { ConstructionCategory } from './components/ConstructionBar';
import { GameMap } from './game/GameMap';
import { getAccessToken } from './auth/authClient';
import { connectToWorld, WorldSnapshot } from './game/worldClient';
import type { CityAssembly, CityPlacementError } from './types/city';
import type { RoadPlacementError, RoadPosition, RoadTile } from './types/road';
import { TileInfo } from './types/map';
import { createMapGenerator } from './utils/mapGenerator';
import { DEFAULT_TILE_LIST } from './utils/tileAssets';
import { WORLD_CONFIG } from './utils/worldConfig';

const SPAWN = { x: 2000, y: 2000 };
const BASE_TILE_SIZE = 24;
const getSidePanelWidth = (width: number) => (width > 900 ? 338 : width > 620 ? 300 : 0);
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
  fazendas: 'Fazendas',
  residencias: 'Residências',
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
          error = 'A área municipal precisa caber inteira dentro do mapa.';
        } else if (body.error === 'water') {
          error = 'A construção só pode ser colocada em terra.';
        } else if (body.error === 'building_overlap') {
          error = 'Esse local já está ocupado por outra construção.';
        } else if (body.error === 'municipal_area_overlap') {
          error = 'A área municipal sobrepõe outra cidade.';
        } else if (body.error === 'outside_municipality') {
          error = 'A estrada só pode ser construída dentro de uma área municipal.';
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
        } else if (body.error === 'road_not_owned') {
          error = 'Você só pode demolir estradas que construiu.';
        } else if (body.error === 'road_not_found') {
          error = 'Essa estrada não existe mais.';
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
  const [pendingCities, setPendingCities] = useState<CityAssembly[]>([]);
  const [pendingRoads, setPendingRoads] = useState<RoadTile[]>([]);
  const [pendingRoadDemolitionKeys, setPendingRoadDemolitionKeys] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<ConstructionCategory | null>(null);
  const [isDemolitionMode, setIsDemolitionMode] = useState(false);
  const [demolitionMessage, setDemolitionMessage] = useState('');
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [isCreatingCity, setIsCreatingCity] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CityAssembly | null>(null);
  const [cityName, setCityName] = useState('');
  const [cityError, setCityError] = useState('');
  const [isCitySaving, setIsCitySaving] = useState(false);
  const [isPlacingCity, setIsPlacingCity] = useState(false);
  const [cityPlacementMessage, setCityPlacementMessage] = useState('');
  const [isPlacingRoads, setIsPlacingRoads] = useState(false);
  const [roadPlacementMessage, setRoadPlacementMessage] = useState('');
  const [camera, setCamera] = useState(() => {
    const zoom = 0.14;
    const mapViewportWidth = Math.max(320, window.innerWidth - getSidePanelWidth(window.innerWidth));
    return {
      x: mapViewportWidth / 2 - SPAWN.x * BASE_TILE_SIZE * zoom,
      y: window.innerHeight / 2 - SPAWN.y * BASE_TILE_SIZE * zoom,
      zoom,
    };
  });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [hoveredTile, setHoveredTile] = useState<TileInfo | null>(null);
  const [selectedTile, setSelectedTile] = useState<TileInfo | null>(null);
  const gameTime = useWorldClock(snapshot);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return connectToWorld(setSnapshot, setIsOnline, setCities, setRoads);
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

  const mapPosition = useMemo(() => selectedTile ?? hoveredTile, [selectedTile, hoveredTile]);
  const zoomBy = (factor: number) =>
    setCamera((current) => {
      const zoom = Math.min(6, Math.max(0.004, current.zoom * factor));
      const ratio = zoom / current.zoom;
      const centerX = (viewport.width - getSidePanelWidth(viewport.width)) / 2;
      const centerY = viewport.height / 2;
      return {
        zoom,
        x: centerX - (centerX - current.x) * ratio,
        y: centerY - (centerY - current.y) * ratio,
      };
    });
  const centerOnSpawn = () => {
    const tilePixels = BASE_TILE_SIZE * camera.zoom;
    const mapViewportWidth = viewport.width - getSidePanelWidth(viewport.width);
    setCamera({
      ...camera,
      x: mapViewportWidth / 2 - SPAWN.x * tilePixels,
      y: viewport.height / 2 - SPAWN.y * tilePixels,
    });
  };

  const openNewAssembly = () => {
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
          onCameraChange={setCamera}
          onTileHover={setHoveredTile}
          onTileSelect={setSelectedTile}
          onCitySelect={openCityDetails}
          onCityPlace={(center) => void handleCityPlace(center)}
          onInvalidCityPlacement={handleInvalidCityPlacement}
          onRoadPlace={(path) => void handleRoadPlace(path)}
          onInvalidRoadPlacement={handleInvalidRoadPlacement}
          onRoadDemolish={(roadsToDemolish) => void demolishRoads(roadsToDemolish)}
          onCityDemolish={(city) => void demolishCity(city)}
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

        <aside className="realm-panel">
          <div className="panel-title">
            <div className="eyebrow">VISÃO GERAL</div>
            <h1>Um mundo<br /><em>em movimento.</em></h1>
            <p>Explore as terras que darão origem ao seu reino.</p>
          </div>
          <div className="panel-divider" />
          <div className="landmark">
            <div className="landmark-icon"><Sparkles size={16} /></div>
            <div><span>PONTO DE PARTIDA</span><strong>Encruzilhada Antiga</strong><small>O coração destas terras</small></div>
          </div>
          <div className="world-stats">
            <div><Waves size={15} /><span>Oceano</span><strong>33,3%</strong></div>
            <div><Wind size={15} /><span>Planícies</span><strong>66,7%</strong></div>
          </div>
          <div className="panel-divider" />
          <div className="tile-details">
            <div className="eyebrow">LOCALIZAÇÃO</div>
            {mapPosition ? (
              <>
                <strong className="terrain-name">{mapPosition.tileDef.namePt}</strong>
                <span className="coordinates">X {mapPosition.x.toLocaleString('pt-BR')} <b>·</b> Y {mapPosition.y.toLocaleString('pt-BR')}</span>
                <p>{mapPosition.tileDef.descriptionPt}</p>
              </>
            ) : (
              <>
                <strong className="terrain-name">Explore o mapa</strong>
                <span className="coordinates">Arraste para percorrer as terras</span>
                <p>Selecione um tile para consultar o terreno e as coordenadas.</p>
              </>
            )}
          </div>
          <div className="panel-footer">
            <span className="seed-label">SEMENTE DO MUNDO</span>
            <span className="seed-value">583921 <ArrowUpRight size={13} /></span>
          </div>
        </aside>

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
      </section>
      {activeCategory && (
        <section className="construction-drawer" aria-label={CATEGORY_LABELS[activeCategory]}>
          <div className="construction-drawer-heading">
            <h2>{CATEGORY_LABELS[activeCategory]}</h2>
            <button type="button" aria-label="Fechar categoria" onClick={() => setActiveCategory(null)}>
              ×
            </button>
          </div>
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
        isMaster={user.isMaster}
        onSelect={(category) => {
          setIsDemolitionMode(false);
          setDemolitionMessage('');
          setIsPlacingCity(false);
          setIsPlacingRoads(false);
          setRoadPlacementMessage('');
          setActiveCategory((current) => (current === category ? null : category));
        }}
        onToggleDemolition={() => {
          setActiveCategory(null);
          setIsPlacingCity(false);
          setIsPlacingRoads(false);
          setRoadPlacementMessage('');
          setDemolitionMessage('');
          setIsDemolitionMode((current) => !current);
        }}
      />
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
        />
      )}
    </main>
  );
}
