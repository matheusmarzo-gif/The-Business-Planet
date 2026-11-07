import type { CityAssembly, ConstructionCategory } from './city.js';
import {
  type Crop,
  type FarmCropRule,
} from './farming.js';
import { ASSEMBLY_SIZE, isFootprintInCityZone, MUNICIPAL_AREA_RADIUS } from './city.js';
import type { RoadTile } from './road.js';
import { isCurrencyAmount, roundCurrency } from './currency.js';
import { BUILDING_CONFIGS, GAME_RULES } from '../generated/gameConfig.js';

export type ResidenceType = keyof typeof BUILDING_CONFIGS;

export const SHOP_TYPES = [
  'shop_rice',
  'shop_potato',
  'shop_corn',
  'shop_barley',
  'shop_wheat',
  'shop_butcher',
  'shop_fish',
  'shop_milk',
  'shop_sugar',
  'shop_vegetables',
  'shop_salt',
  'shop_spices',
] as const satisfies readonly ResidenceType[];
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
  batchCharcoal?: number;
  batchStockProductId?: string;
  batchStockAmount?: number;
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
  // Estoques máximos de insumos guardados pela construção.
  toolCapacity?: number;
  woodCapacity?: number;
  ironCapacity?: number;
  charcoalCapacity?: number;
  // Estoque de cana recebido por armazém e consumido pela Casa de Engenho.
  sugarcaneCapacity?: number;
  // Demanda diária de Ferramentas por funcionário (valores abaixo de 1 são probabilidade).
  toolDemandPerWorker?: number;
  production?: ProductionRule;
  // Exige pelo menos um tile sobre água (o restante pode ser terra).
  requiresWater?: boolean;
  requiresAdjacentWater?: boolean;
  storageCapacityM3?: number;
  dairyEfficiencyByQuarter?: readonly [number, number, number, number];
}

export const DEFAULT_WAGE = GAME_RULES.work.wage.default;
export const MAX_WAGE = GAME_RULES.work.wage.maximum;
export const DEFAULT_WORK_HOURS = GAME_RULES.work.hours.default;
export const MIN_WORK_HOURS = GAME_RULES.work.hours.minimum;
export const MAX_WORK_HOURS = GAME_RULES.work.hours.maximum;
export const DEFAULT_RENT = GAME_RULES.work.rent.default;
export const MIN_RENT = GAME_RULES.work.rent.minimum;
export const MAX_RENT = GAME_RULES.work.rent.maximum;
export const MAX_CONSTRUCTION_WORKERS = GAME_RULES.work.maxConstructionWorkers;
export const RESIDENCE_STATS = GAME_RULES.work.residentStats;
// Raio (em tiles) em que uma obra ou fazenda procura trabalhadores.
export const WORKER_SEARCH_RADIUS = GAME_RULES.work.workerSearchRadiusTiles;

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
  point: { type?: ResidenceType; x: number; y: number },
): boolean {
  const { width, height } = RESIDENCES[building.type];
  const pointDefinition = point.type ? RESIDENCES[point.type] : null;
  const pointCenterX = point.x + (pointDefinition ? pointDefinition.width / 2 : 0.5);
  const pointCenterY = point.y + (pointDefinition ? pointDefinition.height / 2 : 0.5);
  const dx = pointCenterX - (building.x + width / 2);
  const dy = pointCenterY - (building.y + height / 2);
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
    !isCurrencyAmount(wage) ||
    wage < 0 ||
    wage > MAX_WAGE ||
    typeof workHoursPerDay !== 'number' ||
    !Number.isInteger(workHoursPerDay) ||
    workHoursPerDay < MIN_WORK_HOURS ||
    workHoursPerDay > MAX_WORK_HOURS
  ) {
    return null;
  }
  return { wage: roundCurrency(wage), workHoursPerDay, desiredWorkers };
}

export function parseRent(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const { rent } = value as Record<string, unknown>;
  if (!isCurrencyAmount(rent) || rent < MIN_RENT || rent > MAX_RENT) {
    return null;
  }
  return roundCurrency(rent);
}

export const RESIDENCES: Record<ResidenceType, ResidenceDefinition> = BUILDING_CONFIGS;

export const UNDER_CONSTRUCTION_ASSET = '/buildings/em_construcao.png';

export interface ResidentialBuilding {
  id: string;
  ownerName?: string;
  isOwnedByCurrentUser?: boolean;
  type: ResidenceType;
  buildingNumber?: number;
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
  // Ferramentas em estoque e penalidade de eficiência (0–90, em %) para construções que as usam.
  toolStock: number;
  woodStock: number;
  ironStock: number;
  charcoalStock: number;
  sugarcaneStock: number;
  efficiencyPenalty: number;
  // Plantio/ciclo das fazendas agrícolas; null quando não há plantio.
  crop: Crop | null;
  // Funcionários empregados na construção ou, em residências, moradores empregados.
  employed: number;
  averageIncome: number;
}

const ROMAN_NUMERALS: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRomanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('O número da construção precisa ser um inteiro positivo.');
  }
  let remaining = value;
  let numeral = '';
  for (const [amount, symbol] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      numeral += symbol;
      remaining -= amount;
    }
  }
  return numeral;
}

export function getResidentialBuildingName(type: ResidenceType, buildingNumber = 1): string {
  return `${RESIDENCES[type].name} ${toRomanNumeral(buildingNumber)}`;
}

export type ResidencePlacementError =
  | 'invalid_residence'
  | 'map_bounds'
  | 'outside_municipality'
  | 'outside_urban_zone'
  | 'outside_rural_zone'
  | 'water'
  | 'not_on_water'
  | 'not_adjacent_to_water'
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
  let adjacentToWater = false;
  const mapDirections = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];
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
      if (definition.requiresAdjacentWater) {
        adjacentToWater ||= mapDirections.some(({ x: dx, y: dy }) => {
          const waterX = x + dx;
          const waterY = y + dy;
          return (
            waterX >= 0 &&
            waterY >= 0 &&
            waterX < map.width &&
            waterY < map.height &&
            !isLandAt(waterX, waterY)
          );
        });
      }
    }
  }

  if (definition.requiresAdjacentWater && !adjacentToWater) return 'not_adjacent_to_water';

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
