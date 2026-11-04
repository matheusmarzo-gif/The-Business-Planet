import { useCallback, useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { TileInfo } from '../types/map';

const BASE_TILE_SIZE = 24;
const SPAWN = { x: 2000, y: 2000 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface GameMapProps {
  generator: MapGeneratorInstance;
  camera: { x: number; y: number; zoom: number };
  onCameraChange: (camera: { x: number; y: number; zoom: number }) => void;
  onTileHover: (tile: TileInfo | null) => void;
  onTileSelect: (tile: TileInfo) => void;
}

export function GameMap({
  generator,
  camera,
  onCameraChange,
  onTileHover,
  onTileSelect,
}: GameMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layerRef = useRef<PIXI.Container | null>(null);
  const cameraRef = useRef(camera);
  const dragRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const app = new PIXI.Application({
      backgroundColor: 0x122b35,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      resizeTo: host,
    });
    const layer = new PIXI.Container();
    app.stage.addChild(layer);
    host.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;
    layerRef.current = layer;

    return () => {
      layerRef.current = null;
      appRef.current = null;
      app.destroy(true, { children: true, texture: false, baseTexture: false });
    };
  }, []);

  const renderMap = useCallback(() => {
    const app = appRef.current;
    const layer = layerRef.current;
    if (!app || !layer || !app.renderer) return;

    for (const child of layer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }

    const { width, height } = app.screen;
    const { x, y, zoom } = camera;
    const tilePixels = BASE_TILE_SIZE * zoom;
    const minX = clamp(Math.floor(-x / tilePixels), 0, generator.config.width - 1);
    const maxX = clamp(Math.ceil((width - x) / tilePixels), 0, generator.config.width);
    const minY = clamp(Math.floor(-y / tilePixels), 0, generator.config.height - 1);
    const maxY = clamp(Math.ceil((height - y) / tilePixels), 0, generator.config.height);

    layer.position.set(x, y);
    layer.scale.set(tilePixels);

    if (tilePixels >= 12) {
      const tileTextures = new Map(
        generator.tiles.map((tile) => [tile.id, PIXI.Texture.from(tile.src)]),
      );
      for (let ty = minY; ty < maxY; ty += 1) {
        for (let tx = minX; tx < maxX; tx += 1) {
          const tileId = generator.getTileAt(tx, ty).tileId;
          const texture = tileTextures.get(tileId);
          if (!texture) continue;
          const sprite = new PIXI.Sprite(texture);
          sprite.position.set(tx, ty);
          sprite.width = 1.02;
          sprite.height = 1.02;
          layer.addChild(sprite);
        }
      }
    } else {
      const stride = Math.max(1, Math.ceil(8 / tilePixels));
      const colors = new Map(generator.tiles.map((tile) => [tile.id, tile.color]));
      const graphics = new PIXI.Graphics();
      for (let ty = minY; ty < maxY; ty += stride) {
        for (let tx = minX; tx < maxX; tx += stride) {
          const tileId = generator.getTileAt(tx, ty).tileId;
          graphics.beginFill(PIXI.utils.string2hex(colors.get(tileId) ?? '#45864a'));
          graphics.drawRect(tx, ty, stride, stride);
          graphics.endFill();
        }
      }
      layer.addChild(graphics);
    }

    const border = new PIXI.Graphics();
    border.lineStyle(2 / tilePixels, 0xd5c08b, 0.8);
    border.drawRect(0, 0, generator.config.width, generator.config.height);
    layer.addChild(border);

    const marker = new PIXI.Graphics();
    marker.beginFill(0xf1c87b);
    marker.lineStyle(0.12, 0x332b1e, 0.95);
    marker.drawCircle(SPAWN.x + 0.5, SPAWN.y + 0.5, 2.6);
    marker.endFill();
    layer.addChild(marker);
  }, [camera, generator]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  const getTile = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    const tilePixels = BASE_TILE_SIZE * currentCamera.zoom;
    const x = Math.floor((event.clientX - bounds.left - currentCamera.x) / tilePixels);
    const y = Math.floor((event.clientY - bounds.top - currentCamera.y) / tilePixels);
    if (x < 0 || y < 0 || x >= generator.config.width || y >= generator.config.height) {
      return null;
    }
    return generator.getTileInfo(x, y);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const currentCamera = cameraRef.current;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      cameraX: currentCamera.x,
      cameraY: currentCamera.y,
    };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      onCameraChange({ ...cameraRef.current, x: drag.cameraX + dx, y: drag.cameraY + dy });
    }
    onTileHover(getTile(event));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current && !draggedRef.current) {
      const tile = getTile(event);
      if (tile) onTileSelect(tile);
    }
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const currentCamera = cameraRef.current;
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
    const zoom = clamp(currentCamera.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2), 0.004, 6);
    const ratio = zoom / currentCamera.zoom;
    onCameraChange({
      zoom,
      x: mouseX - (mouseX - currentCamera.x) * ratio,
      y: mouseY - (mouseY - currentCamera.y) * ratio,
    });
  };

  return (
    <div
      ref={hostRef}
      className="game-map"
      aria-label="Mapa interativo do mundo"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => onTileHover(null)}
      onWheel={handleWheel}
    />
  );
}
