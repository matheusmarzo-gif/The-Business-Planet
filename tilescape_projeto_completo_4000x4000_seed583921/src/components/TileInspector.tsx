import React, { useState } from 'react';
import { TileInfo, WaypointPin } from '../types/map';
import {
  Grid,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';

interface TileInspectorProps {
  hoverInfo: TileInfo | null;
  selectedInfo: TileInfo | null;
  onClearSelected: () => void;
  camera: { x: number; y: number; zoom: number };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitMap: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  pins: WaypointPin[];
  onAddPin: (name: string, x: number, y: number) => void;
  onDeletePin: (id: string) => void;
  onJumpToPin: (pin: WaypointPin) => void;
}

export const TileInspector: React.FC<TileInspectorProps> = ({
  hoverInfo,
  selectedInfo,
  onClearSelected,
  camera,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitMap,
  showGrid,
  onToggleGrid,
  pins,
  onAddPin,
  onDeletePin,
  onJumpToPin,
}) => {
  const currentTile = selectedInfo || hoverInfo;
  const [showPinsList, setShowPinsList] = useState(false);
  const [newPinName, setNewPinName] = useState('');
  const [isAddingPin, setIsAddingPin] = useState(false);

  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTile || !newPinName.trim()) return;
    onAddPin(newPinName.trim(), currentTile.x, currentTile.y);
    setNewPinName('');
    setIsAddingPin(false);
  };

  return (
    <>
      {/* Bottom Floating Navigation Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-700/70 rounded-xl shadow-2xl text-slate-200">
        <button
          onClick={onZoomOut}
          className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
          title="Reduzir Zoom (Scroll para trás)"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          onClick={onResetZoom}
          className="px-2.5 py-1 hover:bg-slate-800 rounded-lg font-mono text-xs text-sky-400 font-semibold tabular-nums transition-colors"
          title="Redefinir Zoom para 100%"
        >
          {Math.round(camera.zoom * 100)}%
        </button>

        <button
          onClick={onZoomIn}
          className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
          title="Aumentar Zoom (Scroll para frente)"
        >
          <Plus className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-slate-700 mx-1" />

        <button
          onClick={onFitMap}
          className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
          title="Ajustar Mapa à Tela"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={onToggleGrid}
          className={`p-2 rounded-lg transition-colors ${
            showGrid ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Grade de Tiles"
        >
          <Grid className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-slate-700 mx-1" />

        <button
          onClick={() => setShowPinsList(!showPinsList)}
          className={`relative p-2 rounded-lg transition-colors ${
            showPinsList ? 'bg-sky-500/20 text-sky-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Marcadores e Pontos de Interesse"
        >
          <MapPin className="w-4 h-4" />
          {pins.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-sky-500 text-[10px] font-bold text-slate-950 rounded-full flex items-center justify-center">
              {pins.length}
            </span>
          )}
        </button>
      </div>

      {/* Tile Hover & Inspector Card (Bottom Left) */}
      {currentTile && (
        <div className="absolute bottom-6 left-6 z-20 flex items-center gap-3 p-3 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl text-slate-200 min-w-64">
          <div className="w-12 h-12 rounded-lg border border-slate-600/80 overflow-hidden shrink-0 bg-slate-950">
            <img
              src={currentTile.tileDef.src}
              alt={currentTile.tileDef.namePt}
              className="w-full h-full object-cover pixelated"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-xs text-white truncate">
                {currentTile.tileDef.namePt}
              </span>
              <span className="font-mono text-sky-400 text-[11px] tabular-nums shrink-0">
                X:{currentTile.x} Y:{currentTile.y}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
              <span>Alt: {Math.round(currentTile.elevation * 100)}%</span>
              <span>·</span>
              <span>Umid: {Math.round(currentTile.moisture * 100)}%</span>
            </div>
          </div>

          {selectedInfo && (
            <div className="flex items-center gap-1 pl-1 border-l border-slate-700">
              <button
                onClick={() => setIsAddingPin(true)}
                className="p-1.5 hover:bg-slate-800 rounded text-sky-400 hover:text-sky-300"
                title="Criar Marcador nesta coordenada"
              >
                <MapPin className="w-4 h-4" />
              </button>
              <button
                onClick={onClearSelected}
                className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                title="Fechar seleção"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Pin Modal */}
      {isAddingPin && currentTile && (
        <div className="absolute inset-0 z-40 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePin}
            className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-sky-400" />
                Novo Marcador
              </h3>
              <button
                type="button"
                onClick={() => setIsAddingPin(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Coordenada selecionada: <span className="font-mono text-sky-400">({currentTile.x}, {currentTile.y})</span>
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Nome do Ponto de Interesse
              </label>
              <input
                type="text"
                autoFocus
                placeholder="Ex: Ponto Inicial, Baía das Flores..."
                value={newPinName}
                onChange={(e) => setNewPinName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddingPin(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newPinName.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-sky-500 hover:bg-sky-400 text-slate-950 disabled:opacity-50"
              >
                Salvar Marcador
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Pins List Popover */}
      {showPinsList && (
        <div className="absolute bottom-20 right-6 z-30 w-72 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="font-semibold text-xs text-white flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-sky-400" />
              Marcadores Salvos
            </h4>
            <button
              onClick={() => setShowPinsList(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {pins.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              Nenhum marcador criado. Clique em qualquer tile no mapa para adicionar!
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {pins.map((pin) => (
                <div
                  key={pin.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-slate-700 text-xs"
                >
                  <button
                    onClick={() => onJumpToPin(pin)}
                    className="flex-1 text-left truncate hover:text-sky-400 transition-colors"
                  >
                    <div className="font-medium text-white truncate">{pin.name}</div>
                    <div className="font-mono text-[10px] text-slate-400">
                      X: {pin.x} · Y: {pin.y}
                    </div>
                  </button>
                  <button
                    onClick={() => onDeletePin(pin.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                    title="Excluir marcador"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};
