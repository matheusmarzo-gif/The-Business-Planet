import { BUILDING_CONFIGS } from '../generated/gameConfig.js';

const DAIRY_EFFICIENCY_BY_QUARTER = BUILDING_CONFIGS.farm_dairy.dairyEfficiencyByQuarter;

export function getDairyFarmEfficiency(month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('O mês da produção leiteira precisa estar entre 1 e 12.');
  }
  return DAIRY_EFFICIENCY_BY_QUARTER[Math.floor((month - 1) / 3)];
}
