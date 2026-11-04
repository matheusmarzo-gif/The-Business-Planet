import type { ResidenceType } from './residence.js';
import { getResidenceDefinition, isWithinWorkerSearchRadius } from './residence.js';

export interface EmploymentResidence {
  id: string;
  type: ResidenceType;
  x: number;
  y: number;
  occupants: number;
}

export interface EmploymentWorkplace {
  id: string;
  type: ResidenceType;
  x: number;
  y: number;
  wage: number;
  workHoursPerDay: number;
  desiredWorkers: number;
}

export interface JobAssignment {
  workplaceId: string;
  residenceId: string;
  count: number;
}

// Fator de carga horária: 1 em 8 h, caindo até 0,5 nos extremos de 4 h e 14 h.
export function getHoursFactor(hours: number): number {
  const deviation = (hours - 8) / 6;
  return 1 - 0.5 * deviation * deviation;
}

// Fator de descanso: 1,2 com 4 h, 1 com 8 h e 0,8 com 14 h (linear entre os pontos).
export function getRestFactor(hours: number): number {
  return hours <= 8 ? 1.2 - (0.2 * (hours - 4)) / 4 : 1 - (0.2 * (hours - 8)) / 6;
}

export const WORK_POINTS_RATE = 12.5;

// Work Points diários de um funcionário (saúde e felicidade em 0–100).
export function getDailyWorkPoints(hours: number, health: number, happiness: number): number {
  return WORK_POINTS_RATE * hours * (health / 100) * (happiness / 100) * getRestFactor(hours);
}

export function getWorkBenefit(openJobs: number, wage: number, hours: number): number {
  const factor = getHoursFactor(hours);
  return (openJobs * factor * factor * wage) / hours;
}

export function getMaxDesiredWorkers(type: string): number {
  return getResidenceDefinition(type)?.maxWorkers ?? 0;
}

/**
 * Distribui os moradores empregáveis, residência a residência (ordem por id),
 * começando pela construção de maior benefício dentro do raio de busca. As
 * vagas ofertadas e o benefício são atualizados a cada preenchimento.
 */
export function allocateWorkers(
  residences: EmploymentResidence[],
  workplaces: EmploymentWorkplace[],
): JobAssignment[] {
  const openJobs = new Map<string, number>();
  for (const workplace of workplaces) {
    const jobs = Math.min(workplace.desiredWorkers, getMaxDesiredWorkers(workplace.type));
    if (jobs > 0) openJobs.set(workplace.id, jobs);
  }

  const assignments: JobAssignment[] = [];
  const sortedResidences = [...residences].sort((a, b) => a.id.localeCompare(b.id));
  for (const residence of sortedResidences) {
    let unemployed = residence.occupants;
    while (unemployed > 0) {
      let best: EmploymentWorkplace | null = null;
      let bestBenefit = -Infinity;
      for (const workplace of workplaces) {
        const jobs = openJobs.get(workplace.id) ?? 0;
        if (jobs <= 0 || !isWithinWorkerSearchRadius(workplace, residence)) continue;
        const benefit = getWorkBenefit(jobs, workplace.wage, workplace.workHoursPerDay);
        if (
          benefit > bestBenefit ||
          (benefit === bestBenefit && best !== null && workplace.id < best.id)
        ) {
          best = workplace;
          bestBenefit = benefit;
        }
      }
      if (!best) break;
      const jobs = openJobs.get(best.id) ?? 0;
      const hired = Math.min(unemployed, jobs);
      openJobs.set(best.id, jobs - hired);
      unemployed -= hired;
      assignments.push({ workplaceId: best.id, residenceId: residence.id, count: hired });
    }
  }
  return assignments;
}

export function getPayroll(
  workplaces: { id: string; ownerId: string; wage: number }[],
  assignments: JobAssignment[],
): Map<string, number> {
  const employed = new Map<string, number>();
  for (const { workplaceId, count } of assignments) {
    employed.set(workplaceId, (employed.get(workplaceId) ?? 0) + count);
  }
  const owed = new Map<string, number>();
  for (const workplace of workplaces) {
    const total = (employed.get(workplace.id) ?? 0) * workplace.wage;
    if (total > 0) owed.set(workplace.ownerId, (owed.get(workplace.ownerId) ?? 0) + total);
  }
  return owed;
}
