import { roundCurrency } from './currency.js';
import type { ResidenceDefinition } from './residence.js';

export type StockCapacityKey =
  | 'stock'
  | 'tools'
  | 'wood'
  | 'iron'
  | 'charcoal'
  | 'sugarcane'
  | `input:${string}`;

export type StockLevels = Readonly<Record<string, number>>;

export interface StockCapacitySlot {
  key: StockCapacityKey;
  capacity: number;
}

export interface StockCapacityUpgradeQuote {
  key: StockCapacityKey;
  level: number;
  capacity: number;
  currentStock: number;
  nextLevel: number | null;
  nextCapacity: number | null;
  upgradeCost: number | null;
  previousCapacity: number | null;
  canDowngrade: boolean;
}

const UPGRADE_COST_BY_LEVEL: Readonly<Record<number, number>> = {
  2: 0.1,
  3: 0.4,
  4: 1,
};

function getBaseCapacity(
  definition: ResidenceDefinition,
  key: StockCapacityKey,
): number {
  if (key === 'stock') return definition.stockCapacity ?? 0;
  if (key === 'tools') return definition.toolCapacity ?? 0;
  if (key === 'wood') return definition.woodCapacity ?? 0;
  if (key === 'iron') return definition.ironCapacity ?? 0;
  if (key === 'charcoal') return definition.charcoalCapacity ?? 0;
  if (key === 'sugarcane') return definition.sugarcaneCapacity ?? 0;
  return definition.inputCapacities?.[key.slice('input:'.length)] ?? 0;
}

export function getStockLevel(levels: StockLevels, key: StockCapacityKey): number {
  const level = levels[key] ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > 4) {
    throw new RangeError(`O nível do estoque ${key} precisa estar entre 1 e 4.`);
  }
  return level;
}

export function getStockCapacity(
  definition: ResidenceDefinition,
  key: StockCapacityKey,
  levels: StockLevels = {},
): number {
  return getBaseCapacity(definition, key) * getStockLevel(levels, key);
}

export function getStockCapacitySlots(
  definition: ResidenceDefinition,
  selectedInputProductId: string | null,
): StockCapacitySlot[] {
  const slots: StockCapacitySlot[] = [];
  const add = (key: StockCapacityKey, capacity: number | undefined) => {
    if (capacity !== undefined && capacity > 0) slots.push({ key, capacity });
  };
  add('stock', definition.stockCapacity);
  add('tools', definition.toolCapacity);
  add('wood', definition.woodCapacity);
  add('iron', definition.ironCapacity);
  add('charcoal', definition.charcoalCapacity);
  add('sugarcane', definition.sugarcaneCapacity);
  for (const [productId, capacity] of Object.entries(definition.inputCapacities ?? {})) {
    if (
      !definition.selectableInputProductIds ||
      selectedInputProductId === productId
    ) {
      add(`input:${productId}`, capacity);
    }
  }
  return slots;
}

export function getExpectedConstructionCost(
  definition: ResidenceDefinition,
  warehousePrices: ReadonlyMap<string, number>,
  averageCitySalary: number,
): number | null {
  if (!Number.isFinite(averageCitySalary) || averageCitySalary < 0) {
    throw new RangeError('O salário médio da cidade é inválido.');
  }
  let materialCost = 0;
  for (const productId of ['wood', 'stone', 'iron', 'steel'] as const) {
    const quantity = definition.cost[productId] ?? 0;
    if (quantity === 0) continue;
    const price = warehousePrices.get(productId);
    if (price === undefined || !Number.isFinite(price) || price <= 0) return null;
    materialCost += quantity * price;
  }
  return roundCurrency(materialCost + (definition.workPoints / 100) * averageCitySalary);
}

export function getStockUpgradeCost(
  expectedConstructionCost: number,
  targetLevel: number,
): number {
  const fraction = UPGRADE_COST_BY_LEVEL[targetLevel];
  if (!Number.isFinite(expectedConstructionCost) || expectedConstructionCost < 0 || fraction === undefined) {
    throw new RangeError('O nível ou custo esperado para o upgrade é inválido.');
  }
  return roundCurrency(expectedConstructionCost * fraction);
}
