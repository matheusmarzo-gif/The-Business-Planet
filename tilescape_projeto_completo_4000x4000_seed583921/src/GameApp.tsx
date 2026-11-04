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
import { GameMap } from './game/GameMap';
import { connectToWorld, WorldSnapshot } from './game/worldClient';
import { TileInfo } from './types/map';
import { createMapGenerator } from './utils/mapGenerator';
import { DEFAULT_TILE_LIST } from './utils/tileAssets';

const WORLD_CONFIG = {
  width: 4000,
  height: 4000,
  seed: 583921,
  scale: 0.008,
  seaLevel: 0.46,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  moistureScale: 0.006,
  flowerDensity: 0.5,
  preset: 'continents' as const,
};
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

export default function GameApp() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [isOnline, setIsOnline] = useState(false);
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
    return connectToWorld(setSnapshot, setIsOnline);
  }, []);

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
        </div>
      </header>

      <section className="world-stage">
        <GameMap
          generator={generator}
          camera={camera}
          onCameraChange={setCamera}
          onTileHover={setHoveredTile}
          onTileSelect={setSelectedTile}
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
      </section>
    </main>
  );
}
