import type { CityAssembly } from './city.js';
import type { RoadPosition, RoadTile } from './road.js';
import type { ResidentialBuilding } from './residence.js';

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
