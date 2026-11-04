import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapConfig, MapPoint, TileId, TileInfo, WaypointPin } from '../types/map';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { getCachedTileImage, preloadTileImages, TILES } from '../utils/tileAssets';

interface MapCanvasProps {
  generator: MapGeneratorInstance;
  config: MapConfig;
  pins: WaypointPin[];
  selectedPin: WaypointPin | null;
  onSelectPin: (pin: WaypointPin | null) => void;
  onTileHover: (info: TileInfo | null) => void;
  onTileClick: (info: TileInfo) => void;
  highlightedTileId: TileId | null;
  showGrid: boolean;
  camera: { x: number; y: number; zoom: number };
  onCameraChange: (cam: { x: number; y: number; zoom: number }) => void;
}

const BASE_TILE_SIZE = 32; // Base pixels per tile at zoom 1.0

export const MapCanvas: React.FC<MapCanvasProps> = ({
  generator,
  config,
  pins,
  selectedPin,
  onSelectPin,
  onTileHover,
  onTileClick,
  highlightedTileId,
  showGrid,
  camera,
  onCameraChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; camX: number; camY: number }>({
    mouseX: 0,
    mouseY: 0,
    camX: 0,
    camY: 0,
  });
  const hasDraggedRef = useRef(false);

  const tileMap = useMemo(
    () => new Map(generator.tiles.map((t) => [t.id, t])),
    [generator.tiles]
  );

  // Main Render Loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Clear background
    ctx.fillStyle = '#0b1320';
    ctx.fillRect(0, 0, width, height);

    const effectiveTileSize = BASE_TILE_SIZE * camera.zoom;

    // Viewport bounds in world tile coordinates
    const minTileX = Math.max(0, Math.floor(-camera.x / effectiveTileSize));
    const maxTileX = Math.min(config.width, Math.ceil((-camera.x + width / dpr) / effectiveTileSize));
    const minTileY = Math.max(0, Math.floor(-camera.y / effectiveTileSize));
    const maxTileY = Math.min(config.height, Math.ceil((-camera.y + height / dpr) / effectiveTileSize));

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(camera.x, camera.y);

    // Level of Detail (LOD) handling:
    // If zoomed in where a tile is >= 12px on screen, draw the authentic high-res tile textures
    const useTexture = effectiveTileSize >= 12;

    if (useTexture) {
      // Keep crisp pixel edges when zooming in
      ctx.imageSmoothingEnabled = effectiveTileSize < 32;

      for (let ty = minTileY; ty < maxTileY; ty++) {
        const y0 = Math.floor(ty * effectiveTileSize);
        const y1 = Math.ceil((ty + 1) * effectiveTileSize);
        const tileH = y1 - y0 + 0.6; // Seamless overlap eliminates subpixel gaps

        for (let tx = minTileX; tx < maxTileX; tx++) {
          const x0 = Math.floor(tx * effectiveTileSize);
          const x1 = Math.ceil((tx + 1) * effectiveTileSize);
          const tileW = x1 - x0 + 0.6; // Seamless overlap eliminates subpixel gaps

          const { tileId } = generator.getTileAt(tx, ty);
          const tileDef = tileMap.get(tileId) || generator.tiles[0];
          const img = getCachedTileImage(tileDef.src);

          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, x0, y0, tileW, tileH);
          } else {
            ctx.fillStyle = tileDef.color;
            ctx.fillRect(x0, y0, tileW, tileH);
          }

          // Highlight specific tile if requested by user
          if (highlightedTileId && highlightedTileId === tileId) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.fillRect(x0, y0, tileW, tileH);
          }
        }
      }

      // Optional subtle grid lines when zoomed in
      if (showGrid && effectiveTileSize >= 24) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let tx = minTileX; tx <= maxTileX; tx++) {
          const sx = Math.floor(tx * effectiveTileSize);
          ctx.moveTo(sx, Math.floor(minTileY * effectiveTileSize));
          ctx.lineTo(sx, Math.ceil(maxTileY * effectiveTileSize));
        }
        for (let ty = minTileY; ty <= maxTileY; ty++) {
          const sy = Math.floor(ty * effectiveTileSize);
          ctx.moveTo(Math.floor(minTileX * effectiveTileSize), sy);
          ctx.lineTo(Math.ceil(maxTileX * effectiveTileSize), sy);
        }
        ctx.stroke();
      }
    } else {
      // Zoomed out (Macro view)
      const stride = effectiveTileSize < 3 ? Math.ceil(3 / effectiveTileSize) : 1;

      for (let ty = minTileY; ty < maxTileY; ty += stride) {
        const y0 = Math.floor(ty * effectiveTileSize);
        const y1 = Math.ceil((ty + stride) * effectiveTileSize);
        const drawH = y1 - y0 + 0.5;

        for (let tx = minTileX; tx < maxTileX; tx += stride) {
          const x0 = Math.floor(tx * effectiveTileSize);
          const x1 = Math.ceil((tx + stride) * effectiveTileSize);
          const drawW = x1 - x0 + 0.5;

          const { tileId } = generator.getTileAt(tx, ty);
          const tileDef = tileMap.get(tileId) || generator.tiles[0];

          ctx.fillStyle =
            highlightedTileId && highlightedTileId === tileId
              ? '#ffffff'
              : tileDef.color;
          ctx.fillRect(x0, y0, drawW, drawH);
        }
      }
    }

    // World Border Outline
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(0, 0, config.width * effectiveTileSize, config.height * effectiveTileSize);

    // Draw Waypoint Pins
    for (const pin of pins) {
      const px = pin.x * effectiveTileSize + effectiveTileSize / 2;
      const py = pin.y * effectiveTileSize + effectiveTileSize / 2;
      const isSelected = selectedPin?.id === pin.id;

      // Pin marker
      ctx.save();
      ctx.translate(px, py);

      // Pulse circle if selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.fill();
      }

      // Marker pin body
      ctx.beginPath();
      ctx.arc(0, -6, 7, 0, Math.PI * 2);
      ctx.fillStyle = pin.color || '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Pin needle
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      if (effectiveTileSize >= 8 || isSelected) {
        ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(pin.name, 0, -16);
      }

      ctx.restore();
    }

    ctx.restore();
  }, [camera, config, generator, highlightedTileId, pins, selectedPin, showGrid]);

  // Preload user tile images when generator tiles change
  useEffect(() => {
    preloadTileImages(generator.tiles).then(() => {
      requestAnimationFrame(render);
    });
  }, [generator.tiles, render]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      render();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  useEffect(() => {
    render();
  }, [render]);

  // Mouse / Pointer Event Handlers for Panning & Zooming
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click
    setIsDragging(true);
    hasDraggedRef.current = false;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      camX: camera.x,
      camY: camera.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDragging) {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
      }

      onCameraChange({
        ...camera,
        x: dragStartRef.current.camX + dx,
        y: dragStartRef.current.camY + dy,
      });
    }

    // Calculate hover tile info
    const effectiveTileSize = BASE_TILE_SIZE * camera.zoom;
    const worldX = Math.floor((mouseX - camera.x) / effectiveTileSize);
    const worldY = Math.floor((mouseY - camera.y) / effectiveTileSize);

    if (worldX >= 0 && worldX < config.width && worldY >= 0 && worldY < config.height) {
      const info = generator.getTileInfo(worldX, worldY);
      onTileHover(info);
    } else {
      onTileHover(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);

    // If it was a clean click without dragging, fire tile click
    if (!hasDraggedRef.current) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const effectiveTileSize = BASE_TILE_SIZE * camera.zoom;
      const worldX = Math.floor((mouseX - camera.x) / effectiveTileSize);
      const worldY = Math.floor((mouseY - camera.y) / effectiveTileSize);

      if (worldX >= 0 && worldX < config.width && worldY >= 0 && worldY < config.height) {
        const info = generator.getTileInfo(worldX, worldY);
        onTileClick(info);
      }
    }
  };

  // Wheel Zoom towards pointer
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom multiplier
    const factor = e.deltaY < 0 ? 1.2 : 0.833;
    const newZoom = Math.max(0.002, Math.min(6.0, camera.zoom * factor));

    // Keep world position under mouse fixed
    const wx = (mouseX - camera.x) / camera.zoom;
    const wy = (mouseY - camera.y) / camera.zoom;

    const newX = mouseX - wx * newZoom;
    const newY = mouseY - wy * newZoom;

    onCameraChange({
      x: newX,
      y: newY,
      zoom: newZoom,
    });
  };

  const handlePointerLeave = () => {
    if (!isDragging) {
      onTileHover(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-950 cursor-grab active:cursor-grabbing select-none"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};
