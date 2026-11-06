import type { CityAssembly, ConstructionCategory } from './city.js';
import {
  FARM_CROP_RULES,
  type Crop,
  type FarmCropRule,
  type FarmCropType,
} from './farming.js';
import { ASSEMBLY_SIZE, isFootprintInCityZone, MUNICIPAL_AREA_RADIUS } from './city.js';
import type { RoadTile } from './road.js';

export type ResidenceType =
  | 'house_poor1'
  | 'house_poor2'
  | FarmCropType
  | 'farm_dairy'
  | 'shop_rice'
  | 'shop_milk'
  | 'warehouse'
  | 'fishery'
  | 'shop_fish'
  | 'lumber_mill'
  | 'quarry'
  | 'iron_mine'
  | 'toolmaker';
export type BuildingKind =
  | 'residence'
  | 'farm'
  | 'shop'
  | 'warehouse'
  | 'fishery'
  | 'resource'
  | 'workshop';

// Categoria da barra de construção em que cada tipo aparece.
export const KIND_CATEGORY: Record<BuildingKind, ConstructionCategory> = {
  residence: 'residencias',
  farm: 'fazendas',
  shop: 'comerciais',
  warehouse: 'industrias',
  fishery: 'artesanais',
  workshop: 'artesanais',
  resource: 'recursos',
};

// 'accumulate': 1 unidade a cada N Work Points, com resto acumulado.
// 'chance': Work Points/N é a probabilidade diária de 1 unidade (parte inteira é certa).
// 'batch': cada N Work Points + insumos geram um lote de `batchSize` unidades.
export interface ProductionRule {
  mode: 'accumulate' | 'chance' | 'batch';
  workPointsPerUnit: number;
  batchSize?: number;
  batchWood?: number;
  batchIron?: number;
}
export type ResidentialBuildingStatus = 'under_construction' | 'completed';

export interface ResidenceCost {
  wood: number;
  stone: number;
}

export interface ConstructionMaterialStock {
  buildingId: string;
  productId: 'wood' | 'stone';
  quantity: number;
}

export interface ConstructionMaterialWithdrawal {
  buildingId: string;
  productId: 'wood' | 'stone';
  quantity: number;
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
  cropRule?: FarmCropRule;
  // Estoques máximos de insumos (Ferramentas, madeira, ferro) guardados pela construção.
  toolCapacity?: number;
  woodCapacity?: number;
  ironCapacity?: number;
  // Demanda diária de Ferramentas por funcionário (valores abaixo de 1 são probabilidade).
  toolDemandPerWorker?: number;
  production?: ProductionRule;
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
export const MAX_CONSTRUCTION_WORKERS = 100;
export const RESIDENCE_STATS = { skill: 10, health: 100, happiness: 100 } as const;
// Raio (em tiles) em que uma obra ou fazenda procura trabalhadores.
export const WORKER_SEARCH_RADIUS = 60;

export function isPlayerBuildableConstructionType(type: unknown): type is ResidenceType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(RESIDENCES, type);
}

export function planConstructionMaterialWithdrawals(
  stocks: readonly ConstructionMaterialStock[],
  cost: ResidenceCost,
): ConstructionMaterialWithdrawal[] | null {
  const withdrawals: ConstructionMaterialWithdrawal[] = [];
  for (const productId of ['wood', 'stone'] as const) {
    let remaining = cost[productId];
    if (!Number.isInteger(remaining) || remaining < 0) return null;
    for (const stock of stocks) {
      if (stock.productId !== productId || !Number.isInteger(stock.quantity) || stock.quantity <= 0) {
        continue;
      }
      const quantity = Math.min(remaining, stock.quantity);
      if (quantity > 0) {
        withdrawals.push({ buildingId: stock.buildingId, productId, quantity });
        remaining -= quantity;
      }
      if (remaining === 0) break;
    }
    if (remaining > 0) return null;
  }
  return withdrawals;
}

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
    cropRule: FARM_CROP_RULES.farm_rice,
  },
  farm_potato: {
    type: 'farm_potato',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda de Batata',
    asset: '/buildings/farms/fazenda_batata.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Batata',
    stockProductId: 'potato',
    stockCapacity: 300,
    cropRule: FARM_CROP_RULES.farm_potato,
  },
  farm_wheat: {
    type: 'farm_wheat',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda de Trigo',
    asset: '/buildings/farms/fazenda_trigo.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Trigo',
    stockProductId: 'wheat',
    stockCapacity: 300,
    cropRule: FARM_CROP_RULES.farm_wheat,
  },
  farm_barley: {
    type: 'farm_barley',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda de Cevada',
    asset: '/buildings/farms/fazenda_cevada.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Cevada',
    stockProductId: 'barley',
    stockCapacity: 300,
    cropRule: FARM_CROP_RULES.farm_barley,
  },
  farm_corn: {
    type: 'farm_corn',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda de Milho',
    asset: '/buildings/farms/fazenda_milho.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Milho',
    stockProductId: 'corn',
    stockCapacity: 300,
    cropRule: FARM_CROP_RULES.farm_corn,
  },
  farm_cattle: {
    type: 'farm_cattle',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda Bovina',
    asset: '/buildings/farms/fazenda_bovina.png',
    width: 4,
    height: 4,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 200, stone: 20 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Carne Vermelha',
    stockProductId: 'red_meat',
    stockCapacity: 300,
    cropRule: FARM_CROP_RULES.farm_cattle,
  },
  farm_dairy: {
    type: 'farm_dairy',
    kind: 'farm',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Fazenda leiteira',
    asset: '/buildings/farms/fazenda_leiteira.png',
    width: 3,
    height: 3,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 60, stone: 60 },
    workPoints: 12000,
    maxWorkers: 10,
    stockProduct: 'Leite',
    stockProductId: 'milk',
    stockCapacity: 400,
    production: { mode: 'accumulate', workPointsPerUnit: 5 },
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
  shop_milk: {
    type: 'shop_milk',
    kind: 'shop',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Loja de Leite',
    asset: '/buildings/commerce/loja_leite.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 30, stone: 10 },
    workPoints: 6000,
    maxWorkers: 4,
    stockProduct: 'Leite',
    stockProductId: 'milk',
    stockCapacity: 40,
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
    toolDemandPerWorker: 0.05,
    production: { mode: 'accumulate', workPointsPerUnit: 100 },
    requiresWater: true,
  },
  lumber_mill: {
    type: 'lumber_mill',
    kind: 'resource',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Madeireira',
    asset: '/buildings/resources/madeireira.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 60, stone: 10 },
    workPoints: 6000,
    maxWorkers: 10,
    stockProduct: 'Madeira',
    stockProductId: 'wood',
    stockCapacity: 30,
    toolCapacity: 5,
    toolDemandPerWorker: 0.05,
    production: { mode: 'chance', workPointsPerUnit: 1000 },
  },
  quarry: {
    type: 'quarry',
    kind: 'resource',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Pedreira',
    asset: '/buildings/resources/pedreira.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 60, stone: 10 },
    workPoints: 6000,
    maxWorkers: 30,
    stockProduct: 'Pedra',
    stockProductId: 'stone',
    stockCapacity: 10,
    toolCapacity: 5,
    toolDemandPerWorker: 0.05,
    production: { mode: 'chance', workPointsPerUnit: 3000 },
  },
  iron_mine: {
    type: 'iron_mine',
    kind: 'resource',
    requiredZone: 'rural',
    requiresRoad: true,
    name: 'Mina de Ferro',
    asset: '/buildings/resources/mina_ferro.png',
    width: 3,
    height: 3,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 120, stone: 60 },
    workPoints: 24000,
    maxWorkers: 30,
    stockProduct: 'Ferro',
    stockProductId: 'iron',
    stockCapacity: 5,
    toolCapacity: 5,
    toolDemandPerWorker: 0.15,
    production: { mode: 'chance', workPointsPerUnit: 3000 },
  },
  toolmaker: {
    type: 'toolmaker',
    kind: 'workshop',
    requiredZone: 'urban',
    requiresRoad: true,
    name: 'Ferramentaria',
    asset: '/buildings/artisan/ferramentaria.png',
    width: 2,
    height: 2,
    capacity: 0,
    localAppeal: 0,
    cost: { wood: 60, stone: 60 },
    workPoints: 12000,
    maxWorkers: 30,
    stockProduct: 'Ferramentas',
    stockProductId: 'tools',
    stockCapacity: 100,
    woodCapacity: 30,
    ironCapacity: 5,
    production: { mode: 'batch', workPointsPerUnit: 1000, batchSize: 100, batchWood: 5, batchIron: 1 },
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
  ownerName?: string;
  isOwnedByCurrentUser?: boolean;
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
  woodStock: number;
  ironStock: number;
  efficiencyPenalty: number;
  // Plantio/ciclo das fazendas agrícolas; null quando não há plantio.
  crop: Crop | null;
  // Funcionários empregados na construção ou, em residências, moradores empregados.
  employed: number;
  averageIncome: number;
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
  return Object.prototype.hasOwnProperty.call(RESIDENCES, type) ? RESIDENCES[type as ResidenceType] : null;
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
