// Produção da fazenda de arroz: plantio, crescimento de 6 meses e colheita.
export const FARM_DAILY_WORK_POINTS = 1000;
export const GROWTH_MONTHS = 6;
export const HARVEST_WORK_POINTS_PER_UNIT = 200;
export const BASE_YIELD = 100;

export type CropPhase = 'growing' | 'harvesting';

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

// Meses 1-3: 100%; 4-6: 60%; 7-9: 40%; 10-12: 20%.
export function getPlantingFactor(month: number): number {
  if (month <= 3) return 1;
  if (month <= 6) return 0.6;
  if (month <= 9) return 0.4;
  return 0.2;
}

export function getMonthOfDay(day: string): number {
  return Number(day.slice(5, 7));
}

// Dia da colheita: 6 meses de calendário depois, limitado ao último dia do mês.
export function getHarvestDay(plantedDay: string, months = GROWTH_MONTHS): string {
  const year = Number(plantedDay.slice(0, 4));
  const month = Number(plantedDay.slice(5, 7)) - 1 + months;
  const day = Number(plantedDay.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function getDailyWorkRatio(workPoints: number): number {
  return Math.max(0, Math.min(1, workPoints / FARM_DAILY_WORK_POINTS));
}

export function getHarvestYield(plantedDay: string, ratioSum: number, days: number): number {
  const ratio = days > 0 ? ratioSum / days : 0;
  return Math.floor(BASE_YIELD * getPlantingFactor(getMonthOfDay(plantedDay)) * ratio + 1e-9);
}

// Avança um dia de crescimento; ao chegar ao dia da colheita calcula a produção total.
export function advanceGrowth(crop: Crop, today: string, workPoints: number): Crop {
  if (crop.phase !== 'growing') return crop;
  const next = {
    ...crop,
    ratioSum: crop.ratioSum + getDailyWorkRatio(workPoints),
    days: crop.days + 1,
  };
  if (today < getHarvestDay(crop.plantedDay)) return next;
  return {
    ...next,
    phase: 'harvesting',
    yieldUnits: getHarvestYield(crop.plantedDay, next.ratioSum, next.days),
    harvested: 0,
  };
}

// Colheita diária: 200 Work Points por unidade, limitada ao espaço livre no estoque.
export function planHarvest(
  crop: Crop,
  workPoints: number,
  freeStock: number,
): { units: number; done: boolean } {
  const remaining = Math.max(0, crop.yieldUnits - crop.harvested);
  const units = Math.max(
    0,
    Math.min(remaining, Math.floor(workPoints / HARVEST_WORK_POINTS_PER_UNIT + 1e-9), freeStock),
  );
  return { units, done: crop.harvested + units >= crop.yieldUnits };
}
