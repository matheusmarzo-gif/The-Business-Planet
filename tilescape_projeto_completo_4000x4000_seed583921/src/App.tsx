import React, { useCallback, useEffect, useState } from 'react';
import { ControlsPanel } from './components/ControlsPanel';
import { ExportModal } from './components/ExportModal';
import { MapCanvas } from './components/MapCanvas';
import { Minimap } from './components/Minimap';
import { TileEditorModal } from './components/TileEditorModal';
import { TileInspector } from './components/TileInspector';
import { BiomeStats, MapConfig, TileDefinition, TileId, TileInfo, WaypointPin } from './types/map';
import { createMapGenerator, MapGeneratorInstance } from './utils/mapGenerator';
import { cacheTileImage, DEFAULT_TILE_LIST, extractDominantColor } from './utils/tileAssets';
import { exportProjectToZip } from './utils/projectZipExport';
import { Download, FileArchive, Loader2, Sliders } from 'lucide-react';

const BASE_TILE_SIZE = 32;

const DEFAULT_CONFIG: MapConfig = {
  width: 4000, // Default 4000x4000
  height: 4000,
  seed: 583921,
  scale: 0.008,
  seaLevel: 0.46,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2.0,
  moistureScale: 0.006,
  flowerDensity: 0.5,
  preset: 'continents',
};

export default function App() {
  const [config, setConfig] = useState<MapConfig>(DEFAULT_CONFIG);
  const [tiles, setTiles] = useState<TileDefinition[]>(DEFAULT_TILE_LIST);

  const [generator, setGenerator] = useState<MapGeneratorInstance>(() =>
    createMapGenerator(DEFAULT_CONFIG, DEFAULT_TILE_LIST)
  );
  const [stats, setStats] = useState<BiomeStats[]>(() =>
    generator.calculateStats(60)
  );

  // Viewport camera
  const [camera, setCamera] = useState({
    x: 0,
    y: 0,
    zoom: 0.5,
  });

  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth || 1200,
    height: window.innerHeight || 800,
  });

  // UI States
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isTileEditorOpen, setIsTileEditorOpen] = useState(false);
  const [tileToEdit, setTileToEdit] = useState<TileDefinition | null>(null);

  const [highlightedTileId, setHighlightedTileId] = useState<TileId | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [hoverTileInfo, setHoverTileInfo] = useState<TileInfo | null>(null);
  const [selectedTileInfo, setSelectedTileInfo] = useState<TileInfo | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  // Waypoints / Pins
  const [pins, setPins] = useState<WaypointPin[]>([
    {
      id: 'pin_spawn',
      name: 'Ponto de Partida',
      x: 2000,
      y: 2000,
      color: '#38bdf8',
      createdAt: Date.now(),
    },
  ]);
  const [selectedPin, setSelectedPin] = useState<WaypointPin | null>(null);

  // Center the camera on start
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    setViewportSize({ width: w, height: h });

    const initialZoom = 0.5;
    const effectiveTile = BASE_TILE_SIZE * initialZoom;
    const startCamX = w / 2 - (config.width / 2) * effectiveTile;
    const startCamY = h / 2 - (config.height / 2) * effectiveTile;

    setCamera({
      x: startCamX,
      y: startCamY,
      zoom: initialZoom,
    });
  }, []);

  // Rebuild generator helper
  const rebuildGenerator = (newConfig: MapConfig, newTiles: TileDefinition[]) => {
    setIsGenerating(true);
    const gen = createMapGenerator(newConfig, newTiles);
    setGenerator(gen);
    setStats(gen.calculateStats(60));
    setTimeout(() => {
      setIsGenerating(false);
    }, 50);
  };

  // Update generator when config changes
  const handleConfigChange = (newConfig: MapConfig) => {
    setConfig(newConfig);
    rebuildGenerator(newConfig, tiles);

    // Clear hover/select if out of bounds
    if (
      selectedTileInfo &&
      (selectedTileInfo.x >= newConfig.width || selectedTileInfo.y >= newConfig.height)
    ) {
      setSelectedTileInfo(null);
    }
  };

  // Tile Management Handlers: Import / Edit / Replace / Delete / Reset
  const handleSaveTile = (savedTile: TileDefinition) => {
    setTiles((prev) => {
      const exists = prev.some((t) => t.id === savedTile.id);
      const updated = exists
        ? prev.map((t) => (t.id === savedTile.id ? savedTile : t))
        : [...prev, savedTile];
      rebuildGenerator(config, updated);
      return updated;
    });
  };

  const handleDeleteTile = (tileId: string) => {
    setTiles((prev) => {
      const tileToDelete = prev.find((t) => t.id === tileId);
      if (!tileToDelete) return prev;
      const sameCatCount = prev.filter(
        (t) => t.category === tileToDelete.category
      ).length;
      if (sameCatCount <= 1) {
        return prev;
      }
      const updated = prev.filter((t) => t.id !== tileId);
      rebuildGenerator(config, updated);
      return updated;
    });
    if (highlightedTileId === tileId) setHighlightedTileId(null);
  };

  const handleReplaceTileImage = async (tileId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const domColor = await extractDominantColor(dataUrl);
      await cacheTileImage(dataUrl, dataUrl);

      setTiles((prev) => {
        const updated = prev.map((t) => {
          if (t.id === tileId) {
            return {
              ...t,
              src: dataUrl,
              color: domColor,
              isCustom: true,
            };
          }
          return t;
        });
        rebuildGenerator(config, updated);
        return updated;
      });
    };
    reader.readAsDataURL(file);
  };

  const handleResetTiles = () => {
    setTiles(DEFAULT_TILE_LIST);
    rebuildGenerator(config, DEFAULT_TILE_LIST);
    setHighlightedTileId(null);
  };

  const handleExportZipDirect = async () => {
    setIsZipping(true);
    try {
      await exportProjectToZip(config, generator, tiles, stats, pins);
    } catch (err) {
      console.error('Error generating project zip:', err);
    } finally {
      setIsZipping(false);
    }
  };

  // Jump to specific world coordinates
  const handleJumpToCoordinates = useCallback(
    (worldX: number, worldY: number, customZoom?: number) => {
      const zoom = customZoom !== undefined ? customZoom : camera.zoom;
      const effectiveTile = BASE_TILE_SIZE * zoom;
      const targetCamX = viewportSize.width / 2 - worldX * effectiveTile;
      const targetCamY = viewportSize.height / 2 - worldY * effectiveTile;

      setCamera({
        x: targetCamX,
        y: targetCamY,
        zoom,
      });
    },
    [camera.zoom, viewportSize.height, viewportSize.width]
  );

  // Zoom controls
  const handleZoomIn = () => {
    const newZoom = Math.min(6.0, camera.zoom * 1.35);
    const scaleFactor = newZoom / camera.zoom;
    const centerX = viewportSize.width / 2;
    const centerY = viewportSize.height / 2;

    setCamera({
      x: centerX - (centerX - camera.x) * scaleFactor,
      y: centerY - (centerY - camera.y) * scaleFactor,
      zoom: newZoom,
    });
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(0.002, camera.zoom / 1.35);
    const scaleFactor = newZoom / camera.zoom;
    const centerX = viewportSize.width / 2;
    const centerY = viewportSize.height / 2;

    setCamera({
      x: centerX - (centerX - camera.x) * scaleFactor,
      y: centerY - (centerY - camera.y) * scaleFactor,
      zoom: newZoom,
    });
  };

  const handleResetZoom = () => {
    handleJumpToCoordinates(
      -camera.x / (BASE_TILE_SIZE * camera.zoom) +
        viewportSize.width / (2 * BASE_TILE_SIZE * camera.zoom),
      -camera.y / (BASE_TILE_SIZE * camera.zoom) +
        viewportSize.height / (2 * BASE_TILE_SIZE * camera.zoom),
      1.0
    );
  };

  const handleFitMap = () => {
    const zoomX = viewportSize.width / (config.width * BASE_TILE_SIZE);
    const zoomY = viewportSize.height / (config.height * BASE_TILE_SIZE);
    const fitZoom = Math.min(zoomX, zoomY) * 0.92;

    const effectiveTile = BASE_TILE_SIZE * fitZoom;
    const startCamX = viewportSize.width / 2 - (config.width / 2) * effectiveTile;
    const startCamY = viewportSize.height / 2 - (config.height / 2) * effectiveTile;

    setCamera({
      x: startCamX,
      y: startCamY,
      zoom: fitZoom,
    });
  };

  // Pin management
  const handleAddPin = (name: string, x: number, y: number) => {
    const newPin: WaypointPin = {
      id: `pin_${Date.now()}`,
      name,
      x,
      y,
      color: '#38bdf8',
      createdAt: Date.now(),
    };
    setPins((prev) => [...prev, newPin]);
  };

  const handleDeletePin = (id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    if (selectedPin?.id === id) setSelectedPin(null);
  };

  const handleJumpToPin = (pin: WaypointPin) => {
    setSelectedPin(pin);
    handleJumpToCoordinates(pin.x, pin.y, Math.max(0.8, camera.zoom));
  };

  const totalTilesFormatted = (config.width * config.height).toLocaleString();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none flex flex-col font-sans">
      {/* Top Bar adhering to Top Bar Contract */}
      <header className="relative z-20 flex items-center justify-between gap-8 px-6 py-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 shrink-0">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="flex items-center gap-2 p-1.5 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
            title="Abrir painel de controle"
          >
            <Sliders className="w-4 h-4 text-sky-400" />
            <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
              TileScape 4K
            </span>
          </button>
        </div>

        {/* Zone 2: Navigation Links / Meta context */}
        <nav className="hidden md:flex items-center gap-6 text-xs text-slate-400">
          <span className="font-mono tabular-nums text-slate-300 whitespace-nowrap">
            {config.width} × {config.height} tiles
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="whitespace-nowrap">
            {totalTilesFormatted} blocos procedurais
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="font-mono text-slate-300 whitespace-nowrap">
            Seed #{config.seed}
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="whitespace-nowrap text-sky-400/90">
            {tiles.length} tiles ativos
          </span>
        </nav>

        {/* Zone 3: Primary Action & Export options */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleExportZipDirect}
            disabled={isZipping}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shadow-sm disabled:opacity-60 cursor-pointer"
            title="Exportar todo o projeto em um arquivo .ZIP (texturas, mapas, dados e visualizador)"
          >
            {isZipping ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileArchive className="w-3.5 h-3.5" />
            )}
            <span>{isZipping ? 'Exportando .ZIP...' : 'Exportar Projeto (.ZIP)'}</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap border border-slate-700"
            title="Mais opções de exportação (PNG, JSON, resoluções)"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>Opções</span>
          </button>
        </div>
      </header>

      {/* Main Map Viewport Area */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        {/* Interactive Canvas */}
        <MapCanvas
          generator={generator}
          config={config}
          pins={pins}
          selectedPin={selectedPin}
          onSelectPin={setSelectedPin}
          onTileHover={setHoverTileInfo}
          onTileClick={(info) => setSelectedTileInfo(info)}
          highlightedTileId={highlightedTileId}
          showGrid={showGrid}
          camera={camera}
          onCameraChange={setCamera}
        />

        {/* Interactive Minimap */}
        <Minimap
          generator={generator}
          config={config}
          camera={camera}
          viewportSize={viewportSize}
          onJumpToCoordinates={handleJumpToCoordinates}
        />

        {/* Bottom Floating Inspector and Nav Toolbar */}
        <TileInspector
          hoverInfo={hoverTileInfo}
          selectedInfo={selectedTileInfo}
          onClearSelected={() => setSelectedTileInfo(null)}
          camera={camera}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          onFitMap={handleFitMap}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(!showGrid)}
          pins={pins}
          onAddPin={handleAddPin}
          onDeletePin={handleDeletePin}
          onJumpToPin={handleJumpToPin}
        />

        {/* Sidebar Controls Drawer */}
        <ControlsPanel
          config={config}
          onChangeConfig={handleConfigChange}
          tiles={tiles}
          stats={stats}
          highlightedTileId={highlightedTileId}
          onToggleHighlight={setHighlightedTileId}
          onOpenExport={() => setIsExportModalOpen(true)}
          onExportZip={handleExportZipDirect}
          onOpenImportModal={() => {
            setTileToEdit(null);
            setIsTileEditorOpen(true);
          }}
          onEditTile={(tile) => {
            setTileToEdit(tile);
            setIsTileEditorOpen(true);
          }}
          onDeleteTile={handleDeleteTile}
          onReplaceTileImage={handleReplaceTileImage}
          onResetTiles={handleResetTiles}
          isOpen={isSidebarOpen}
          onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
          isGenerating={isGenerating}
        />
      </main>

      {/* Tile Editor / Import Modal */}
      <TileEditorModal
        isOpen={isTileEditorOpen}
        onClose={() => {
          setIsTileEditorOpen(false);
          setTileToEdit(null);
        }}
        tileToEdit={tileToEdit}
        onSaveTile={handleSaveTile}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        config={config}
        generator={generator}
        tiles={tiles}
        stats={stats}
        pins={pins}
      />
    </div>
  );
}
