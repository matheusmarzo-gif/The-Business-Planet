import React, { useRef, useState } from 'react';
import { BiomeStats, MapConfig, TerrainPreset, TileDefinition, TileId } from '../types/map';
import {
  ChevronLeft,
  ChevronRight,
  Dices,
  Edit2,
  Eye,
  EyeOff,
  FileArchive,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';

interface ControlsPanelProps {
  config: MapConfig;
  onChangeConfig: (newConfig: MapConfig) => void;
  tiles: TileDefinition[];
  stats: BiomeStats[];
  highlightedTileId: TileId | null;
  onToggleHighlight: (tileId: TileId | null) => void;
  onOpenExport: () => void;
  onExportZip?: () => void;
  onOpenImportModal: () => void;
  onEditTile: (tile: TileDefinition) => void;
  onDeleteTile: (tileId: string) => void;
  onReplaceTileImage: (tileId: string, file: File) => void;
  onResetTiles: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  isGenerating: boolean;
}

const PRESET_OPTIONS: { id: TerrainPreset; label: string; desc: string }[] = [
  { id: 'continents', label: 'Continentes Naturais', desc: 'Oceanos e massas continentais equilibradas' },
  { id: 'archipelago', label: 'Arquipélago de Ilhas', desc: 'Cadeias de ilhas isoladas em alto mar' },
  { id: 'pangaea', label: 'Supercontinente (Pangaea)', desc: 'Massa de terra central rodeada por oceano' },
  { id: 'lakes', label: 'Grandes Lagos & Enseadas', desc: 'Terra contínua com vastos corpos d’água' },
  { id: 'river_valleys', label: 'Vales & Rios Meandros', desc: 'Canais sinuosos e bacias hidrográficas' },
];

const SIZE_PRESETS = [
  { label: '500x500', w: 500, h: 500 },
  { label: '1000x1000', w: 1000, h: 1000 },
  { label: '2000x2000', w: 2000, h: 2000 },
  { label: '4000x4000 (Padrão)', w: 4000, h: 4000 },
  { label: '8000x8000 (Épico)', w: 8000, h: 8000 },
];

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  config,
  onChangeConfig,
  tiles,
  stats,
  highlightedTileId,
  onToggleHighlight,
  onOpenExport,
  onExportZip,
  onOpenImportModal,
  onEditTile,
  onDeleteTile,
  onReplaceTileImage,
  onResetTiles,
  isOpen,
  onToggleOpen,
  isGenerating,
}) => {
  const [activeTab, setActiveTab] = useState<'generation' | 'biomes'>('generation');
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const targetReplaceTileIdRef = useRef<string | null>(null);

  const handleRandomizeSeed = () => {
    const newSeed = Math.floor(Math.random() * 900000) + 100000;
    onChangeConfig({ ...config, seed: newSeed });
  };

  const handleSizePreset = (w: number, h: number) => {
    onChangeConfig({ ...config, width: w, height: h });
  };

  const handleTriggerReplaceImage = (tileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    targetReplaceTileIdRef.current = tileId;
    replaceFileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const tileId = targetReplaceTileIdRef.current;
    if (file && tileId) {
      onReplaceTileImage(tileId, file);
    }
    // Reset file input
    if (replaceFileInputRef.current) {
      replaceFileInputRef.current.value = '';
    }
  };

  const waterCount = tiles.filter((t) => t.category === 'water').length;
  const landCount = tiles.filter((t) => t.category === 'land').length;

  return (
    <>
      {/* Hidden file input for quick tile replacement */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Toggle button when closed */}
      {!isOpen && (
        <button
          onClick={onToggleOpen}
          className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/70 rounded-lg shadow-xl backdrop-blur-md text-xs font-semibold transition-colors"
        >
          <Sliders className="w-4 h-4 text-sky-400" />
          <span>Configurar Mapa</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        </button>
      )}

      {/* Main Drawer / Sidebar */}
      <aside
        className={`absolute top-0 left-0 bottom-0 z-30 w-84 sm:w-96 bg-slate-900/95 backdrop-blur-xl border-r border-slate-800 text-slate-200 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">
              Gerador de Terreno
            </h1>
            <p className="text-xs text-slate-400">
              Perlin Noise · {config.width}x{config.height} tiles
            </p>
          </div>
          <button
            onClick={onToggleOpen}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Fechar painel"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1.5 mx-4 my-3 bg-slate-950/70 border border-slate-800/80 rounded-lg">
          <button
            onClick={() => setActiveTab('generation')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'generation'
                ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Parâmetros</span>
          </button>
          <button
            onClick={() => setActiveTab('biomes')}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'biomes'
                ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Tiles & Biomas ({tiles.length})</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-6 text-xs">
          {activeTab === 'generation' ? (
            <>
              {/* Dimensões do Mapa */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200">
                    Dimensões dos Tiles
                  </label>
                  <span className="font-mono text-slate-400 text-[11px] tabular-nums">
                    {(config.width * config.height).toLocaleString()} tiles
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">
                      Largura (Tiles)
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={12000}
                      step={100}
                      value={config.width}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          width: Math.max(100, parseInt(e.target.value) || 4000),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">
                      Altura (Tiles)
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={12000}
                      step={100}
                      value={config.height}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          height: Math.max(100, parseInt(e.target.value) || 4000),
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-sky-400"
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SIZE_PRESETS.map((p) => {
                    const isSelected = config.width === p.w && config.height === p.h;
                    return (
                      <button
                        key={p.label}
                        onClick={() => handleSizePreset(p.w, p.h)}
                        className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                          isSelected
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Semente do Mundo */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <label className="font-semibold text-slate-200 block">
                  Semente (Seed)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={config.seed}
                    onChange={(e) =>
                      onChangeConfig({
                        ...config,
                        seed: parseInt(e.target.value) || 0,
                      })
                    }
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-sky-400"
                  />
                  <button
                    onClick={handleRandomizeSeed}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg font-medium transition-colors"
                    title="Gerar Semente Aleatória"
                  >
                    <Dices className="w-4 h-4" />
                    <span>Aleatório</span>
                  </button>
                </div>
              </div>

              {/* Formação do Terreno (Preset) */}
              <div className="space-y-2 pt-1 border-t border-slate-800">
                <label className="font-semibold text-slate-200 block">
                  Tipo de Formação do Terreno
                </label>
                <div className="space-y-1.5">
                  {PRESET_OPTIONS.map((opt) => {
                    const isSelected = config.preset === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => onChangeConfig({ ...config, preset: opt.id })}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-sky-950/40 border-sky-500/60 text-white'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-medium text-xs text-white">{opt.label}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Parâmetros de Ruído Perlin */}
              <div className="space-y-4 pt-1 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200">
                    Parâmetros do Ruído Perlin
                  </label>
                  <span className="text-sky-400 text-[11px] font-mono">fBm 2D</span>
                </div>

                {/* Escala / Frequência dos Continentes */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Escala dos Continentes</span>
                    <span className="font-mono text-slate-300">
                      {(config.scale * 1000).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.002"
                    max="0.03"
                    step="0.001"
                    value={config.scale}
                    onChange={(e) =>
                      onChangeConfig({ ...config, scale: parseFloat(e.target.value) })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Grandes massas</span>
                    <span>Ilhas fragmentadas</span>
                  </div>
                </div>

                {/* Nível do Mar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Nível do Mar (Água)</span>
                    <span className="font-mono text-slate-300">
                      {Math.round(config.seaLevel * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.15"
                    max="0.80"
                    step="0.02"
                    value={config.seaLevel}
                    onChange={(e) =>
                      onChangeConfig({ ...config, seaLevel: parseFloat(e.target.value) })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Mais Terra</span>
                    <span>Mais Oceano</span>
                  </div>
                </div>

                {/* Oitavas do Ruído */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Detalhe Fractal (Oitavas)</span>
                    <span className="font-mono text-slate-300">{config.octaves}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    value={config.octaves}
                    onChange={(e) =>
                      onChangeConfig({ ...config, octaves: parseInt(e.target.value) })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                {/* Densidade de Flores & Botões de Ouro */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Floração & Vegetação</span>
                    <span className="font-mono text-slate-300">
                      {Math.round(config.flowerDensity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="0.9"
                    step="0.05"
                    value={config.flowerDensity}
                    onChange={(e) =>
                      onChangeConfig({
                        ...config,
                        flowerDensity: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>
            </>
          ) : (
            /* Tiles & Biome Distribution Tab */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-200">Gerenciador de Tiles</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Importe texturas, substitua imagens ou delete biomas.
                  </p>
                </div>
                <button
                  onClick={onOpenImportModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg text-xs transition-colors shadow-sm"
                  title="Importar novo tile do computador"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Importar</span>
                </button>
              </div>

              {/* Tiles List */}
              <div className="space-y-2.5">
                {tiles.map((tile) => {
                  const stat = stats.find((s) => s.tileId === tile.id);
                  const isHighlighted = highlightedTileId === tile.id;
                  const pct = stat ? stat.percentage.toFixed(1) : '0.0';

                  const canDelete =
                    (tile.category === 'water' && waterCount > 1) ||
                    (tile.category === 'land' && landCount > 1);

                  return (
                    <div
                      key={tile.id}
                      onClick={() =>
                        onToggleHighlight(isHighlighted ? null : tile.id)
                      }
                      className={`group p-2.5 rounded-xl border cursor-pointer transition-all ${
                        isHighlighted
                          ? 'bg-sky-950/60 border-sky-400 ring-1 ring-sky-400'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Tile Thumbnail with quick replace button overlay */}
                        <div className="relative w-11 h-11 rounded-lg border border-slate-700 overflow-hidden shrink-0 bg-slate-900 group/thumb">
                          <img
                            src={tile.src}
                            alt={tile.namePt}
                            className="w-full h-full object-cover pixelated"
                          />
                          <button
                            onClick={(e) => handleTriggerReplaceImage(tile.id, e)}
                            className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover/thumb:opacity-100 flex flex-col items-center justify-center text-[9px] text-sky-400 font-medium transition-opacity"
                            title="Substituir textura deste tile"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>Trocar</span>
                          </button>
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: tile.color }}
                              />
                              <span className="font-semibold text-xs text-white truncate">
                                {tile.namePt}
                              </span>
                            </div>
                            <span className="font-mono text-slate-400 text-[11px] tabular-nums shrink-0">
                              {pct}%
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                            <span className="capitalize text-slate-300">
                              {tile.category === 'water' ? 'Água' : 'Terra'}
                            </span>
                            {tile.isCustom && (
                              <span className="text-sky-400">· Importado</span>
                            )}
                          </div>

                          {/* Mini Progress Bar */}
                          <div className="w-full h-1 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: tile.color,
                              }}
                            />
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center justify-end gap-1 mt-2 pt-1.5 border-t border-slate-800/80">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleHighlight(isHighlighted ? null : tile.id);
                              }}
                              className={`p-1 rounded text-xs transition-colors ${
                                isHighlighted
                                  ? 'text-sky-400 bg-sky-950/60'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title={isHighlighted ? 'Ocultar destaque' : 'Destacar no mapa'}
                            >
                              {isHighlighted ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              onClick={(e) => handleTriggerReplaceImage(tile.id, e)}
                              className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                              title="Substituir Imagem (Upload PNG/JPG)"
                            >
                              <Upload className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditTile(tile);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                              title="Editar configurações e propriedades do tile"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              disabled={!canDelete}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (canDelete) {
                                  onDeleteTile(tile.id);
                                }
                              }}
                              className={`p-1 rounded transition-colors ${
                                canDelete
                                  ? 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
                                  : 'text-slate-700 cursor-not-allowed'
                              }`}
                              title={
                                canDelete
                                  ? 'Deletar tile do mapa'
                                  : 'Não é possível deletar o último tile desta categoria'
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reset tiles option */}
              <div className="pt-2">
                <button
                  onClick={onResetTiles}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-medium transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar 7 Tiles Originais</span>
                </button>
              </div>

              {highlightedTileId && (
                <button
                  onClick={() => onToggleHighlight(null)}
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors"
                >
                  Limpar Destaque de Tile
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 space-y-2">
          <button
            onClick={handleRandomizeSeed}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg text-xs shadow-lg transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>Gerar Novo Mundo</span>
          </button>

          {onExportZip && (
            <button
              onClick={onExportZip}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-semibold rounded-lg text-xs transition-colors"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Exportar Projeto Completo (.ZIP)</span>
            </button>
          )}

          <button
            onClick={onOpenExport}
            className="w-full py-1.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg text-xs transition-colors"
          >
            Opções de Exportação (PNG / JSON)
          </button>
        </div>
      </aside>
    </>
  );
};
