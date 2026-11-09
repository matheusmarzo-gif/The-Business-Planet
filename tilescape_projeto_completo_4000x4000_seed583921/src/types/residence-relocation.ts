import { getResidenceDefinition, type ResidenceType } from './residence.js';

export interface ResidenceRelocationCandidate {
  id: string;
  cityId: string;
  type: ResidenceType;
  rent: number;
  occupants: number;
  capacity: number;
  monthlyCost: number;
  dailyIncome: number;
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
}

export function calculateResidenceBenefit(input: {
  rent: number;
  monthlyCost: number;
  dailyIncome: number;
  localAppeal: number;
}): ResidenceBenefitCalculation {
  const { rent, monthlyCost, dailyIncome, localAppeal } = input;
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0 || !Number.isFinite(dailyIncome)) {
    return { monthlyCost, errorBenefit: 0, idealBenefit: 0, associatedBenefit: 0 };
  }

  const weight = (1 - rent / monthlyCost) ** 4;
  const adjustment = (0.8 ** weight - 1) * Math.max(0, dailyIncome);
  const errorBase = Math.max(0, (dailyIncome - rent - adjustment) / monthlyCost);
  const idealBase = Math.max(0, (dailyIncome - 0.5) / monthlyCost);
  const errorBenefit = Math.max(0, localAppeal / 50) * errorBase ** 1.25;
  const idealBenefit = idealBase ** 1.25;
  const associatedBenefit =
    idealBenefit <= 0 || errorBenefit <= 0 ? 0 : (errorBenefit / idealBenefit) ** 1.2;
  return { monthlyCost, errorBenefit, idealBenefit, associatedBenefit };
}

export function getAssociatedResidenceBenefit(input: {
  rent: number;
  monthlyCost: number;
  dailyIncome: number;
  localAppeal: number;
}): number {
  return calculateResidenceBenefit(input).associatedBenefit;
}

export function planResidenceRelocations(
  residences: ResidenceRelocationCandidate[],
): ResidenceRelocation[] {
  const currentOccupants = new Map(residences.map((residence) => [residence.id, residence.occupants]));
  const relocations: ResidenceRelocation[] = [];
  const ordered = [...residences].sort((a, b) => a.id.localeCompare(b.id));

  for (const source of ordered) {
    let sourceOccupants = currentOccupants.get(source.id) ?? 0;
    if (sourceOccupants <= 0) continue;

    const associatedSource = getAssociatedResidenceBenefit({
      rent: source.rent,
      monthlyCost: source.monthlyCost,
      dailyIncome: source.dailyIncome,
      localAppeal: getResidenceDefinition(source.type)?.localAppeal ?? 0,
    });
    for (const destination of ordered) {
      if (destination.id === source.id || destination.cityId !== source.cityId || sourceOccupants <= 0) {
        continue;
      }
      const destinationOccupants = currentOccupants.get(destination.id) ?? 0;
      const free = Math.max(0, destination.capacity - destinationOccupants);
      if (free <= 0) continue;
      const associatedDestination = getAssociatedResidenceBenefit({
        rent: destination.rent,
        monthlyCost: source.monthlyCost,
        dailyIncome: source.dailyIncome,
        localAppeal: getResidenceDefinition(destination.type)?.localAppeal ?? 0,
      });
      if (associatedDestination <= associatedSource) continue;

      const ratio = associatedSource > 0
        ? associatedDestination / associatedSource
        : Number.POSITIVE_INFINITY;
      const quantity = Math.min(
        sourceOccupants,
        free,
        Number.isFinite(ratio) ? Math.floor(sourceOccupants * (ratio - 1)) : sourceOccupants,
      );
      if (quantity <= 0) continue;
      sourceOccupants -= quantity;
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
