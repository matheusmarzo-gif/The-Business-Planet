import { RESIDENCES, type ResidentialBuilding } from './residence.js';

export const IMMIGRANTS_PER_DAY = 40;
export const IMMIGRATION_POPULATION_LIMIT = 1000;

type ImmigrationCandidate = Pick<ResidentialBuilding, 'id' | 'type' | 'status' | 'rent' | 'occupants'>;

export function getCityPopulation(buildings: Pick<ResidentialBuilding, 'occupants'>[]): number {
  return buildings.reduce((total, building) => total + building.occupants, 0);
}

// Imigrantes ocupam primeiro as casas mais baratas; empate vai para o maior apreço local.
export function allocateImmigrants(
  buildings: ImmigrationCandidate[],
  arrivals: number = IMMIGRANTS_PER_DAY,
): Map<string, number> {
  const additions = new Map<string, number>();
  const candidates = buildings
    .filter((building) => building.status === 'completed')
    .sort(
      (a, b) =>
        a.rent - b.rent ||
        RESIDENCES[b.type].localAppeal - RESIDENCES[a.type].localAppeal ||
        a.id.localeCompare(b.id),
    );

  let remaining = arrivals;
  for (const building of candidates) {
    if (remaining <= 0) break;
    const free = RESIDENCES[building.type].capacity - building.occupants;
    if (free <= 0) continue;
    const moving = Math.min(free, remaining);
    additions.set(building.id, moving);
    remaining -= moving;
  }
  return additions;
}
