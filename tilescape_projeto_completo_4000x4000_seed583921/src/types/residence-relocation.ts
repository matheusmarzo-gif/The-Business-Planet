import {
  RESIDENCES,
  type ResidenceType,
  WORKER_SEARCH_RADIUS,
} from './residence.js';

export const RESIDENCE_APPEAL_RADIUS = 10;

export interface ResidenceAppealCandidate {
  id: string;
  cityId: string;
  type: ResidenceType;
  x: number;
  y: number;
  occupants: number;
  employed: number;
  capacity: number;
  salaryAverage: number;
  cityAverageSalary: number;
  constructionAppeal: number;
}

export interface ResidenceEmploymentOffer {
  cityId: string;
  type: ResidenceType;
  x: number;
  y: number;
  wage: number;
  vacancies: number;
}

export type ResidenceIncomeAppealCandidate =
  Omit<ResidenceAppealCandidate, 'cityAverageSalary'>;

export interface ResidenceAppealValues {
  employabilityAppeal: number;
  regionalAppeal: number;
  constructionAppeal: number;
  internalAppeal: number;
}

export function calculateResidenceAppealsFromIncome(
  residences: ResidenceIncomeAppealCandidate[],
  employmentOffers: readonly ResidenceEmploymentOffer[] = [],
): Map<string, ResidenceAppealValues> {
  const cityTotals = new Map<string, { payroll: number; employees: number }>();
  for (const residence of residences) {
    const totals = cityTotals.get(residence.cityId) ?? { payroll: 0, employees: 0 };
    const employed = Math.max(0, residence.employed);
    totals.payroll += Math.max(0, residence.salaryAverage) * employed;
    totals.employees += employed;
    cityTotals.set(residence.cityId, totals);
  }
  return calculateResidenceAppeals(
    residences.map((residence) => {
      const totals = cityTotals.get(residence.cityId);
      return {
        ...residence,
        cityAverageSalary: totals && totals.employees > 0
          ? totals.payroll / totals.employees
          : 0,
      };
    }),
    employmentOffers,
  );
}

export function calculateResidenceAppeals(
  residences: ResidenceAppealCandidate[],
  employmentOffers: readonly ResidenceEmploymentOffer[] = [],
): Map<string, ResidenceAppealValues> {
  const employabilityAppeals = new Map(
    residences.map((residence) => [
      residence.id,
      residence.cityAverageSalary > 0
        ? getResidenceEmployabilitySalary(residence, employmentOffers) /
          residence.cityAverageSalary
        : 0,
    ]),
  );
  const cells = new Map<string, ResidenceAppealCandidate[]>();
  const cellKey = (cityId: string, cellX: number, cellY: number) =>
    `${cityId}:${cellX}:${cellY}`;
  for (const residence of residences) {
    const key = cellKey(
      residence.cityId,
      Math.floor(residence.x / RESIDENCE_APPEAL_RADIUS),
      Math.floor(residence.y / RESIDENCE_APPEAL_RADIUS),
    );
    const cell = cells.get(key) ?? [];
    cell.push(residence);
    cells.set(key, cell);
  }
  return new Map(
    residences.map((residence) => {
      const cellX = Math.floor(residence.x / RESIDENCE_APPEAL_RADIUS);
      const cellY = Math.floor(residence.y / RESIDENCE_APPEAL_RADIUS);
      const nearbyAppeals: ResidenceAppealCandidate[] = [];
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const neighbor of cells.get(cellKey(residence.cityId, cellX + dx, cellY + dy)) ?? []) {
            const distanceX = neighbor.x - residence.x;
            const distanceY = neighbor.y - residence.y;
            if (distanceX ** 2 + distanceY ** 2 <= RESIDENCE_APPEAL_RADIUS ** 2) {
              nearbyAppeals.push(neighbor);
            }
          }
        }
      }
      const regionalAppeal = nearbyAppeals.reduce(
        (total, neighbor) => total + (employabilityAppeals.get(neighbor.id) ?? 0),
        0,
      ) / nearbyAppeals.length;
      const internalAppeal = Math.max(10, residence.constructionAppeal * regionalAppeal);
      return [
        residence.id,
        {
          employabilityAppeal: employabilityAppeals.get(residence.id) ?? 0,
          regionalAppeal,
          constructionAppeal: residence.constructionAppeal,
          internalAppeal,
        },
      ];
    }),
  );
}

function getResidenceEmployabilitySalary(
  residence: ResidenceAppealCandidate,
  employmentOffers: readonly ResidenceEmploymentOffer[],
): number {
  if (
    residence.occupants > 2 &&
    residence.employed * 2 >= residence.occupants
  ) {
    return residence.salaryAverage;
  }

  const residenceDefinition = RESIDENCES[residence.type];
  const residenceCenterX = residence.x + residenceDefinition.width / 2;
  const residenceCenterY = residence.y + residenceDefinition.height / 2;
  let vacancies = 0;
  let weightedVacancies = 0;
  let weightedWage = 0;
  for (const offer of employmentOffers) {
    const offerDefinition = RESIDENCES[offer.type];
    const distance = Math.hypot(
      offer.x + offerDefinition.width / 2 - residenceCenterX,
      offer.y + offerDefinition.height / 2 - residenceCenterY,
    );
    if (
      offer.cityId !== residence.cityId ||
      offer.vacancies <= 0 ||
      distance > WORKER_SEARCH_RADIUS
    ) {
      continue;
    }
    const distanceWeight = distance <= 10 ? 2 : distance <= 30 ? 1.5 : 1;
    const offerWeight = offer.vacancies * distanceWeight;
    vacancies += offer.vacancies;
    weightedVacancies += offerWeight;
    weightedWage += offer.wage * offerWeight;
  }

  return vacancies >= residence.capacity && vacancies > 0
    ? weightedWage / weightedVacancies
    : residence.salaryAverage;
}

export interface ResidenceRelocationCandidate {
  id: string;
  cityId: string;
  type: ResidenceType;
  rent: number;
  occupants: number;
  capacity: number;
  monthlyCost: number;
  dailyIncome: number;
  internalAppeal: number;
}

export interface ResidenceRelocation {
  sourceId: string;
  destinationId: string;
  quantity: number;
  associatedSource: number;
  associatedDestination: number;
}

export interface ResidenceBenefitCalculation {
  monthlyCost: number;
  errorBenefit: number;
  idealBenefit: number;
  associatedBenefit: number;
  employabilityAppeal: number;
  regionalAppeal: number;
  constructionAppeal: number;
  internalAppeal: number;
  productContributions: { productId: string; contribution: number }[];
}

export function getResidenceBenefitIncome(
  occupants: number,
  residenceAverageIncome: number,
  cityAverageIncome: number,
): number {
  return occupants > 0 ? residenceAverageIncome : cityAverageIncome;
}

export function calculateResidenceBenefit(input: {
  rent: number;
  monthlyCost: number;
  dailyIncome: number;
  employabilityAppeal: number;
  regionalAppeal: number;
  constructionAppeal: number;
}): ResidenceBenefitCalculation {
  const {
    rent,
    monthlyCost,
    dailyIncome,
    employabilityAppeal,
    regionalAppeal,
    constructionAppeal,
  } = input;
  const internalAppeal = Math.max(10, constructionAppeal * regionalAppeal);
  const appealValues = {
    employabilityAppeal,
    regionalAppeal,
    constructionAppeal,
    internalAppeal,
  };
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0 || !Number.isFinite(dailyIncome)) {
    return {
      monthlyCost,
      errorBenefit: 0,
      idealBenefit: 0,
      associatedBenefit: 0,
      ...appealValues,
      productContributions: [],
    };
  }

  const weight = (1 - rent / monthlyCost) ** 4;
  const adjustment = (0.8 ** weight - 1) * Math.max(0, dailyIncome);
  const errorBase = Math.max(0, (dailyIncome - rent - adjustment) / monthlyCost);
  const idealBase = Math.max(0, (dailyIncome - 0.5) / monthlyCost);
  const errorBenefit = Math.max(0, internalAppeal / 50) * errorBase ** 1.25;
  const idealBenefit = idealBase ** 1.25;
  const associatedBenefit =
    idealBenefit <= 0 || errorBenefit <= 0 ? 0 : (errorBenefit / idealBenefit) ** 1.2;
  return {
    monthlyCost,
    errorBenefit,
    idealBenefit,
    associatedBenefit,
    ...appealValues,
    productContributions: [],
  };
}

export function getAssociatedResidenceBenefit(input: {
  rent: number;
  monthlyCost: number;
  dailyIncome: number;
  internalAppeal: number;
}): number {
  return calculateResidenceBenefit({
    ...input,
    employabilityAppeal: 0,
    regionalAppeal: 1,
    constructionAppeal: input.internalAppeal,
  }).associatedBenefit;
}

function getRelocationRate(occupants: number): number {
  if (occupants > 100) return 0.3;
  if (occupants > 30) return 0.5;
  if (occupants > 15) return 0.75;
  return 1;
}

export function planResidenceRelocations(
  residences: ResidenceRelocationCandidate[],
  sourceResidenceId?: string,
): ResidenceRelocation[] {
  const currentOccupants = new Map(residences.map((residence) => [residence.id, residence.occupants]));
  const relocations: ResidenceRelocation[] = [];
  const ordered = [...residences].sort((a, b) => a.id.localeCompare(b.id));
  const sources = ordered.filter(
    (residence) => sourceResidenceId === undefined || residence.id === sourceResidenceId,
  );

  for (const source of sources) {
    let sourceOccupants = currentOccupants.get(source.id) ?? 0;
    if (sourceOccupants <= 0) continue;
    let remainingRelocatable = Math.floor(sourceOccupants * getRelocationRate(sourceOccupants));

    const associatedSource = getAssociatedResidenceBenefit({
      rent: source.rent,
      monthlyCost: source.monthlyCost,
      dailyIncome: source.dailyIncome,
      internalAppeal: source.internalAppeal,
    });
    for (const destination of ordered) {
      if (
        destination.id === source.id ||
        destination.cityId !== source.cityId ||
        sourceOccupants <= 0 ||
        remainingRelocatable <= 0
      ) {
        continue;
      }
      const destinationOccupants = currentOccupants.get(destination.id) ?? 0;
      const free = Math.max(0, destination.capacity - destinationOccupants);
      if (free <= 0) continue;
      const associatedDestination = getAssociatedResidenceBenefit({
        rent: destination.rent,
        monthlyCost: source.monthlyCost,
        dailyIncome: source.dailyIncome,
        internalAppeal: destination.internalAppeal,
      });
      if (associatedDestination <= associatedSource) continue;

      const ratio = associatedSource > 0
        ? associatedDestination / associatedSource
        : Number.POSITIVE_INFINITY;
      const quantity = Math.min(
        sourceOccupants,
        free,
        remainingRelocatable,
        Number.isFinite(ratio) ? Math.floor(sourceOccupants * (ratio - 1)) : sourceOccupants,
      );
      if (quantity <= 0) continue;
      sourceOccupants -= quantity;
      remainingRelocatable -= quantity;
      currentOccupants.set(source.id, sourceOccupants);
      currentOccupants.set(destination.id, destinationOccupants + quantity);
      relocations.push({
        sourceId: source.id,
        destinationId: destination.id,
        quantity,
        associatedSource,
        associatedDestination,
      });
    }
  }
  return relocations;
}
