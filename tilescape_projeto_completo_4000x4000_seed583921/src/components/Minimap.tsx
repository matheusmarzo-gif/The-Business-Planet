import React, { useEffect, useRef, useState } from 'react';
import { MapConfig } from '../types/map';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { Compass, Maximize2, Minimize2 } from 'lucide-react';

interface MinimapProps {
  generator: MapGeneratorInstance;
  config: MapConfig;
  camera: { x: number; y: number; zoom: number };
  viewportSize: { width: number; height: number };
  onJumpToCoordinates: (worldX: number, worldY: number) => void;
}

const MINIMAP_SIZE = 190; // Size in CSS pixels

export const Minimap: React.FC<MinimapProps> = ({
  generator,
  config,
  camera,
  viewportSize,
  onJumpToCoordinates,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Recompute minimap pixels when generator/config changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = generator.generateMinimapData(MINIMAP_SIZE, MINIMAP_SIZE);
    const imgData = ctx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);
  }, [generator, config]);

  // Handle click / drag on minimap
  const handlePointerInteraction = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = Math.max(0, Math.min(MINIMAP_SIZE, e.clientX - rect.left));
    const my = Math.max(0, Math.min(MINIMAP_SIZE, e.clientY - rect.top));

    const targetWorldX = (mx / MINIMAP_SIZE) * config.width;
    const targetWorldY = (my / MINIMAP_SIZE) * config.height;

    onJumpToCoordinates(targetWorldX, targetWorldY);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handlePointerInteraction(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      handlePointerInteraction(e);
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Compute Viewport box on the minimap
  const baseTileSize = 32;
  const effectiveTileSize = baseTileSize * camera.zoom;

  // Camera x, y to world tile bounds
  const viewLeftTile = -camera.x / effectiveTileSize;
  const viewTopTile = -camera.y / effectiveTileSize;
  const viewWidthTiles = viewportSize.width / effectiveTileSize;
  const viewHeightTiles = viewportSize.height / effectiveTileSize;

  // Normalized to minimap pixels
  const boxX = Math.max(0, Math.min(MINIMAP_SIZE, (viewLeftTile / config.width) * MINIMAP_SIZE));
  const boxY = Math.max(0, Math.min(MINIMAP_SIZE, (viewTopTile / config.height) * MINIMAP_SIZE));
  const boxW = Math.max(
    4,
    Math.min(MINIMAP_SIZE - boxX, (viewWidthTiles / config.width) * MINIMAP_SIZE)
  );
  const boxH = Math.max(
    4,
    Math.min(MINIMAP_SIZE - boxY, (viewHeightTiles / config.height) * MINIMAP_SIZE)
  );

  return (
    <div className="absolute top-4 right-4 z-20 flex flex-col bg-slate-900/90 backdrop-blur-md border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden transition-all duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 text-xs font-medium text-slate-300">
        <div className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-sky-400" />
          <span>Visão Geral</span>
          <span className="text-slate-500 font-mono text-[11px] tabular-nums">
            {config.width}x{config.height}
          </span>
        </div>
        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
          title={isMinimized ? 'Expandir' : 'Recolher'}
        >
          {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Body */}
      {!isMinimized && (
        <div className="p-2 flex flex-col items-center">
          <div
            className="relative cursor-crosshair rounded border border-slate-700/80 overflow-hidden shadow-inner bg-slate-950"
            style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas
              ref={canvasRef}
              width={MINIMAP_SIZE}
              height={MINIMAP_SIZE}
              className="block w-full h-full"
            />

            {/* Viewport Box */}
            <div
              className="absolute border-2 border-sky-400 bg-sky-400/20 pointer-events-none transition-all duration-75"
              style={{
                left: `${boxX}px`,
                top: `${boxY}px`,
                width: `${boxW}px`,
                height: `${boxH}px`,
              }}
            />
          </div>

          <div className="w-full flex justify-between items-center mt-2 px-1 text-[11px] text-slate-400">
            <span className="font-mono tabular-nums">
              ({Math.round(Math.max(0, viewLeftTile + viewWidthTiles / 2))},{' '}
              {Math.round(Math.max(0, viewTopTile + viewHeightTiles / 2))})
            </span>
            <button
              onClick={() => onJumpToCoordinates(config.width / 2, config.height / 2)}
              className="text-sky-400 hover:text-sky-300 font-medium hover:underline text-[11px]"
            >
              Centralizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
