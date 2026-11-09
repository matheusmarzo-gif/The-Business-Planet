import { FARM_CROP_RULES as GENERATED_FARM_CROP_RULES } from '../generated/gameConfig.js';

export interface FarmCropRule {
  growthMonths: number;
  dailyWorkPoints: number;
  harvestWorkPointsPerUnit: number;
  baseYield: number;
  plantingEfficiencyByQuarter: readonly [number, number, number, number];
}

export const FARM_CROP_RULES = GENERATED_FARM_CROP_RULES satisfies Record<string, FarmCropRule>;

export type FarmCropType = keyof typeof FARM_CROP_RULES;
export const FARM_CROP_TYPES = Object.keys(FARM_CROP_RULES) as FarmCropType[];
export const AUTOMATABLE_FARM_TYPES = FARM_CROP_TYPES;
const automatableFarmTypeSet: ReadonlySet<string> = new Set(AUTOMATABLE_FARM_TYPES);

export const FARM_DAILY_WORK_POINTS = FARM_CROP_RULES.farm_rice.dailyWorkPoints;
export const GROWTH_MONTHS = FARM_CROP_RULES.farm_rice.growthMonths;
export const HARVEST_WORK_POINTS_PER_UNIT = FARM_CROP_RULES.farm_rice.harvestWorkPointsPerUnit;
export const BASE_YIELD = FARM_CROP_RULES.farm_rice.baseYield;

export type CropPhase = 'growing' | 'harvesting';

export interface FarmAutomationSettings {
  enabled: boolean;
  plantingMonths: number[];
  plantingWorkers: number;
  harvestWorkers: number;
}

export function parseFarmAutomationSettings(
  value: unknown,
  maxWorkers: number,
): FarmAutomationSettings | null {
  if (typeof value !== 'object' || value === null || !Number.isInteger(maxWorkers) || maxWorkers < 0) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { enabled, plantingMonths, plantingWorkers, harvestWorkers } = record;
  if (
    typeof enabled !== 'boolean' ||
    !Array.isArray(plantingMonths) ||
    plantingMonths.some(
      (month) => typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12,
    ) ||
    new Set(plantingMonths).size !== plantingMonths.length ||
    (enabled && plantingMonths.length === 0) ||
    typeof plantingWorkers !== 'number' ||
    !Number.isInteger(plantingWorkers) ||
    plantingWorkers < 0 ||
    plantingWorkers > maxWorkers ||
    typeof harvestWorkers !== 'number' ||
    !Number.isInteger(harvestWorkers) ||
    harvestWorkers < 0 ||
    harvestWorkers > maxWorkers
  ) {
    return null;
  }
  return {
    enabled,
    plantingMonths: [...plantingMonths].sort((a, b) => a - b),
    plantingWorkers,
    harvestWorkers,
  };
}

export function shouldStartAutomatedCrop(
  settings: FarmAutomationSettings,
  phase: CropPhase | null,
  month: number,
): boolean {
  return (
    settings.enabled &&
    phase === null &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    settings.plantingMonths.includes(month)
  );
}

export function isFarmCropType(value: string): value is FarmCropType {
  return Object.prototype.hasOwnProperty.call(FARM_CROP_RULES, value);
}

export function isAutomatableFarmType(
  value: string,
): value is (typeof AUTOMATABLE_FARM_TYPES)[number] {
  return automatableFarmTypeSet.has(value);
}

export interface Crop {
  phase: CropPhase;
  // Dia do jogo (AAAA-MM-DD) em que foi plantado.
  plantedDay: string;
  // Soma diária de min(1, Work Points / 1000) durante o crescimento e quantos dias foram somados.
  ratioSum: number;
  days: number;
  // Total a colher (definido ao fim do crescimento) e quanto já foi colhido.
  yieldUnits: number;
  harvested: number;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isGameDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export function getPlantingFactor(
  month: number,
  efficiencies: FarmCropRule['plantingEfficiencyByQuarter'] =
    FARM_CROP_RULES.farm_rice.plantingEfficiencyByQuarter,
): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('O mês de plantio precisa estar entre 1 e 12.');
  }
  return efficiencies[Math.floor((month - 1) / 3)];
}

export function getMonthOfDay(day: string): number {
  return Number(day.slice(5, 7));
}

// Dia da colheita: 6 meses de calendário depois, limitado ao último dia do mês.
export function getHarvestDay(plantedDay: string, months: number = GROWTH_MONTHS): string {
  const year = Number(plantedDay.slice(0, 4));
  const month = Number(plantedDay.slice(5, 7)) - 1 + months;
  const day = Number(plantedDay.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function getDailyWorkRatio(
  workPoints: number,
  requiredDailyWorkPoints: number = FARM_DAILY_WORK_POINTS,
): number {
  return Math.max(0, Math.min(1, workPoints / requiredDailyWorkPoints));
}

export function getHarvestYield(
  plantedDay: string,
  ratioSum: number,
  days: number,
  rule: FarmCropRule = FARM_CROP_RULES.farm_rice,
): number {
  const ratio = days > 0 ? ratioSum / days : 0;
  return Math.floor(
    rule.baseYield *
      getPlantingFactor(getMonthOfDay(plantedDay), rule.plantingEfficiencyByQuarter) *
      ratio +
      1e-9,
  );
}

// Avança um dia de crescimento; ao chegar ao dia da colheita calcula a produção total.
export function advanceGrowth(
  crop: Crop,
  today: string,
  workPoints: number,
  rule: FarmCropRule = FARM_CROP_RULES.farm_rice,
): Crop {
  if (crop.phase !== 'growing') return crop;
  const next = {
    ...crop,
    ratioSum: crop.ratioSum + getDailyWorkRatio(workPoints, rule.dailyWorkPoints),
    days: crop.days + 1,
  };
  if (today < getHarvestDay(crop.plantedDay, rule.growthMonths)) return next;
  return {
    ...next,
    phase: 'harvesting',
    yieldUnits: getHarvestYield(crop.plantedDay, next.ratioSum, next.days, rule),
    harvested: 0,
  };
}

// Colheita diária limitada pelos Work Points e pelo espaço livre no estoque.
export function planHarvest(
  crop: Crop,
  workPoints: number,
  freeStock: number,
  rule: FarmCropRule = FARM_CROP_RULES.farm_rice,
): { units: number; done: boolean } {
  const remaining = Math.max(0, crop.yieldUnits - crop.harvested);
  const units = Math.max(
    0,
    Math.min(
      remaining,
      Math.floor(workPoints / rule.harvestWorkPointsPerUnit + 1e-9),
      freeStock,
    ),
  );
  return { units, done: crop.harvested + units >= crop.yieldUnits };
}
