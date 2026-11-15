import type { CityAssembly } from './city.js';
import type { RoadPosition, RoadTile } from './road.js';
import {
  isResidentialBuildingSummary,
  type WorldBuilding,
} from './residence.js';

export interface WorldEntities<Building extends { id: string }> {
  cities: CityAssembly[];
  roads: RoadTile[];
  buildings: Building[];
}

export interface EntityDelta<Entity, RemovedKey> {
  upsert: Entity[];
  removed: RemovedKey[];
}

export interface WorldDelta<Building extends { id: string }> {
  type: 'world_delta';
  revision: number;
  cities?: EntityDelta<CityAssembly, string>;
  roads?: EntityDelta<RoadTile, RoadPosition>;
  buildings?: EntityDelta<Building, string>;
}

export type CityBuildingsUpdate =
  | {
      type: 'city_buildings';
      cityId: string;
      revision: number;
      full: true;
      buildings: WorldBuilding[];
    }
  | {
      type: 'city_buildings';
      cityId: string;
      revision: number;
      full: false;
      upsert: WorldBuilding[];
      removed: string[];
    };

export interface RoadViewPosition extends RoadPosition {
  cityId: string;
}

export type CityRoadUpdate =
  | {
      type: 'city_roads';
      cityId: string;
      revision: number;
      sync: boolean;
      full: true;
      roads: RoadTile[];
    }
  | {
      type: 'city_roads';
      cityId: string;
      revision: number;
      sync: boolean;
      baseRevision: number;
      full: false;
      upsert: RoadTile[];
      removed: RoadPosition[];
    };

export function createEntityDelta<Entity, RemovedKey>(
  previous: readonly Entity[],
  current: readonly Entity[],
  getKey: (entity: Entity) => string,
  getRemovedKey: (entity: Entity) => RemovedKey,
): EntityDelta<Entity, RemovedKey> | null {
  const previousByKey = new Map(previous.map((entity) => [getKey(entity), entity]));
  const currentKeys = new Set(current.map(getKey));
  const upsert = current.filter((entity) => {
    const previousEntity = previousByKey.get(getKey(entity));
    return previousEntity === undefined || JSON.stringify(previousEntity) !== JSON.stringify(entity);
  });
  const removed = previous
    .filter((entity) => !currentKeys.has(getKey(entity)))
    .map(getRemovedKey);

  return upsert.length > 0 || removed.length > 0 ? { upsert, removed } : null;
}

export function createWorldDelta<Building extends { id: string }>(
  previous: WorldEntities<Building>,
  current: WorldEntities<Building>,
  revision: number,
): WorldDelta<Building> | null {
  const cities = createEntityDelta(
    previous.cities,
    current.cities,
    (city) => city.id,
    (city) => city.id,
  );
  const roads = createEntityDelta(
    previous.roads,
    current.roads,
    (road) => `${road.x},${road.y}`,
    ({ x, y }) => ({ x, y }),
  );
  const buildings = createEntityDelta(
    previous.buildings,
    current.buildings,
    (building) => building.id,
    (building) => building.id,
  );
  if (!cities && !roads && !buildings) return null;

  return {
    type: 'world_delta',
    revision,
    ...(cities ? { cities } : {}),
    ...(roads ? { roads } : {}),
    ...(buildings ? { buildings } : {}),
  };
}

export function applyEntityDelta<Entity, RemovedKey>(
  current: readonly Entity[],
  delta: EntityDelta<Entity, RemovedKey>,
  getKey: (entity: Entity) => string,
  getRemovedKey: (key: RemovedKey) => string,
): Entity[] {
  const removedKeys = new Set(delta.removed.map(getRemovedKey));
  const entities = new Map(
    current
      .filter((entity) => !removedKeys.has(getKey(entity)))
      .map((entity) => [getKey(entity), entity]),
  );
  for (const entity of delta.upsert) {
    entities.set(getKey(entity), entity);
  }
  return [...entities.values()];
}

export function applyWorldBuildingDelta(
  current: readonly WorldBuilding[],
  delta: EntityDelta<WorldBuilding, string>,
): WorldBuilding[] {
  const removedIds = new Set(delta.removed);
  const buildings = new Map(
    current
      .filter((building) => !removedIds.has(building.id))
      .map((building) => [building.id, building]),
  );
  for (const update of delta.upsert) {
    const previous = buildings.get(update.id);
    if (
      previous &&
      !isResidentialBuildingSummary(previous) &&
      isResidentialBuildingSummary(update) &&
      previous.isOwnedByCurrentUser === true &&
      update.isOwnedByCurrentUser
    ) {
      buildings.set(update.id, {
        ...previous,
        id: update.id,
        ownerName: update.ownerName,
        isOwnedByCurrentUser: update.isOwnedByCurrentUser,
        type: update.type,
        buildingNumber: update.buildingNumber,
        x: update.x,
        y: update.y,
        cityId: update.cityId,
        status: update.status,
        startedAt: update.startedAt,
        completedAt: update.completedAt,
      });
    } else {
      buildings.set(update.id, update);
    }
  }
  return [...buildings.values()];
}
