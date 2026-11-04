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
import {
  getOrthogonalPath,
  getRoadAssetIndex,
  getRoadPlacementError,
  MAX_ROAD_PATH_TILES,
  RoadPlacementError,
  RoadPosition,
  RoadTile,
} from '../types/road';

const BASE_TILE_SIZE = 24;
const ASSEMBLY_ASSET = '/buildings/assembleia.png';
const ROAD_ASSETS = Array.from(
  { length: 6 },
  (_, index) => `/buildings/roads/grass_dirt${index + 1}.png`,
);
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function createCityLabel(name: string, x: number, y: number): PIXI.Container {
  const label = new PIXI.Text(name, {
    fontFamily: 'Arial, sans-serif',
    fontSize: 14,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0x101914,
    strokeThickness: 3,
    align: 'center',
    wordWrap: true,
    wordWrapWidth: 220,
    breakWords: true,
  });
  label.anchor.set(0.5, 1);

  const container = new PIXI.Container();
  container.position.set(x, y);
  const background = new PIXI.Graphics();
  background.lineStyle(1, 0xd5c08b, 0.9);
  background.beginFill(0x101914, 0.94);
  background.drawRoundedRect(
    -label.width / 2 - 6,
    -label.height - 4,
    label.width + 12,
    label.height + 8,
    4,
  );
  background.endFill();
  container.addChild(background, label);
  return container;
}

interface GameMapProps {
  generator: MapGeneratorInstance;
  camera: { x: number; y: number; zoom: number };
  onCameraChange: (camera: { x: number; y: number; zoom: number }) => void;
  onTileHover: (tile: TileInfo | null) => void;
  onTileSelect: (tile: TileInfo) => void;
  cities: CityAssembly[];
  roads: RoadTile[];
  placementMode: boolean;
  placementName: string;
  roadMode: boolean;
  demolitionMode: boolean;
  onCitySelect: (city: CityAssembly) => void;
  onCityPlace: (center: { x: number; y: number }) => void;
  onInvalidCityPlacement: (reason: CityPlacementError) => void;
  onRoadPlace: (path: RoadPosition[]) => void;
  onInvalidRoadPlacement: (reason: RoadPlacementError) => void;
  onCityDemolish: (city: CityAssembly) => void;
}

export function GameMap({
  generator,
  camera,
  onCameraChange,
  onTileHover,
  onTileSelect,
  cities,
  roads,
  placementMode,
  placementName,
  roadMode,
  demolitionMode,
  onCitySelect,
  onCityPlace,
  onInvalidCityPlacement,
  onRoadPlace,
  onInvalidRoadPlacement,
  onCityDemolish,
}: GameMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const layerRef = useRef<PIXI.Container | null>(null);
  const previewLayerRef = useRef<PIXI.Container | null>(null);
  const roadPreviewLayerRef = useRef<PIXI.Container | null>(null);
  const labelsLayerRef = useRef<PIXI.Container | null>(null);
  const cameraRef = useRef(camera);
  const dragRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const draggedRef = useRef(false);
  const roadDrawingRef = useRef(false);
  const roadPathRef = useRef<RoadPosition[]>([]);
  const [roadPath, setRoadPath] = useState<RoadPosition[]>([]);
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
    const roadPreviewLayer = new PIXI.Container();
    const labelsLayer = new PIXI.Container();
    app.stage.addChild(layer);
    app.stage.addChild(previewLayer);
    app.stage.addChild(roadPreviewLayer);
    app.stage.addChild(labelsLayer);
    host.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;
    layerRef.current = layer;
    previewLayerRef.current = previewLayer;
    roadPreviewLayerRef.current = roadPreviewLayer;
    labelsLayerRef.current = labelsLayer;

    return () => {
      layerRef.current = null;
      previewLayerRef.current = null;
      roadPreviewLayerRef.current = null;
      labelsLayerRef.current = null;
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

    const roadKeys = new Set(roads.map((road) => `${road.x},${road.y}`));
    const visibleRoads = roads.filter(
      (road) =>
        road.x >= minX - 1 &&
        road.x <= maxX &&
        road.y >= minY - 1 &&
        road.y <= maxY,
    );
    for (const road of visibleRoads) {
      const sprite = new PIXI.Sprite(
        PIXI.Texture.from(ROAD_ASSETS[getRoadAssetIndex(road, roads, roadKeys) - 1]),
      );
      sprite.position.set(road.x, road.y);
      sprite.width = 1.02;
      sprite.height = 1.02;
      layer.addChild(sprite);
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
      }
    }

  }, [camera, cities, generator, roads]);

  useEffect(() => {
    renderMap();
  }, [renderMap]);

  useEffect(() => {
    const app = appRef.current;
    const previewLayer = previewLayerRef.current;
    const labelsLayer = labelsLayerRef.current;
    if (!app || !previewLayer || !labelsLayer) return;

    for (const child of previewLayer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }
    for (const child of labelsLayer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }

    const tilePixels = BASE_TILE_SIZE * camera.zoom;
    previewLayer.position.set(camera.x, camera.y);
    previewLayer.scale.set(tilePixels);
    for (const city of cities) {
      labelsLayer.addChild(
        createCityLabel(
          city.name,
          camera.x + (city.centerX + 0.5) * tilePixels,
          camera.y + (city.centerY - ASSEMBLY_SIZE / 2 - 0.35) * tilePixels,
        ),
      );
    }
    if (!placementMode || !placementPreview) return;

    const valid =
      getCityPlacementError(
        placementPreview,
        cities,
        (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
        generator.config,
        roads,
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

    labelsLayer.addChild(
      createCityLabel(
        placementName,
        camera.x + (placementPreview.x + 0.5) * tilePixels,
        camera.y + (placementPreview.y - ASSEMBLY_SIZE / 2 - 0.35) * tilePixels,
      ),
    );
  }, [
    camera,
    cities,
    generator,
    landTileIds,
    placementMode,
    placementName,
    placementPreview,
  ]);

  useEffect(() => {
    if (!roadMode) {
      roadDrawingRef.current = false;
      roadPathRef.current = [];
      setRoadPath([]);
    }
  }, [roadMode]);

  useEffect(() => {
    const previewLayer = roadPreviewLayerRef.current;
    if (!previewLayer) return;
    for (const child of previewLayer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }
    const tilePixels = BASE_TILE_SIZE * camera.zoom;
    previewLayer.position.set(camera.x, camera.y);
    previewLayer.scale.set(tilePixels);
    if (!roadMode || roadPath.length === 0) return;

    const combinedRoads = [...roads, ...roadPath.map((position) => ({ ...position, cityId: '' }))];
    const roadKeys = new Set(combinedRoads.map((road) => `${road.x},${road.y}`));
    const roadSet = new Set(roads.map((road) => `${road.x},${road.y}`));
    for (const position of roadPath) {
      if (roadSet.has(`${position.x},${position.y}`)) continue;
      const valid =
        getRoadPlacementError(
          position,
          cities,
          (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
        ) === null;
      const sprite = new PIXI.Sprite(
        PIXI.Texture.from(ROAD_ASSETS[getRoadAssetIndex(position, combinedRoads, roadKeys) - 1]),
      );
      sprite.position.set(position.x, position.y);
      sprite.width = 1.02;
      sprite.height = 1.02;
      sprite.alpha = 0.75;
      if (!valid) sprite.tint = 0xff4b55;
      previewLayer.addChild(sprite);
    }
  }, [camera, cities, generator, landTileIds, roadMode, roadPath, roads]);

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
    if (roadMode) {
      if (event.button !== 0) return;
      const tile = getTile(event);
      if (!tile) return;
      dragRef.current = null;
      roadDrawingRef.current = true;
      roadPathRef.current = [{ x: tile.x, y: tile.y }];
      setRoadPath(roadPathRef.current);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
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
    const tile = getTile(event);
    if (roadMode && roadDrawingRef.current && tile && roadPathRef.current.length <= MAX_ROAD_PATH_TILES) {
      const last = roadPathRef.current[roadPathRef.current.length - 1];
      if (last) {
        const segment = getOrthogonalPath(last, tile);
        const nextPath = [...roadPathRef.current, ...segment];
        roadPathRef.current = nextPath.slice(0, MAX_ROAD_PATH_TILES + 1);
        setRoadPath(roadPathRef.current);
      }
    }
    const drag = dragRef.current;
    if (drag && !roadMode) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      onCameraChange({ ...cameraRef.current, x: drag.cameraX + dx, y: drag.cameraY + dy });
    }
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
    if (roadMode) {
      if (roadDrawingRef.current) {
        const tile = getTile(event);
        if (tile && roadPathRef.current.length <= MAX_ROAD_PATH_TILES) {
          const last = roadPathRef.current[roadPathRef.current.length - 1];
          if (last) {
            roadPathRef.current = [
              ...roadPathRef.current,
              ...getOrthogonalPath(last, tile),
            ].slice(0, MAX_ROAD_PATH_TILES + 1);
          }
        }
        const path = roadPathRef.current;
        roadDrawingRef.current = false;
        roadPathRef.current = [];
        setRoadPath([]);
        if (path.length > MAX_ROAD_PATH_TILES) {
          onInvalidRoadPlacement('path_too_long');
        } else if (path.length > 0) {
          const invalidPosition = path.find((position) =>
            getRoadPlacementError(
              position,
              cities,
              (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
            ),
          );
          if (invalidPosition) {
            const reason = getRoadPlacementError(
              invalidPosition,
              cities,
              (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
            );
            if (reason) onInvalidRoadPlacement(reason);
          } else {
            onRoadPlace(path);
          }
        }
      }
      dragRef.current = null;
      return;
    }
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
            roads,
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
      className={`game-map${placementMode ? ' placement-mode' : ''}${roadMode ? ' road-mode' : ''}${demolitionMode ? ' demolition-mode' : ''}`}
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
