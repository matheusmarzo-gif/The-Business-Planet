import { getAccessToken } from '../auth/authClient';
import { isValidCityWellbeing, type CityAssembly } from '../types/city';
import type { CityZone } from '../types/city';
import type { RoadTile } from '../types/road';
import {
  getResidenceDefinition,
  type ResidentialBuilding,
  type ResidentialBuildingSummary,
  type WorldBuilding,
} from '../types/residence';
import { isCurrencyAmount } from '../types/currency';
import type {
  CityRoadUpdate,
  CityBuildingsUpdate,
  EntityDelta,
  RoadViewPosition,
  WorldDelta,
} from '../types/worldSync';

export interface WorldSnapshot {
  worldTime: string;
  serverTime: string;
  timeScale: number;
  map: {
    width: number;
    height: number;
    seed: number;
  };
  onlinePlayers: number;
}

function isCityAssembly(value: unknown): value is CityAssembly {
  if (typeof value !== 'object' || value === null) return false;
  const city = value as Record<string, unknown>;
  return (
    typeof city.id === 'string' &&
    typeof city.name === 'string' &&
    Number.isInteger(city.centerX) &&
    Number.isInteger(city.centerY) &&
    typeof city.minimumWage === 'number' &&
    Number.isFinite(city.minimumWage) &&
    city.minimumWage >= 1 &&
    city.minimumWage <= 100000 &&
    Number.isInteger(city.population) &&
    (city.populationChangeLastMonth === undefined ||
      Number.isSafeInteger(city.populationChangeLastMonth)) &&
    isValidCityWellbeing(city.wellbeing) &&
    Number.isInteger(city.economy) &&
    (city.employed === undefined || Number.isInteger(city.employed)) &&
    (city.jobOffers === undefined || Number.isInteger(city.jobOffers)) &&
    (city.averageWage === undefined || Number.isFinite(city.averageWage)) &&
    (city.zones === undefined || (Array.isArray(city.zones) && city.zones.every(isCityZone)))
  );
}

function isCityZone(value: unknown): value is CityZone {
  if (typeof value !== 'object' || value === null) return false;
  const zone = value as Record<string, unknown>;
  return (
    typeof zone.id === 'string' &&
    typeof zone.cityId === 'string' &&
    (zone.type === 'urban' || zone.type === 'rural') &&
    Number.isInteger(zone.minX) &&
    Number.isInteger(zone.minY) &&
    Number.isInteger(zone.maxX) &&
    Number.isInteger(zone.maxY)
  );
}

function isRoadTile(value: unknown): value is RoadTile {
  if (typeof value !== 'object' || value === null) return false;
  const road = value as Record<string, unknown>;
  return (
    Number.isInteger(road.x) &&
    Number.isInteger(road.y) &&
    typeof road.cityId === 'string'
  );
}

function isRoadPosition(value: unknown): value is { x: number; y: number } {
  if (typeof value !== 'object' || value === null) return false;
  const position = value as Record<string, unknown>;
  return Number.isInteger(position.x) && Number.isInteger(position.y);
}

function isCityRoadUpdate(value: unknown): value is CityRoadUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const update = value as Record<string, unknown>;
  if (
    update.type !== 'city_roads' ||
    typeof update.cityId !== 'string' ||
    typeof update.sync !== 'boolean' ||
    !Number.isSafeInteger(update.revision) ||
    Number(update.revision) < 0
  ) {
    return false;
  }
  if (update.full === true) {
    return (
      Array.isArray(update.roads) &&
      update.roads.every((road) => isRoadTile(road) && road.cityId === update.cityId)
    );
  }
  return (
    update.full === false &&
    Number.isSafeInteger(update.baseRevision) &&
    Number(update.baseRevision) >= 0 &&
    Number(update.baseRevision) <= Number(update.revision) &&
    Array.isArray(update.upsert) &&
    update.upsert.every((road) => isRoadTile(road) && road.cityId === update.cityId) &&
    Array.isArray(update.removed) &&
    update.removed.every(isRoadPosition)
  );
}

function isEntityDelta<Entity, RemovedKey>(
  value: unknown,
  isEntity: (entity: unknown) => entity is Entity,
  isRemovedKey: (key: unknown) => key is RemovedKey,
): value is EntityDelta<Entity, RemovedKey> {
  if (typeof value !== 'object' || value === null) return false;
  const delta = value as Record<string, unknown>;
  return (
    Array.isArray(delta.upsert) &&
    delta.upsert.every(isEntity) &&
    Array.isArray(delta.removed) &&
    delta.removed.every(isRemovedKey)
  );
}

function isWorldDelta(value: unknown): value is WorldDelta<WorldBuilding> {
  if (typeof value !== 'object' || value === null) return false;
  const delta = value as Record<string, unknown>;
  if (delta.type !== 'world_delta') return false;
  if (typeof delta.revision !== 'number' || !Number.isInteger(delta.revision) || delta.revision < 1) {
    return false;
  }
  const hasCities = 'cities' in delta;
  const hasRoads = 'roads' in delta;
  const hasBuildings = 'buildings' in delta;
  return (
    (hasCities || hasRoads || hasBuildings) &&
    (!hasCities ||
      isEntityDelta(delta.cities, isCityAssembly, (key): key is string => typeof key === 'string')) &&
    (!hasRoads ||
      isEntityDelta(
        delta.roads,
        isRoadTile,
        (key): key is { x: number; y: number } =>
          typeof key === 'object' &&
          key !== null &&
          'x' in key &&
          Number.isInteger(key.x) &&
          'y' in key &&
          Number.isInteger(key.y),
      )) &&
    (!hasBuildings ||
      isEntityDelta(
        delta.buildings,
        isWorldBuilding,
        (key): key is string => typeof key === 'string',
      ))
  );
}

function isResidentialBuildingSummary(value: unknown): value is ResidentialBuildingSummary {
  if (typeof value !== 'object' || value === null) return false;
  const building = value as Record<string, unknown>;
  return (
    building.dataLevel === 'summary' &&
    typeof building.id === 'string' &&
    typeof building.ownerName === 'string' &&
    typeof building.isOwnedByCurrentUser === 'boolean' &&
    typeof building.type === 'string' &&
    getResidenceDefinition(building.type) !== null &&
    Number.isInteger(building.buildingNumber) &&
    Number.isInteger(building.x) &&
    Number.isInteger(building.y) &&
    typeof building.cityId === 'string' &&
    (building.status === 'under_construction' || building.status === 'completed') &&
    typeof building.startedAt === 'string' &&
    (building.completedAt === null || typeof building.completedAt === 'string')
  );
}

function isWorldBuilding(value: unknown): value is WorldBuilding {
  return isResidentialBuildingSummary(value) || isResidentialBuilding(value);
}

function isResidentialBuilding(value: unknown): value is ResidentialBuilding {
  if (typeof value !== 'object' || value === null) return false;
  const building = value as Record<string, unknown>;
  return (
    typeof building.id === 'string' &&
    (building.ownerName === undefined || typeof building.ownerName === 'string') &&
    (building.isOwnedByCurrentUser === undefined ||
      typeof building.isOwnedByCurrentUser === 'boolean') &&
    typeof building.type === 'string' &&
    getResidenceDefinition(building.type) !== null &&
    Number.isInteger(building.x) &&
    Number.isInteger(building.y) &&
    typeof building.cityId === 'string' &&
    (building.status === 'under_construction' || building.status === 'completed') &&
    typeof building.startedAt === 'string' &&
    (building.completedAt === null || typeof building.completedAt === 'string') &&
    isCurrencyAmount(building.wage) &&
    Number.isInteger(building.workHoursPerDay) &&
    typeof building.minimumWorkerTechnique === 'number' &&
    Number.isInteger(building.minimumWorkerTechnique) &&
    building.minimumWorkerTechnique >= 10 &&
    building.minimumWorkerTechnique <= 40 &&
    (building.averageWorkerTechnique === null ||
      (typeof building.averageWorkerTechnique === 'number' &&
        Number.isFinite(building.averageWorkerTechnique) &&
        building.averageWorkerTechnique >= 10 &&
        building.averageWorkerTechnique <= 40)) &&
    isCurrencyAmount(building.rent) &&
    Number.isInteger(building.occupants) &&
    typeof building.wellbeing === 'number' &&
    Number.isFinite(building.wellbeing) &&
    building.wellbeing >= 0 &&
    building.wellbeing <= 162 &&
    Number.isInteger(building.desiredWorkers) &&
    Number.isFinite(building.workPointsDone) &&
    isCurrencyAmount(building.price) &&
    Number.isInteger(building.stock) &&
    typeof building.stockLevels === 'object' &&
    building.stockLevels !== null &&
    !Array.isArray(building.stockLevels) &&
    Object.values(building.stockLevels).every(
      (level) => Number.isInteger(level) && level >= 1 && level <= 4,
    ) &&
    Array.isArray(building.warehouseIds) &&
    building.warehouseIds.every((warehouseId) => typeof warehouseId === 'string') &&
    (building.selectedInputProductId === null || typeof building.selectedInputProductId === 'string') &&
    typeof building.inputStocks === 'object' &&
    building.inputStocks !== null &&
    !Array.isArray(building.inputStocks) &&
    Object.values(building.inputStocks).every((quantity) => Number.isInteger(quantity) && quantity >= 0) &&
    (building.crop === null ||
      (typeof building.crop === 'object' && typeof (building.crop as { phase?: unknown }).phase === 'string')) &&
    Number.isInteger(building.employed)
  );
}

function isCityBuildingsUpdate(value: unknown): value is CityBuildingsUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const update = value as Record<string, unknown>;
  if (
    update.type !== 'city_buildings' ||
    typeof update.cityId !== 'string' ||
    !Number.isSafeInteger(update.revision) ||
    Number(update.revision) < 0
  ) {
    return false;
  }
  if (update.full === true) {
    return Array.isArray(update.buildings) && update.buildings.every(isWorldBuilding);
  }
  return (
    update.full === false &&
    Array.isArray(update.upsert) &&
    update.upsert.every(isWorldBuilding) &&
    Array.isArray(update.removed) &&
    update.removed.every((buildingId) => typeof buildingId === 'string')
  );
}

export function connectToWorld(
  onSnapshot: (snapshot: WorldSnapshot) => void,
  onConnectionChange: (connected: boolean) => void,
  onCitiesChange: (cities: CityAssembly[]) => void,
  onRoadsChange: (roads: RoadTile[]) => void,
  onResidentialBuildingsChange: (buildings: WorldBuilding[]) => void,
  onWorldDelta: (delta: WorldDelta<WorldBuilding>) => void,
  onCityRoadsChange: (update: CityRoadUpdate) => void,
  onCityBuildingsChange: (update: CityBuildingsUpdate) => void,
  onCityBuildingsCleared: () => void,
): { setRoadView: (position: RoadViewPosition | null) => void; close: () => void } {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let stopped = false;
  let retryDelay = 1000;
  let hasConnected = false;
  let worldRevision: number | null = null;
  let roadView: RoadViewPosition | null = null;
  let roadViewRequestId = 0;
  const roadRevisions = new Map<string, number>();
  const pendingRoadUpdates = new Map<string, CityRoadUpdate[]>();
  const roadResyncRequested = new Set<string>();
  let buildingRevision: number | null = null;
  let pendingBuildingUpdates: CityBuildingsUpdate[] = [];

  const transmitRoadView = (position: RoadViewPosition | null) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'road_view',
        requestId: ++roadViewRequestId,
        position,
        sinceRevision: position ? roadRevisions.get(position.cityId) ?? null : null,
      }),
    );
  };

  const applyCityBuildingsUpdate = (update: CityBuildingsUpdate) => {
    if (update.cityId !== roadView?.cityId) return;
    if (update.full) {
      if (buildingRevision !== null && update.revision < buildingRevision) return;
      onCityBuildingsChange(update);
      buildingRevision = update.revision;
      pendingBuildingUpdates.sort((first, second) => first.revision - second.revision);
      const pending = pendingBuildingUpdates;
      pendingBuildingUpdates = [];
      for (const candidate of pending) {
        if (candidate.revision > (buildingRevision ?? -1)) {
          applyCityBuildingsUpdate(candidate);
        }
      }
      return;
    }
    if (buildingRevision === null) {
      pendingBuildingUpdates.push(update);
      return;
    }
    if (update.revision <= buildingRevision) return;
    onCityBuildingsChange(update);
    buildingRevision = update.revision;
  };

  const requestRoadResync = (cityId: string) => {
    if (roadResyncRequested.has(cityId) || roadView?.cityId !== cityId) return;
    roadResyncRequested.add(cityId);
    transmitRoadView(roadView);
  };

  const applyRoadUpdate = (update: CityRoadUpdate) => {
    if (update.full) {
      const currentRevision = roadRevisions.get(update.cityId);
      if (currentRevision !== undefined && currentRevision > update.revision) return;
      onCityRoadsChange(update);
      roadRevisions.set(update.cityId, update.revision);
      roadResyncRequested.delete(update.cityId);
      return;
    }

    const currentRevision = roadRevisions.get(update.cityId);
    if (currentRevision === undefined) {
      const pending = pendingRoadUpdates.get(update.cityId) ?? [];
      if (!pending.some((candidate) => candidate.revision === update.revision)) {
        pending.push(update);
        pendingRoadUpdates.set(update.cityId, pending);
      }
      return;
    }
    if (update.revision <= currentRevision) return;
    if (currentRevision < update.baseRevision) {
      const pending = pendingRoadUpdates.get(update.cityId) ?? [];
      if (!pending.some((candidate) => candidate.revision === update.revision)) {
        pending.push(update);
        pendingRoadUpdates.set(update.cityId, pending);
      }
      requestRoadResync(update.cityId);
      return;
    }
    onCityRoadsChange(update);
    roadRevisions.set(update.cityId, update.revision);
  };

  const flushPendingRoadUpdates = (cityId: string) => {
    const pending = pendingRoadUpdates.get(cityId);
    if (!pending || pending.length === 0) return;
    pending.sort((first, second) => first.revision - second.revision);
    for (const update of pending) {
      if (update.revision > (roadRevisions.get(cityId) ?? -1)) {
        applyRoadUpdate(update);
      }
    }
    const currentRevision = roadRevisions.get(cityId);
    if (currentRevision !== undefined) {
      pendingRoadUpdates.set(
        cityId,
        pending.filter((update) => update.revision > currentRevision),
      );
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    reconnectTimer = window.setTimeout(() => {
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };

  const connect = async () => {
    if (stopped) return;

    try {
      const token = await getAccessToken();
      if (stopped) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`${protocol}//${window.location.host}/ws`);
      url.searchParams.set('token', token);
      url.searchParams.set('reconnect', hasConnected ? '1' : '0');
      url.searchParams.set('worldUpdates', 'delta-v1');
      url.searchParams.set('roadSync', 'city-v1');
      url.searchParams.set('buildingSync', 'city-v1');
      socket = new WebSocket(url);
    } catch (error) {
      console.error('Não foi possível autenticar a conexão com o mundo:', error);
      onConnectionChange(false);
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      hasConnected = true;
      retryDelay = 1000;
      onConnectionChange(true);
      buildingRevision = null;
      pendingBuildingUpdates = [];
      onCityBuildingsCleared();
      transmitRoadView(roadView);
    });
    socket.addEventListener('message', (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (typeof message === 'object' && message !== null && 'type' in message) {
          if (message.type === 'city_buildings') {
            if (!isCityBuildingsUpdate(message)) {
              console.error('O servidor enviou uma sincronização de construções inválida.');
              return;
            }
            applyCityBuildingsUpdate(message);
            return;
          }
          if (message.type === 'city_roads') {
            if (!isCityRoadUpdate(message)) {
              console.error('O servidor enviou uma sincronização de estradas inválida.');
              return;
            }
            if (message.cityId !== roadView?.cityId) return;
            if (message.sync) roadResyncRequested.delete(message.cityId);
            applyRoadUpdate(message);
            flushPendingRoadUpdates(message.cityId);
            return;
          }
          if (message.type === 'road_sync_error') {
            console.error(
              'Não foi possível sincronizar as estradas:',
              'message' in message && typeof message.message === 'string'
                ? message.message
                : 'erro desconhecido',
            );
            return;
          }
        }
        if (typeof message === 'object' && message !== null && 'type' in message &&
          message.type === 'world_delta') {
          if (!isWorldDelta(message)) {
            console.error('O servidor enviou uma atualização incremental do mundo inválida.');
            return;
          }
          if (worldRevision === null || message.revision !== worldRevision + 1) {
            console.error('A sequência de atualizações do mundo foi interrompida; reconectando para sincronizar.');
            socket?.close(4000, 'Sincronização completa necessária');
            return;
          }
          worldRevision = message.revision;
          onWorldDelta(message);
          return;
        }
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'cities' &&
          'cities' in message &&
          Array.isArray(message.cities) &&
          message.cities.every(isCityAssembly) &&
          (!('roads' in message) ||
            (Array.isArray(message.roads) && message.roads.every(isRoadTile))) &&
          (!('buildings' in message) ||
            (Array.isArray(message.buildings) && message.buildings.every(isWorldBuilding)))
        ) {
          worldRevision =
            'revision' in message &&
            typeof message.revision === 'number' &&
            Number.isInteger(message.revision) &&
            message.revision >= 0
              ? message.revision
              : null;
          onCitiesChange(
            message.cities.map((city) => ({
              ...city,
              zones: city.zones ?? [],
            })),
          );
          if ('roads' in message && Array.isArray(message.roads)) {
            onRoadsChange(message.roads);
          }
          onResidentialBuildingsChange(
            'buildings' in message && Array.isArray(message.buildings)
              ? message.buildings
              : [],
          );
          return;
        }
        const snapshot = message as WorldSnapshot;
        if (
          typeof snapshot.worldTime === 'string' &&
          typeof snapshot.serverTime === 'string' &&
          Number.isFinite(snapshot.timeScale)
        ) {
          onSnapshot(snapshot);
        }
      } catch (error) {
        console.error('Não foi possível interpretar a atualização do mundo.', error);
      }
    });
    socket.addEventListener('error', () => {
      onConnectionChange(false);
    });
    socket.addEventListener('close', () => {
      worldRevision = null;
      onConnectionChange(false);
      scheduleReconnect();
    });
  };

  void connect();

  return {
    setRoadView: (position) => {
      const previousCityId = roadView?.cityId ?? null;
      const nextCityId = position?.cityId ?? null;
      roadView = position;
      if (previousCityId === nextCityId) return;
      if (previousCityId !== null) {
        pendingRoadUpdates.delete(previousCityId);
        roadResyncRequested.delete(previousCityId);
      }
      buildingRevision = null;
      pendingBuildingUpdates = [];
      onCityBuildingsCleared();
      transmitRoadView(position);
    },
    close: () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
