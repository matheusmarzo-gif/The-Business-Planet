import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { TileInfo } from '../types/map';
import {
  ASSEMBLY_SIZE,
  CityAssembly,
  CityPlacementError,
  getCityPlacementError,
  MUNICIPAL_AREA_SIZE,
} from '../types/city';

const BASE_TILE_SIZE = 24;
const ASSEMBLY_ASSET = '/buildings/assembleia.png';
const SPAWN = { x: 2000, y: 2000 };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface GameMapProps {
  generator: MapGeneratorInstance;
  camera: { x: number; y: number; zoom: number };
  onCameraChange: (camera: { x: number; y: number; zoom: number }) => void;
  onTileHover: (tile: TileInfo | null) => void;
  onTileSelect: (tile: TileInfo) => void;
  cities: CityAssembly[];
  placementMode: boolean;
  placementName: string;
  demolitionMode: boolean;
  onCitySelect: (city: CityAssembly) => void;
  onCityPlace: (center: { x: number; y: number }) => void;
  onInvalidCityPlacement: (reason: CityPlacementError) => void;
  onCityDemolish: (city: CityAssembly) => void;
}

export function GameMap({
  generator,
  camera,
  onCameraChange,
  onTileHover,
  onTileSelect,
  cities,
  placementMode,
  placementName,
  demolitionMode,
  onCitySelect,
  onCityPlace,
  onInvalidCityPlacement,
  onCityDemolish,
}: GameMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layerRef = useRef<PIXI.Container | null>(null);
  const previewLayerRef = useRef<PIXI.Container | null>(null);
  const cameraRef = useRef(camera);
  const dragRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const draggedRef = useRef(false);
  const [placementPreview, setPlacementPreview] = useState<{ x: number; y: number } | null>(null);
  const landTileIds = useMemo(
    () => new Set(generator.tiles.filter((tile) => tile.category === 'land').map((tile) => tile.id)),
    [generator],
  );

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
    const previewLayer = new PIXI.Container();
    app.stage.addChild(layer);
    app.stage.addChild(previewLayer);
    host.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;
    layerRef.current = layer;
    previewLayerRef.current = previewLayer;

    return () => {
      layerRef.current = null;
      previewLayerRef.current = null;
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

    const municipalAreas = new PIXI.Graphics();
    for (const city of cities) {
      municipalAreas.beginFill(0xd5c08b, 0.1);
      municipalAreas.lineStyle(1 / tilePixels, 0xd5c08b, 0.82);
      municipalAreas.drawRect(
        city.centerX - Math.floor(MUNICIPAL_AREA_SIZE / 2),
        city.centerY - Math.floor(MUNICIPAL_AREA_SIZE / 2),
        MUNICIPAL_AREA_SIZE,
        MUNICIPAL_AREA_SIZE,
      );
      municipalAreas.endFill();
    }
    layer.addChild(municipalAreas);

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
    if (tilePixels >= 2) {
      const assemblyTexture = PIXI.Texture.from(ASSEMBLY_ASSET);
      for (const city of cities) {
        const assembly = new PIXI.Sprite(assemblyTexture);
        assembly.position.set(
          city.centerX - Math.floor(ASSEMBLY_SIZE / 2),
          city.centerY - Math.floor(ASSEMBLY_SIZE / 2),
        );
        assembly.width = ASSEMBLY_SIZE;
        assembly.height = ASSEMBLY_SIZE;
        layer.addChild(assembly);

        if (tilePixels >= 0.5) {
          const label = new PIXI.Text(city.name, {
            fontFamily: 'Arial, sans-serif',
            fontSize: 14 / tilePixels,
            fontWeight: 'bold',
            fill: 0xffffff,
            stroke: 0x101914,
            strokeThickness: 4 / tilePixels,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 240 / tilePixels,
          });
          const labelY = city.centerY - ASSEMBLY_SIZE / 2 - 0.35;
          const labelContainer = new PIXI.Container();
          labelContainer.position.set(city.centerX + 0.5, labelY);
          label.anchor.set(0.5, 1);
          const labelBackground = new PIXI.Graphics();
          labelBackground.lineStyle(1 / tilePixels, 0xd5c08b, 0.9);
          labelBackground.beginFill(0x101914, 0.92);
          labelBackground.drawRoundedRect(
            -label.width / 2 - 6 / tilePixels,
            -label.height - 4 / tilePixels,
            label.width + 12 / tilePixels,
            label.height + 8 / tilePixels,
            4 / tilePixels,
          );
          labelBackground.endFill();
          labelContainer.addChild(labelBackground);
          labelContainer.addChild(label);
          layer.addChild(labelContainer);
        }
      }
    }

  }, [camera, cities, generator]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  useEffect(() => {
    const app = appRef.current;
    const previewLayer = previewLayerRef.current;
    if (!app || !previewLayer) return;

    for (const child of previewLayer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }

    const tilePixels = BASE_TILE_SIZE * camera.zoom;
    previewLayer.position.set(camera.x, camera.y);
    previewLayer.scale.set(tilePixels);
    if (!placementMode || !placementPreview) return;

    const valid =
      getCityPlacementError(
        placementPreview,
        cities,
        (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
        generator.config,
      ) === null;
    const tint = valid ? 0x55ff88 : 0xff4b55;
    const footprint = new PIXI.Graphics();
    footprint.lineStyle(0.12, tint, 1);
    footprint.beginFill(tint, 0.28);
    footprint.drawRect(
      placementPreview.x - Math.floor(ASSEMBLY_SIZE / 2),
      placementPreview.y - Math.floor(ASSEMBLY_SIZE / 2),
      ASSEMBLY_SIZE,
      ASSEMBLY_SIZE,
    );
    footprint.endFill();
    previewLayer.addChild(footprint);

    const preview = new PIXI.Sprite(PIXI.Texture.from(ASSEMBLY_ASSET));
    preview.position.set(
      placementPreview.x - Math.floor(ASSEMBLY_SIZE / 2),
      placementPreview.y - Math.floor(ASSEMBLY_SIZE / 2),
    );
    preview.width = ASSEMBLY_SIZE;
    preview.height = ASSEMBLY_SIZE;
    preview.tint = tint;
    preview.alpha = 0.72;
    previewLayer.addChild(preview);

    if (placementName && tilePixels >= 0.5) {
      const label = new PIXI.Text(placementName, {
        fontFamily: 'Arial, sans-serif',
        fontSize: 14 / tilePixels,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: 0x101914,
        strokeThickness: 4 / tilePixels,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 240 / tilePixels,
      });
      label.anchor.set(0.5, 1);
      label.position.set(placementPreview.x + 0.5, placementPreview.y - ASSEMBLY_SIZE / 2 - 0.35);
      previewLayer.addChild(label);
    }
  }, [
    camera,
    cities,
    generator,
    landTileIds,
    placementMode,
    placementName,
    placementPreview,
  ]);

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
    const tile = getTile(event);
    onTileHover(tile);
    if (placementMode) {
      setPlacementPreview((current) =>
        current?.x === tile?.x && current?.y === tile?.y
          ? current
          : tile
            ? { x: tile.x, y: tile.y }
            : null,
      );
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current && !draggedRef.current) {
      const tile = getTile(event);
      if (tile) {
        if (placementMode) {
          const center = { x: tile.x, y: tile.y };
          const reason = getCityPlacementError(
            center,
            cities,
            (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
            generator.config,
          );
          if (reason) onInvalidCityPlacement(reason);
          else onCityPlace(center);
        } else {
          const city = cities.find(
            (candidate) =>
              Math.abs(candidate.centerX - tile.x) <= 1 &&
              Math.abs(candidate.centerY - tile.y) <= 1,
          );
          if (city) {
            if (demolitionMode) onCityDemolish(city);
            else onCitySelect(city);
          }
          else onTileSelect(tile);
        }
      }
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
      className={`game-map${placementMode ? ' placement-mode' : ''}${demolitionMode ? ' demolition-mode' : ''}`}
      aria-label="Mapa interativo do mundo"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        onTileHover(null);
        setPlacementPreview(null);
      }}
      onWheel={handleWheel}
    />
  );
}
