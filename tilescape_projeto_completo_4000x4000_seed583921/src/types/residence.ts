import type { CityAssembly } from './city.js';
import type { Crop } from './farming.js';
import { ASSEMBLY_SIZE, isFootprintInCityZone, MUNICIPAL_AREA_RADIUS } from './city.js';
import type { RoadTile } from './road.js';

export type ResidenceType =
  | 'house_poor1'
  | 'house_poor2'
  | 'farm_rice'
  | 'shop_rice'
  | 'warehouse'
  | 'fishery'
  | 'shop_fish';
export type BuildingKind = 'residence' | 'farm' | 'shop' | 'warehouse' | 'fishery';
export type ResidentialBuildingStatus = 'under_construction' | 'completed';

export interface ResidenceCost {
  wood: number;
  stone: number;
}

export interface ResidenceDefinition {
  type: ResidenceType;
  kind: BuildingKind;
  requiredZone: 'urban' | 'rural';
  requiresRoad: boolean;
  name: string;
  asset: string;
  width: number;
  height: number;
  capacity: number;
  localAppeal: number;
  cost: ResidenceCost;
  workPoints: number;
  maxWorkers: number;
  stockProduct?: string;
  stockProductId?: string;
  stockCapacity?: number;
  // Estoque máximo de Ferramentas consumidas pela construção (Pesqueiro).
  toolCapacity?: number;
  // Exige pelo menos um tile sobre água (o restante pode ser terra).
  requiresWater?: boolean;
  storageCapacityM3?: number;
}

export const DEFAULT_WAGE = 10;
export const MAX_WAGE = 100000;
export const DEFAULT_WORK_HOURS = 8;
export const MIN_WORK_HOURS = 4;
export const MAX_WORK_HOURS = 14;
export const DEFAULT_RENT = 10;
export const MIN_RENT = 1;
export const MAX_RENT = 100000;
export const RESIDENCE_STATS = { skill: 10, health: 100, happiness: 100 } as const;
// Raio (em tiles) em que uma obra ou fazenda procura trabalhadores.
export const WORKER_SEARCH_RADIUS = 60;

export function isWithinWorkerSearchRadius(
  building: { type: ResidenceType; x: number; y: number },
  point: { x: number; y: number },
): boolean {
  const { width, height } = RESIDENCES[building.type];
  const dx = point.x + 0.5 - (building.x + width / 2);
  const dy = point.y + 0.5 - (building.y + height / 2);
  return dx * dx + dy * dy <= WORKER_SEARCH_RADIUS * WORKER_SEARCH_RADIUS;
}

export function parseWorkSettings(
  value: unknown,
): { wage: number; workHoursPerDay: number; desiredWorkers: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { wage, workHoursPerDay, desiredWorkers } = value as Record<string, unknown>;
  if (
    typeof desiredWorkers !== 'number' ||
    !Number.isInteger(desiredWorkers) ||
    desiredWorkers < 0 ||
    desiredWorkers > 100000 ||
    typeof wage !== 'number' ||
    !Number.isInteger(wage) ||
    wage < 0 ||
    wage > MAX_WAGE ||
    typeof workHoursPerDay !== 'number' ||
    !Number.isInteger(workHoursPerDay) ||
    workHoursPerDay < MIN_WORK_HOURS ||
    workHoursPerDay > MAX_WORK_HOURS
  ) {
    return null;
  }
  return { wage, workHoursPerDay, desiredWorkers };
}

export function parseRent(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const { rent } = value as Record<string, unknown>;
  if (typeof rent !== 'number' || !Number.isInteger(rent) || rent < MIN_RENT || rent > MAX_RENT) {
    return null;
  }
  return rent;
}

export const RESIDENCES: Record<ResidenceType, ResidenceDefinition> = {
  house_poor1: {
    type: 'house_poor1',
    kind: 'residence',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Residência simples 1',
    asset: '/buildings/residences/house_poor1.png',
    width: 2,
    height: 2,
    capacity: 4,
    localAppeal: 50,
    cost: { wood: 100, stone: 30 },
    workPoints: 18000,
    maxWorkers: 6,
  },
  house_poor2: {
    type: 'house_poor2',
    kind: 'residence',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Residência simples 2',
    asset: '/buildings/residences/house_poor2.png',
    width: 3,
    height: 3,
    capacity: 32,
    localAppeal: 40,
    cost: { wood: 300, stone: 450 },
    workPoints: 67500,
    maxWorkers: 20,
  },
  farm_rice: {
    type: 'farm_rice',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda de arroz',
    asset: '/buildings/farms/fazenda_arroz.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Arroz',
    stockProductId: 'rice',
    stockCapacity: 300,
  },
  shop_rice: {
    type: 'shop_rice',
    kind: 'shop',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Loja de Arroz',
    asset: '/buildings/commerce/loja_arroz.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 100, stone: 20 },
    workPoints: 9000,
    maxWorkers: 4,
    stockProduct: 'Arroz',
    stockProductId: 'rice',
    stockCapacity: 20,
  },
  fishery: {
    type: 'fishery',
    kind: 'fishery',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Pesqueiro',
    asset: '/buildings/artisan/pesqueiro.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 60, stone: 10 },
    workPoints: 12000,
    maxWorkers: 10,
    stockProduct: 'Peixe',
    stockProductId: 'fish',
    stockCapacity: 300,
    toolCapacity: 10,
    requiresWater: true,
  },
  shop_fish: {
    type: 'shop_fish',
    kind: 'shop',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Loja de Peixes',
    asset: '/buildings/commerce/loja_peixe.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 30, stone: 10 },
    workPoints: 6000,
    maxWorkers: 4,
    stockProduct: 'Peixe',
    stockProductId: 'fish',
    stockCapacity: 40,
  },
  warehouse: {
    type: 'warehouse',
    kind: 'warehouse',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Armazém',
    asset: '/buildings/industrial/armazem.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 300, stone: 60 },
    workPoints: 20000,
    maxWorkers: 100,
    storageCapacityM3: 50,
  },
};

export const UNDER_CONSTRUCTION_ASSET = '/buildings/em_construcao.png';

export interface ResidentialBuilding {
  id: string;
  type: ResidenceType;
  x: number;
  y: number;
  cityId: string;
  status: ResidentialBuildingStatus;
  startedAt: string;
  completedAt: string | null;
  wage: number;
  workHoursPerDay: number;
  rent: number;
  occupants: number;
  desiredWorkers: number;
  workPointsDone: number;
  price: number;
  stock: number;
  warehouseId: string | null;
  // Pesqueiro: Ferramentas em estoque e penalidade de eficiência (0–90, em %).
  toolStock: number;
  efficiencyPenalty: number;
  // Plantação da fazenda de arroz; null quando não há plantio.
  crop: Crop | null;
  // Funcionários empregados na construção ou, em residências, moradores empregados.
  employed: number;
}

export type ResidencePlacementError =
  | 'invalid_residence'
  | 'map_bounds'
  | 'outside_municipality'
  | 'outside_urban_zone'
  | 'outside_rural_zone'
  | 'water'
  | 'not_on_water'
  | 'building_overlap'
  | 'road_overlap'
  | 'not_adjacent_to_road';

export function getResidenceDefinition(type: string): ResidenceDefinition | null {
  if (
    type === 'house_poor1' ||
    type === 'house_poor2' ||
    type === 'farm_rice' ||
    type === 'shop_rice' ||
    type === 'warehouse' ||
    type === 'fishery' ||
    type === 'shop_fish'
  ) {
    return RESIDENCES[type];
  }
  return null;
}

export function isTileInResidenceFootprint(
  building: Pick<ResidentialBuilding, 'type' | 'x' | 'y'>,
  position: { x: number; y: number },
): boolean {
  const definition = RESIDENCES[building.type];
  return (
    position.x >= building.x &&
    position.x < building.x + definition.width &&
    position.y >= building.y &&
    position.y < building.y + definition.height
  );
}

export function getResidencePlacementError(
  type: ResidenceType,
  position: { x: number; y: number },
  cities: CityAssembly[],
  buildings: Pick<ResidentialBuilding, 'type' | 'x' | 'y'>[],
  roads: Pick<RoadTile, 'x' | 'y'>[],
  isLandAt: (x: number, y: number) => boolean,
  map: { width: number; height: number },
): ResidencePlacementError | null {
  const definition = RESIDENCES[type];
  const maxX = position.x + definition.width - 1;
  const maxY = position.y + definition.height - 1;
  if (
    !Number.isInteger(position.x) ||
    !Number.isInteger(position.y) ||
    position.x < 0 ||
    position.y < 0 ||
    maxX >= map.width ||
    maxY >= map.height
  ) {
    return 'map_bounds';
  }

  const city = cities.find(
    (candidate) =>
      position.x >= candidate.centerX - MUNICIPAL_AREA_RADIUS &&
      position.y >= candidate.centerY - MUNICIPAL_AREA_RADIUS &&
      maxX <= candidate.centerX + MUNICIPAL_AREA_RADIUS &&
      maxY <= candidate.centerY + MUNICIPAL_AREA_RADIUS,
  );
  if (!city) return 'outside_municipality';

  const footprint = {
    minX: position.x,
    minY: position.y,
    maxX,
    maxY,
  };
  if (!isFootprintInCityZone([footprint], city.zones, definition.requiredZone)) {
    return definition.requiredZone === 'urban' ? 'outside_urban_zone' : 'outside_rural_zone';
  }

  const roadKeys = new Set(roads.map((road) => `${road.x},${road.y}`));
  let adjacentToRoad = false;
  let hasWater = false;
  for (let y = position.y; y <= maxY; y += 1) {
    for (let x = position.x; x <= maxX; x += 1) {
      if (!isLandAt(x, y)) {
        if (!definition.requiresWater) return 'water';
        hasWater = true;
      }

      const assemblyOffset = Math.floor(ASSEMBLY_SIZE / 2);
      if (
        cities.some(
          (existingCity) =>
            x >= existingCity.centerX - assemblyOffset &&
            x <= existingCity.centerX + assemblyOffset &&
            y >= existingCity.centerY - assemblyOffset &&
            y <= existingCity.centerY + assemblyOffset,
        )
      ) {
        return 'building_overlap';
      }

      if (roadKeys.has(`${x},${y}`)) return 'road_overlap';
      if (
        roadKeys.has(`${x - 1},${y}`) ||
        roadKeys.has(`${x + 1},${y}`) ||
        roadKeys.has(`${x},${y - 1}`) ||
        roadKeys.has(`${x},${y + 1}`)
      ) {
        adjacentToRoad = true;
      }
    }
  }

  for (const building of buildings) {
    const existing = RESIDENCES[building.type];
    if (
      position.x <= building.x + existing.width - 1 &&
      maxX >= building.x &&
      position.y <= building.y + existing.height - 1 &&
      maxY >= building.y
    ) {
      return 'building_overlap';
    }
  }

  if (definition.requiresWater && !hasWater) return 'not_on_water';
  return adjacentToRoad || !definition.requiresRoad ? null : 'not_adjacent_to_road';
}
