import type { ResidenceType, ResidentialBuildingStatus } from './residence.js';
import {
  getResidenceDefinition,
  isWithinWorkerSearchRadius,
  MAX_CONSTRUCTION_WORKERS,
} from './residence.js';
import { roundCurrency } from './currency.js';
import { GAME_RULES } from '../generated/gameConfig.js';

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
  status?: ResidentialBuildingStatus;
}

export interface EmploymentSummaryWorkplace {
  type: ResidenceType;
  wage: number;
  desiredWorkers: number;
  status: 'under_construction' | 'completed';
  employed: number;
}

export interface EmploymentSummary {
  employed: number;
  jobOffers: number;
  averageWage: number;
}

export interface JobAssignment {
  workplaceId: string;
  residenceId: string;
  count: number;
}

export function getHoursFactor(hours: number): number {
  const { optimalHours, deviationScaleHours, penalty } = GAME_RULES.work.hoursFactor;
  const deviation = (hours - optimalHours) / deviationScaleHours;
  return 1 - penalty * deviation * deviation;
}

export function getRestFactor(hours: number): number {
  const {
    shortDayHours,
    standardDayHours,
    longDayHours,
    shortDayValue,
    standardDayValue,
    longDayValue,
  } = GAME_RULES.work.restFactor;
  return hours <= standardDayHours
    ? shortDayValue -
        ((shortDayValue - standardDayValue) * (hours - shortDayHours)) /
          (standardDayHours - shortDayHours)
    : standardDayValue -
        ((standardDayValue - longDayValue) * (hours - standardDayHours)) /
          (longDayHours - standardDayHours);
}

export const WORK_POINTS_RATE = GAME_RULES.work.workPointsPerHour;

// Work Points diários de um funcionário (saúde e felicidade em 0–100).
export function getDailyWorkPoints(hours: number, health: number, happiness: number): number {
  const { health: healthScale, happiness: happinessScale } = GAME_RULES.work.residentStats;
  return (
    WORK_POINTS_RATE *
    hours *
    (health / healthScale) *
    (happiness / happinessScale) *
    getRestFactor(hours)
  );
}

export function getWorkBenefit(
  openJobs: number,
  wage: number,
  hours: number,
  distance = 0,
): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError('A distância até o trabalho precisa ser não negativa.');
  }
  const factor = getHoursFactor(hours);
  const { radiusTiles, radicandNumerator } = GAME_RULES.work.distanceFactor;
  const distanceFactor = Math.sqrt(radicandNumerator / (radiusTiles + distance));
  const offerSizeMultiplier =
    openJobs <= 4 ? 5 :
    openJobs <= 10 ? 3 :
    openJobs <= 20 ? 2 :
    openJobs <= 40 ? 1 :
    openJobs <= 100 ? 0.9 :
    openJobs <= 300 ? 0.8 : 0.7;
  return (
    (openJobs * factor ** GAME_RULES.work.hoursFactor.benefitExponent * wage * distanceFactor) /
    hours *
    offerSizeMultiplier
  );
}

export function getMaxDesiredWorkers(
  type: string,
  status: ResidentialBuildingStatus = 'completed',
): number {
  if (status === 'under_construction') return MAX_CONSTRUCTION_WORKERS;
  return getResidenceDefinition(type)?.maxWorkers ?? 0;
}

export function getEmploymentSummary(workplaces: EmploymentSummaryWorkplace[]): EmploymentSummary {
  let employed = 0;
  let jobOffers = 0;
  let wageTotal = 0;

  for (const workplace of workplaces) {
    const definition = getResidenceDefinition(workplace.type);
    if (!definition) continue;
    if (definition.kind === 'residence' && workplace.status !== 'under_construction') continue;

    const workplaceEmployees = Math.max(0, workplace.employed);
    employed += workplaceEmployees;
    wageTotal += workplaceEmployees * workplace.wage;

    const desired = Math.min(
      workplace.desiredWorkers,
      getMaxDesiredWorkers(workplace.type, workplace.status),
    );
    jobOffers += Math.max(0, desired - workplaceEmployees);
  }

  return {
    employed,
    jobOffers,
    averageWage: employed > 0 ? wageTotal / employed : 0,
  };
}

/**
 * Distribui os moradores residência a residência (ordem por id), proporcionalmente
 * ao benefício de cada oferta elegível. Vagas remanescentes são atualizadas para
 * cada residência seguinte; a maior sobra distribui os arredondamentos inteiros.
 */
export function allocateWorkers(
  residences: EmploymentResidence[],
  workplaces: EmploymentWorkplace[],
): JobAssignment[] {
  const openJobs = new Map<string, number>();
  for (const workplace of workplaces) {
    const jobs = Math.min(
      workplace.desiredWorkers,
      getMaxDesiredWorkers(workplace.type, workplace.status),
    );
    if (jobs > 0) openJobs.set(workplace.id, jobs);
  }

  const assignments: JobAssignment[] = [];
  const sortedResidences = [...residences].sort((a, b) => a.id.localeCompare(b.id));
  for (const residence of sortedResidences) {
    const offers = workplaces.flatMap((workplace) => {
      const vacancies = openJobs.get(workplace.id) ?? 0;
      if (vacancies <= 0 || !isWithinWorkerSearchRadius(workplace, residence)) return [];
      const workplaceDefinition = getResidenceDefinition(workplace.type);
      const residenceDefinition = getResidenceDefinition(residence.type);
      if (!workplaceDefinition || !residenceDefinition) return [];
      const dx =
        workplace.x +
        workplaceDefinition.width / 2 -
        (residence.x + residenceDefinition.width / 2);
      const dy =
        workplace.y +
        workplaceDefinition.height / 2 -
        (residence.y + residenceDefinition.height / 2);
      return [{
        workplace,
        vacancies,
        benefit: getWorkBenefit(
          vacancies,
          workplace.wage,
          workplace.workHoursPerDay,
          Math.hypot(dx, dy),
        ),
      }];
    });
    const seats = Math.min(
      Math.max(0, Math.floor(residence.occupants)),
      offers.reduce((total, offer) => total + offer.vacancies, 0),
    );
    if (seats === 0 || offers.length === 0) continue;

    const allocated = new Map<string, number>();
    let remainingSeats = seats;
    let remainingOffers = offers;
    while (remainingSeats > 0 && remainingOffers.length > 0) {
      const benefitTotal = remainingOffers.reduce((total, offer) => total + offer.benefit, 0);
      const useEqualShares = benefitTotal === 0;
      const weightTotal = useEqualShares ? remainingOffers.length : benefitTotal;
      const overCapacity = remainingOffers.filter((offer) => {
        const weight = useEqualShares ? 1 : offer.benefit;
        return (remainingSeats * weight) / weightTotal > offer.vacancies;
      });

      if (overCapacity.length > 0) {
        const cappedIds = new Set(overCapacity.map(({ workplace }) => workplace.id));
        for (const offer of overCapacity) {
          allocated.set(offer.workplace.id, offer.vacancies);
          remainingSeats -= offer.vacancies;
        }
        remainingOffers = remainingOffers.filter(({ workplace }) => !cappedIds.has(workplace.id));
        continue;
      }

      const shares = remainingOffers.map((offer) => {
        const weight = useEqualShares ? 1 : offer.benefit;
        const exact = (remainingSeats * weight) / weightTotal;
        const whole = Math.floor(exact);
        return { ...offer, whole, remainder: exact - whole };
      });
      let unroundedSeats = remainingSeats - shares.reduce((total, share) => total + share.whole, 0);
      shares.sort(
        (a, b) =>
          b.remainder - a.remainder ||
          a.workplace.id.localeCompare(b.workplace.id),
      );
      for (const share of shares) {
        const count = share.whole + (unroundedSeats > 0 ? 1 : 0);
        if (unroundedSeats > 0) unroundedSeats -= 1;
        if (count > 0) allocated.set(share.workplace.id, count);
      }
      remainingSeats = 0;
    }

    for (const offer of offers) {
      const hired = allocated.get(offer.workplace.id) ?? 0;
      if (hired <= 0) continue;
      openJobs.set(offer.workplace.id, offer.vacancies - hired);
      assignments.push({
        workplaceId: offer.workplace.id,
        residenceId: residence.id,
        count: hired,
      });
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
    const total = roundCurrency((employed.get(workplace.id) ?? 0) * workplace.wage);
    if (total > 0) {
      owed.set(workplace.ownerId, roundCurrency((owed.get(workplace.ownerId) ?? 0) + total));
    }
  }
  return owed;
}

// Renda média por morador de cada residência, calculada após a alocação dos empregos.
export function getAverageIncomes(
  residences: { id: string; occupants: number }[],
  wages: Map<string, number>,
  assignments: JobAssignment[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { workplaceId, residenceId, count } of assignments) {
    totals.set(residenceId, (totals.get(residenceId) ?? 0) + count * (wages.get(workplaceId) ?? 0));
  }
  return new Map(
    residences.map((home) => [home.id, home.occupants > 0 ? (totals.get(home.id) ?? 0) / home.occupants : 0]),
  );
}

// Avança uma obra com o trabalho do dia; conclui quando os Work Points chegam ao necessário.
export function advanceConstruction(
  done: number,
  needed: number,
  workers: number,
  hours: number,
  health: number,
  happiness: number,
): { done: number; completed: boolean } {
  const total = done + workers * getDailyWorkPoints(hours, health, happiness);
  return { done: Math.min(total, needed), completed: total >= needed };
}
