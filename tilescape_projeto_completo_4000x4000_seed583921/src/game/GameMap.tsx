import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { TileInfo } from '../types/map';
import {
  ASSEMBLY_SIZE,
  CityAssembly,
  CityZoneBounds,
  CityZoneType,
  getCityZonePlacementError,
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
import {
  getResidencePlacementError,
  isTileInResidenceFootprint,
  RESIDENCES,
  ResidentialBuilding,
  ResidencePlacementError,
  ResidenceType,
  UNDER_CONSTRUCTION_ASSET,
  WORKER_SEARCH_RADIUS,
} from '../types/residence';
import { isWithinLinkRadius } from '../types/logistics';

const BASE_TILE_SIZE = 24;
const MAX_CAMERA_ZOOM = 6;
const BUILDING_TYPE_LABEL_MIN_ZOOM = 3;
const ASSEMBLY_ASSET = '/buildings/assembleia.png';
const ROAD_ASSETS = Array.from(
  { length: 11 },
  (_, index) => `/buildings/roads/grass_dirt${index + 1}.png?v=11`,
);
const textureCache = new Map<string, PIXI.Texture>();
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function getCachedTexture(asset: string): PIXI.Texture {
  const cached = textureCache.get(asset);
  if (cached) return cached;
  const texture = PIXI.Texture.from(asset);
  textureCache.set(asset, texture);
  return texture;
}

function areBuildingLinksInRange(
  building: ResidentialBuilding,
  position: RoadPosition,
  buildings: ResidentialBuilding[],
): boolean {
  const linkedBuildings = buildings.filter(
    (candidate) =>
      candidate.id !== building.id &&
      (building.warehouseIds.includes(candidate.id) || candidate.warehouseIds.includes(building.id)),
  );
  return linkedBuildings.every((linkedBuilding) =>
    isWithinLinkRadius(
      { type: building.type, ...position },
      { type: linkedBuilding.type, x: linkedBuilding.x, y: linkedBuilding.y },
    ),
  );
}

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

function createBuildingLabel(
  ownerName: string,
  buildingType: string,
  x: number,
  y: number,
): PIXI.Container {
  const ownerLabel = createCityLabel(ownerName, 0, 0);
  const typeLabel = new PIXI.Text(buildingType, {
    fontFamily: 'Arial, sans-serif',
    fontSize: 10,
    fontWeight: 'bold',
    fill: 0xf4e7c2,
    stroke: 0x101914,
    strokeThickness: 2,
    align: 'center',
  });
  typeLabel.anchor.set(0.5, 0);
  typeLabel.position.set(0, 4);

  const typeBackground = new PIXI.Graphics();
  typeBackground.lineStyle(1, 0xd5c08b, 0.75);
  typeBackground.beginFill(0x101914, 0.94);
  typeBackground.drawRoundedRect(
    -typeLabel.width / 2 - 5,
    2,
    typeLabel.width + 10,
    typeLabel.height + 4,
    4,
  );
  typeBackground.endFill();

  const container = new PIXI.Container();
  container.position.set(x, y);
  container.addChild(ownerLabel, typeBackground, typeLabel);
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
  zoneOverlay: CityZoneType | 'all' | null;
  zoneEditorCityId: string | null;
  zoneDrawingType: CityZoneType | null;
  residentialBuildings: ResidentialBuilding[];
  residencePlacementType: ResidenceType | null;
  isMaster: boolean;
  influenceBuilding: ResidentialBuilding | null;
  onCitySelect: (city: CityAssembly) => void;
  onCityPlace: (center: { x: number; y: number }) => void;
  onInvalidCityPlacement: (reason: CityPlacementError) => void;
  onRoadPlace: (path: RoadPosition[]) => void;
  onInvalidRoadPlacement: (reason: RoadPlacementError) => void;
  onRoadDemolish: (roads: RoadTile[]) => void;
  onCityDemolish: (city: CityAssembly) => void;
  onCityZoneDraw: (bounds: CityZoneBounds) => void;
  onResidencePlace: (type: ResidenceType, position: RoadPosition) => void;
  onResidenceDemolish: (building: ResidentialBuilding) => void;
  onInvalidResidencePlacement: (reason: ResidencePlacementError) => void;
  onResidenceComplete: (buildingId: string) => void;
  onResidenceSelect: (building: ResidentialBuilding) => void;
  onResidenceMove: (buildingId: string, position: RoadPosition) => void;
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
  zoneOverlay,
  zoneEditorCityId,
  zoneDrawingType,
  residentialBuildings,
  residencePlacementType,
  isMaster,
  influenceBuilding,
  onCitySelect,
  onCityPlace,
  onInvalidCityPlacement,
  onRoadPlace,
  onInvalidRoadPlacement,
  onRoadDemolish,
  onCityDemolish,
  onCityZoneDraw,
  onResidencePlace,
  onResidenceDemolish,
  onInvalidResidencePlacement,
  onResidenceComplete,
  onResidenceSelect,
  onResidenceMove,
}: GameMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const terrainLayerRef = useRef<PIXI.Container | null>(null);
  const roadsLayerRef = useRef<PIXI.Container | null>(null);
  const buildingsLayerRef = useRef<PIXI.Container | null>(null);
  const previewLayerRef = useRef<PIXI.Container | null>(null);
  const roadPreviewLayerRef = useRef<PIXI.Container | null>(null);
  const labelsLayerRef = useRef<PIXI.Container | null>(null);
  const buildingSpritesRef = useRef(new Map<string, PIXI.Sprite>());
  const assemblySpritesRef = useRef(new Map<string, PIXI.Sprite>());
  const cameraRef = useRef(camera);
  const dragRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const draggedRef = useRef(false);
  const movingBuildingRef = useRef<{ buildingId: string; offsetX: number; offsetY: number } | null>(null);
  const roadDrawingRef = useRef(false);
  const zoneDrawingRef = useRef(false);
  const zoneStartRef = useRef<RoadPosition | null>(null);
  const roadPathRef = useRef<RoadPosition[]>([]);
  const roadDemolitionPathRef = useRef<RoadPosition[]>([]);
  const [roadPath, setRoadPath] = useState<RoadPosition[]>([]);
  const [placementPreview, setPlacementPreview] = useState<{ x: number; y: number } | null>(null);
  const [movePreview, setMovePreview] = useState<{
    buildingId: string;
    position: RoadPosition;
  } | null>(null);
  const [zonePreview, setZonePreview] = useState<CityZoneBounds | null>(null);
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
    const terrainLayer = new PIXI.Container();
    const roadsLayer = new PIXI.Container();
    const buildingsLayer = new PIXI.Container();
    const previewLayer = new PIXI.Container();
    const roadPreviewLayer = new PIXI.Container();
    const labelsLayer = new PIXI.Container();
    app.stage.addChild(terrainLayer);
    app.stage.addChild(roadsLayer);
    app.stage.addChild(buildingsLayer);
    app.stage.addChild(previewLayer);
    app.stage.addChild(roadPreviewLayer);
    app.stage.addChild(labelsLayer);
    host.appendChild(app.view as HTMLCanvasElement);
    appRef.current = app;
    terrainLayerRef.current = terrainLayer;
    roadsLayerRef.current = roadsLayer;
    buildingsLayerRef.current = buildingsLayer;
    previewLayerRef.current = previewLayer;
    roadPreviewLayerRef.current = roadPreviewLayer;
    labelsLayerRef.current = labelsLayer;

    return () => {
      terrainLayerRef.current = null;
      roadsLayerRef.current = null;
      buildingsLayerRef.current = null;
      previewLayerRef.current = null;
      roadPreviewLayerRef.current = null;
      labelsLayerRef.current = null;
      buildingSpritesRef.current.clear();
      assemblySpritesRef.current.clear();
      appRef.current = null;
      app.destroy(true, { children: true, texture: false, baseTexture: false });
    };
  }, []);

  const getViewport = useCallback(() => {
    const app = appRef.current;
    if (!app || !app.renderer) return null;

    const { width, height } = app.screen;
    const { x, y, zoom } = camera;
    const tilePixels = BASE_TILE_SIZE * zoom;
    const minX = clamp(Math.floor(-x / tilePixels), 0, generator.config.width - 1);
    const maxX = clamp(Math.ceil((width - x) / tilePixels), 0, generator.config.width);
    const minY = clamp(Math.floor(-y / tilePixels), 0, generator.config.height - 1);
    const maxY = clamp(Math.ceil((height - y) / tilePixels), 0, generator.config.height);
    return { minX, maxX, minY, maxY, tilePixels };
  }, [camera, generator]);

  const renderTerrain = useCallback(() => {
    const layer = terrainLayerRef.current;
    const viewport = getViewport();
    if (!layer || !viewport) return;
    for (const child of layer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }
    const { minX, maxX, minY, maxY, tilePixels } = viewport;
    layer.position.set(camera.x, camera.y);
    layer.scale.set(tilePixels);
    if (tilePixels >= 12) {
      const tileTextures = new Map(
        generator.tiles.map((tile) => [tile.id, getCachedTexture(tile.src)]),
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

    if (zoneOverlay) {
      const zoneGraphics = new PIXI.Graphics();
      for (const city of cities) {
        if (zoneOverlay === 'all' && city.id !== zoneEditorCityId) continue;
        for (const zone of city.zones) {
          if (zoneOverlay !== 'all' && zone.type !== zoneOverlay) continue;
          const color = zone.type === 'urban' ? 0x59a8eb : 0x77c776;
          zoneGraphics.lineStyle(0.12, color, 0.9);
          zoneGraphics.beginFill(color, 0.2);
          zoneGraphics.drawRect(
            zone.minX,
            zone.minY,
            zone.maxX - zone.minX + 1,
            zone.maxY - zone.minY + 1,
          );
          zoneGraphics.endFill();
        }
      }
      layer.addChild(zoneGraphics);
    }

    if (influenceBuilding) {
      const definition = RESIDENCES[influenceBuilding.type];
      const influence = new PIXI.Graphics();
      influence.lineStyle(2 / tilePixels, 0xf2d27a, 0.95);
      influence.beginFill(0xf2d27a, 0.12);
      influence.drawCircle(
        influenceBuilding.x + definition.width / 2,
        influenceBuilding.y + definition.height / 2,
        WORKER_SEARCH_RADIUS,
      );
      influence.endFill();
      layer.addChild(influence);
    }

    const border = new PIXI.Graphics();
    border.lineStyle(2 / tilePixels, 0xd5c08b, 0.8);
    border.drawRect(0, 0, generator.config.width, generator.config.height);
    layer.addChild(border);

  }, [camera, cities, generator, getViewport, influenceBuilding, zoneEditorCityId, zoneOverlay]);

  useEffect(() => {
    renderTerrain();
  }, [renderTerrain]);

  const renderRoads = useCallback(() => {
    const layer = roadsLayerRef.current;
    const viewport = getViewport();
    if (!layer || !viewport) return;
    for (const child of layer.removeChildren()) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    }
    const { minX, maxX, minY, maxY, tilePixels } = viewport;
    layer.position.set(camera.x, camera.y);
    layer.scale.set(tilePixels);
    const roadKeys = new Set(roads.map((road) => `${road.x},${road.y}`));
    for (const road of roads) {
      if (road.x < minX - 1 || road.x > maxX || road.y < minY - 1 || road.y > maxY) continue;
      const sprite = new PIXI.Sprite(
        getCachedTexture(ROAD_ASSETS[getRoadAssetIndex(road, roads, roadKeys) - 1]),
      );
      sprite.position.set(road.x, road.y);
      sprite.width = 1.02;
      sprite.height = 1.02;
      layer.addChild(sprite);
    }
  }, [camera, getViewport, roads]);

  useEffect(() => {
    renderRoads();
  }, [renderRoads]);

  const renderBuildings = useCallback(() => {
    const layer = buildingsLayerRef.current;
    const viewport = getViewport();
    if (!layer || !viewport) return;
    const { minX, maxX, minY, maxY, tilePixels } = viewport;
    layer.position.set(camera.x, camera.y);
    layer.scale.set(tilePixels);
    const buildingsById = new Map(residentialBuildings.map((building) => [building.id, building]));
    for (const [id, sprite] of buildingSpritesRef.current) {
      if (buildingsById.has(id)) continue;
      sprite.destroy({ children: true, texture: false, baseTexture: false });
      buildingSpritesRef.current.delete(id);
    }
    const isVisible = (x: number, y: number, width: number, height: number) =>
      x + width >= minX && x <= maxX && y + height >= minY && y <= maxY;
    if (tilePixels < 2) {
      for (const sprite of buildingSpritesRef.current.values()) {
        if (sprite.parent === layer) layer.removeChild(sprite);
      }
      for (const sprite of assemblySpritesRef.current.values()) {
        if (sprite.parent === layer) layer.removeChild(sprite);
      }
      return;
    }
    for (const building of residentialBuildings) {
      const definition = RESIDENCES[building.type];
      let sprite = buildingSpritesRef.current.get(building.id);
      if (!sprite) {
        sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        buildingSpritesRef.current.set(building.id, sprite);
      }
      sprite.texture = getCachedTexture(
        building.status === 'under_construction' ? UNDER_CONSTRUCTION_ASSET : definition.asset,
      );
      sprite.position.set(building.x, building.y);
      sprite.width = definition.width;
      sprite.height = definition.height;
      const shouldRender = isVisible(building.x, building.y, definition.width, definition.height);
      if (shouldRender) {
        if (sprite.parent !== layer) layer.addChild(sprite);
      } else if (sprite.parent === layer) {
        layer.removeChild(sprite);
      }
    }
    const cityIds = new Set(cities.map((city) => city.id));
    for (const [id, sprite] of assemblySpritesRef.current) {
      if (cityIds.has(id)) continue;
      sprite.destroy({ children: true, texture: false, baseTexture: false });
      assemblySpritesRef.current.delete(id);
    }
    const assemblyTexture = getCachedTexture(ASSEMBLY_ASSET);
    for (const city of cities) {
      let sprite = assemblySpritesRef.current.get(city.id);
      if (!sprite) {
        sprite = new PIXI.Sprite(assemblyTexture);
        assemblySpritesRef.current.set(city.id, sprite);
      }
      sprite.position.set(
        city.centerX - Math.floor(ASSEMBLY_SIZE / 2),
        city.centerY - Math.floor(ASSEMBLY_SIZE / 2),
      );
      sprite.width = ASSEMBLY_SIZE;
      sprite.height = ASSEMBLY_SIZE;
      if (isVisible(
        city.centerX - Math.floor(ASSEMBLY_SIZE / 2),
        city.centerY - Math.floor(ASSEMBLY_SIZE / 2),
        ASSEMBLY_SIZE,
        ASSEMBLY_SIZE,
      )) {
        if (sprite.parent !== layer) layer.addChild(sprite);
      } else if (sprite.parent === layer) {
        layer.removeChild(sprite);
      }
    }
  }, [camera, cities, getViewport, residentialBuildings]);

  useEffect(() => {
    renderBuildings();
  }, [renderBuildings]);

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
    const viewport = getViewport();
    for (const city of cities) {
      labelsLayer.addChild(
        createCityLabel(
          city.name,
          camera.x + (city.centerX + 0.5) * tilePixels,
          camera.y + (city.centerY - ASSEMBLY_SIZE / 2 - 0.35) * tilePixels,
        ),
      );
    }
    for (const building of residentialBuildings) {
      if (!building.isOwnedByCurrentUser || !building.ownerName) continue;
      const definition = RESIDENCES[building.type];
      if (
        viewport &&
        (building.x + definition.width < viewport.minX ||
          building.x > viewport.maxX ||
          building.y + definition.height < viewport.minY ||
          building.y > viewport.maxY)
      ) {
        continue;
      }
      const labelX = camera.x + (building.x + definition.width / 2) * tilePixels;
      const labelY = camera.y + (building.y - 0.35) * tilePixels;
      labelsLayer.addChild(
        camera.zoom >= BUILDING_TYPE_LABEL_MIN_ZOOM
          ? createBuildingLabel(building.ownerName, definition.name, labelX, labelY)
          : createCityLabel(building.ownerName, labelX, labelY),
      );
    }
    if (zonePreview) {
      const bounds = {
        minX: Math.min(zonePreview.minX, zonePreview.maxX),
        minY: Math.min(zonePreview.minY, zonePreview.maxY),
        maxX: Math.max(zonePreview.minX, zonePreview.maxX),
        maxY: Math.max(zonePreview.minY, zonePreview.maxY),
      };
      const targetCity = cities.find((city) => city.id === zoneEditorCityId);
      const isValid =
        targetCity !== undefined &&
        zoneDrawingType !== null &&
        getCityZonePlacementError(bounds, zoneDrawingType, targetCity, targetCity.zones) === null;
      const zoneColor = isValid
        ? zoneDrawingType === 'urban'
          ? 0x59a8eb
          : 0x77c776
        : 0xff4b55;
      const preview = new PIXI.Graphics();
      preview.lineStyle(0.12, zoneColor, 1);
      preview.beginFill(zoneColor, 0.28);
      preview.drawRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1);
      preview.endFill();
      previewLayer.addChild(preview);
    }

    if (placementPreview && (placementMode || residencePlacementType)) {
      const residenceDefinition = residencePlacementType
        ? RESIDENCES[residencePlacementType]
        : null;
      const valid = residencePlacementType
        ? getResidencePlacementError(
            residencePlacementType,
            placementPreview,
            cities,
            residentialBuildings,
            roads,
            (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
            generator.config,
          ) === null
        : getCityPlacementError(
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
      if (residenceDefinition) {
        footprint.drawRect(
          placementPreview.x,
          placementPreview.y,
          residenceDefinition.width,
          residenceDefinition.height,
        );
      } else {
        footprint.drawRect(
          placementPreview.x - Math.floor(ASSEMBLY_SIZE / 2),
          placementPreview.y - Math.floor(ASSEMBLY_SIZE / 2),
          ASSEMBLY_SIZE,
          ASSEMBLY_SIZE,
        );
      }
      footprint.endFill();
      previewLayer.addChild(footprint);

      const preview = new PIXI.Sprite(
        getCachedTexture(residenceDefinition?.asset ?? ASSEMBLY_ASSET),
      );
      preview.position.set(
        residenceDefinition
          ? placementPreview.x
          : placementPreview.x - Math.floor(ASSEMBLY_SIZE / 2),
        residenceDefinition
          ? placementPreview.y
          : placementPreview.y - Math.floor(ASSEMBLY_SIZE / 2),
      );
      preview.width = residenceDefinition?.width ?? ASSEMBLY_SIZE;
      preview.height = residenceDefinition?.height ?? ASSEMBLY_SIZE;
      preview.tint = tint;
      preview.alpha = 0.72;
      previewLayer.addChild(preview);

      if (!residenceDefinition) {
        labelsLayer.addChild(
          createCityLabel(
            placementName,
            camera.x + (placementPreview.x + 0.5) * tilePixels,
            camera.y + (placementPreview.y - ASSEMBLY_SIZE / 2 - 0.35) * tilePixels,
          ),
        );
      }
    }

    if (movePreview) {
      const movingBuilding = residentialBuildings.find((building) => building.id === movePreview.buildingId);
      if (movingBuilding) {
        const definition = RESIDENCES[movingBuilding.type];
        const otherBuildings = residentialBuildings.filter((building) => building.id !== movingBuilding.id);
        const valid = getResidencePlacementError(
          movingBuilding.type,
          movePreview.position,
          cities,
          otherBuildings,
          roads,
          (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
          generator.config,
        ) === null && areBuildingLinksInRange(movingBuilding, movePreview.position, residentialBuildings);
        const tint = valid ? 0x55ff88 : 0xff4b55;
        const footprint = new PIXI.Graphics();
        footprint.lineStyle(0.12, tint, 1);
        footprint.beginFill(tint, 0.28);
        footprint.drawRect(
          movePreview.position.x,
          movePreview.position.y,
          definition.width,
          definition.height,
        );
        footprint.endFill();
        previewLayer.addChild(footprint);
        const preview = new PIXI.Sprite(getCachedTexture(definition.asset));
        preview.position.set(movePreview.position.x, movePreview.position.y);
        preview.width = definition.width;
        preview.height = definition.height;
        preview.tint = tint;
        preview.alpha = 0.72;
        previewLayer.addChild(preview);
      }
    }
  }, [
    camera,
    cities,
    generator,
    getViewport,
    landTileIds,
    placementMode,
    placementName,
    placementPreview,
    movePreview,
    residencePlacementType,
    residentialBuildings,
    zoneEditorCityId,
    zoneDrawingType,
    zonePreview,
  ]);

  useEffect(() => {
    if (!roadMode) {
      roadDrawingRef.current = false;
      roadPathRef.current = [];
      setRoadPath([]);
    }
  }, [roadMode]);

  useEffect(() => {
    if (zoneDrawingType) return;
    zoneDrawingRef.current = false;
    zoneStartRef.current = null;
    setZonePreview(null);
  }, [zoneDrawingType]);

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
          residentialBuildings,
        ) === null;
      const sprite = new PIXI.Sprite(
        getCachedTexture(ROAD_ASSETS[getRoadAssetIndex(position, combinedRoads, roadKeys) - 1]),
      );
      sprite.position.set(position.x, position.y);
      sprite.width = 1.02;
      sprite.height = 1.02;
      sprite.alpha = 0.75;
      if (!valid) sprite.tint = 0xff4b55;
      previewLayer.addChild(sprite);
    }
  }, [
    camera,
    cities,
    generator,
    landTileIds,
    residentialBuildings,
    roadMode,
    roadPath,
    roads,
  ]);

  const getTile = (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
  ) => {
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
    if (zoneDrawingType) {
      if (event.button !== 0) return;
      const tile = getTile(event);
      if (!tile) return;
      dragRef.current = null;
      zoneDrawingRef.current = true;
      zoneStartRef.current = { x: tile.x, y: tile.y };
      setZonePreview({ minX: tile.x, minY: tile.y, maxX: tile.x, maxY: tile.y });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
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
    if (demolitionMode && event.button === 0) {
      const tile = getTile(event);
      if (!tile) return;
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        cameraX: cameraRef.current.x,
        cameraY: cameraRef.current.y,
      };
      draggedRef.current = false;
      roadDemolitionPathRef.current = [{ x: tile.x, y: tile.y }];
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const tile = getTile(event);
    const movingBuilding = isMaster &&
      !placementMode &&
      !residencePlacementType &&
      !roadMode &&
      !demolitionMode &&
      !zoneDrawingType &&
      tile
      ? residentialBuildings.find((building) =>
          !building.id.startsWith('pending-') && isTileInResidenceFootprint(building, tile),
        )
      : undefined;
    movingBuildingRef.current = movingBuilding && tile
      ? {
          buildingId: movingBuilding.id,
          offsetX: tile.x - movingBuilding.x,
          offsetY: tile.y - movingBuilding.y,
        }
      : null;
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
    if (zoneDrawingRef.current && zoneStartRef.current && tile) {
      setZonePreview({
        minX: Math.min(zoneStartRef.current.x, tile.x),
        minY: Math.min(zoneStartRef.current.y, tile.y),
        maxX: Math.max(zoneStartRef.current.x, tile.x),
        maxY: Math.max(zoneStartRef.current.y, tile.y),
      });
    }
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
    if (drag && demolitionMode && roadDemolitionPathRef.current.length > 0) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      if (draggedRef.current && tile) {
        const path = roadDemolitionPathRef.current;
        const last = path[path.length - 1];
        if (last && (last.x !== tile.x || last.y !== tile.y)) {
          roadDemolitionPathRef.current = [
            ...path,
            ...getOrthogonalPath(last, tile),
          ].slice(0, MAX_ROAD_PATH_TILES);
        }
      }
    } else if (drag && movingBuildingRef.current) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      if (draggedRef.current && tile) {
        setMovePreview({
          buildingId: movingBuildingRef.current.buildingId,
          position: {
            x: tile.x - movingBuildingRef.current.offsetX,
            y: tile.y - movingBuildingRef.current.offsetY,
          },
        });
      }
    } else if (drag && !roadMode && !residencePlacementType) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      onCameraChange({ ...cameraRef.current, x: drag.cameraX + dx, y: drag.cameraY + dy });
    }
    onTileHover(tile);
    if (placementMode || residencePlacementType) {
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
    if (movingBuildingRef.current) {
      const moving = movingBuildingRef.current;
      const tile = getTile(event);
      const movingBuilding = residentialBuildings.find((building) => building.id === moving.buildingId);
      movingBuildingRef.current = null;
      dragRef.current = null;
      if (draggedRef.current && tile && movingBuilding) {
        const position = {
          x: tile.x - moving.offsetX,
          y: tile.y - moving.offsetY,
        };
        const reason = getResidencePlacementError(
          movingBuilding.type,
          position,
          cities,
          residentialBuildings.filter((building) => building.id !== movingBuilding.id),
          roads,
          (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
          generator.config,
        );
        setMovePreview(null);
        if (reason) onInvalidResidencePlacement(reason);
        else if (!areBuildingLinksInRange(movingBuilding, position, residentialBuildings)) {
          onInvalidResidencePlacement('warehouse_out_of_range');
        } else onResidenceMove(movingBuilding.id, position);
        return;
      }
      setMovePreview(null);
    }
    if (zoneDrawingRef.current) {
      const tile = getTile(event);
      const start = zoneStartRef.current;
      zoneDrawingRef.current = false;
      zoneStartRef.current = null;
      setZonePreview(null);
      if (tile && start) {
        onCityZoneDraw({
          minX: Math.min(start.x, tile.x),
          minY: Math.min(start.y, tile.y),
          maxX: Math.max(start.x, tile.x),
          maxY: Math.max(start.y, tile.y),
        });
      }
      dragRef.current = null;
      return;
    }
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
              residentialBuildings,
            ),
          );
          if (invalidPosition) {
            const reason = getRoadPlacementError(
              invalidPosition,
              cities,
              (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
              residentialBuildings,
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
    if (demolitionMode && dragRef.current) {
      const tile = getTile(event);
      if (draggedRef.current && tile) {
        const path = roadDemolitionPathRef.current;
        const last = path[path.length - 1];
        if (last && (last.x !== tile.x || last.y !== tile.y)) {
          roadDemolitionPathRef.current = [
            ...path,
            ...getOrthogonalPath(last, tile),
          ].slice(0, MAX_ROAD_PATH_TILES);
        }
      }
      if (draggedRef.current) {
        const roadKeys = new Set(
          roadDemolitionPathRef.current.map((position) => `${position.x},${position.y}`),
        );
        const roadsToDemolish = roads.filter(
          (road) => road.cityId !== '' && roadKeys.has(`${road.x},${road.y}`),
        );
        if (roadsToDemolish.length > 0) onRoadDemolish(roadsToDemolish);
        roadDemolitionPathRef.current = [];
        dragRef.current = null;
        return;
      }
      roadDemolitionPathRef.current = [];
    }
    if (dragRef.current && !draggedRef.current) {
      const tile = getTile(event);
      if (tile) {
        if (residencePlacementType) {
          const position = { x: tile.x, y: tile.y };
          const reason = getResidencePlacementError(
            residencePlacementType,
            position,
            cities,
            residentialBuildings,
            roads,
            (x, y) => landTileIds.has(generator.getTileAt(x, y).tileId),
            generator.config,
          );
          if (reason) onInvalidResidencePlacement(reason);
          else onResidencePlace(residencePlacementType, position);
        } else if (placementMode) {
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
          const residence = demolitionMode
            ? residentialBuildings.find((building) => {
              if (building.id.startsWith('pending-')) return false;
              return isTileInResidenceFootprint(building, tile);
            })
            : undefined;
          if (residence) {
            onResidenceDemolish(residence);
            dragRef.current = null;
            return;
          }
          const selectedResidence = demolitionMode
            ? undefined
            : residentialBuildings.find(
                (building) =>
                  !building.id.startsWith('pending-') && isTileInResidenceFootprint(building, tile),
              );
          if (selectedResidence) {
            onResidenceSelect(selectedResidence);
            dragRef.current = null;
            return;
          }
          const road = demolitionMode
            ? roads.find(
                (candidate) =>
                  candidate.x === tile.x &&
                  candidate.y === tile.y &&
                  candidate.cityId !== '',
              )
            : undefined;
          if (road) {
            onRoadDemolish([road]);
            dragRef.current = null;
            return;
          }
          const city = cities.find(
            (candidate) =>
              Math.abs(candidate.centerX - tile.x) <= 1 &&
              Math.abs(candidate.centerY - tile.y) <= 1 &&
              !candidate.id.startsWith('pending-'),
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
    const zoom = clamp(
      currentCamera.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2),
      0.004,
      MAX_CAMERA_ZOOM,
    );
    const ratio = zoom / currentCamera.zoom;
    onCameraChange({
      zoom,
      x: mouseX - (mouseX - currentCamera.x) * ratio,
      y: mouseY - (mouseY - currentCamera.y) * ratio,
    });
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !isMaster ||
      residencePlacementType ||
      placementMode ||
      roadMode ||
      demolitionMode ||
      zoneDrawingType
    ) {
      return;
    }
    const tile = getTile(event);
    if (!tile) return;
    const position = { x: tile.x, y: tile.y };
    const building = residentialBuildings.find((candidate) => {
      const definition = RESIDENCES[candidate.type];
      return (
        candidate.status === 'under_construction' &&
        position.x >= candidate.x &&
        position.x < candidate.x + definition.width &&
        position.y >= candidate.y &&
        position.y < candidate.y + definition.height
      );
    });
    if (!building) return;
    event.preventDefault();
    onResidenceComplete(building.id);
  };

  return (
    <div
      ref={hostRef}
      className={`game-map${placementMode || residencePlacementType ? ' placement-mode' : ''}${roadMode ? ' road-mode' : ''}${demolitionMode ? ' demolition-mode' : ''}${zoneDrawingType ? ' zone-mode' : ''}`}
      aria-label="Mapa interativo do mundo"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onPointerLeave={() => {
        onTileHover(null);
        setPlacementPreview(null);
      }}
      onWheel={handleWheel}
    />
  );
}
