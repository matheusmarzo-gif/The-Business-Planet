import { allocateImmigrants } from './immigration.js';
import { RESIDENCES, type ResidenceType } from './residence.js';

export const CITY_NEIGHBOR_DISTANCE = 850;
export const CITY_UNEMPLOYMENT_THRESHOLD = 0.1;

export interface PopulationCity {
  id: string;
  centerX: number;
  centerY: number;
  employed: number;
  jobOffers: number;
}

export interface PopulationResidence {
  id: string;
  cityId: string;
  type: ResidenceType;
  status: 'under_construction' | 'completed';
  occupants: number;
  wellbeing: number;
  rent: number;
}

export interface PopulationMigration {
  sourceCityId: string;
  destinationCityId: string;
  quantity: number;
}

export interface PopulationChangePlan {
  occupantsByResidence: Map<string, number>;
  migrations: PopulationMigration[];
}

export function getPopulationGrowthRate(wellbeing: number): number {
  if (!Number.isFinite(wellbeing) || wellbeing < 0) {
    throw new RangeError('O bem-estar usado para calcular o crescimento populacional é inválido.');
  }
  if (wellbeing < 50) return 0;
  if (wellbeing < 100) return 0.003;
  if (wellbeing < 125) return 0.015;
  if (wellbeing < 150) return 0.03;
  if (wellbeing <= 162) return 0.015;
  return 0.003;
}

export function getUnemploymentRate(population: number, employed: number): number {
  if (
    !Number.isSafeInteger(population) ||
    population < 0 ||
    !Number.isSafeInteger(employed) ||
    employed < 0
  ) {
    throw new RangeError('Os valores usados para calcular o desemprego são inválidos.');
  }
  return population === 0 ? 0 : Math.max(0, population - employed) / population;
}

export function isCityNeighbor(
  first: Pick<PopulationCity, 'centerX' | 'centerY'>,
  second: Pick<PopulationCity, 'centerX' | 'centerY'>,
): boolean {
  return (
    Math.hypot(first.centerX - second.centerX, first.centerY - second.centerY) <
    CITY_NEIGHBOR_DISTANCE
  );
}

export function roundPopulationChange(
  population: number,
  rate: number,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(population) || population < 0) {
    throw new RangeError('A população usada para arredondamento é inválida.');
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError('A taxa usada para arredondamento é inválida.');
  }

  const expectedChange = population * rate;
  const wholeChange = Math.floor(expectedChange);
  const fraction = expectedChange - wholeChange;
  if (fraction === 0) return wholeChange;

  const chance = random();
  if (!Number.isFinite(chance) || chance < 0 || chance >= 1) {
    throw new RangeError('O gerador aleatório deve retornar um valor entre 0 e 1.');
  }
  return wholeChange + (chance < fraction ? 1 : 0);
}

function isResidentialHome(residence: PopulationResidence): boolean {
  return (
    residence.status === 'completed' &&
    RESIDENCES[residence.type].kind === 'residence'
  );
}

function getFreeCapacity(residences: readonly PopulationResidence[]): number {
  return residences.reduce(
    (total, residence) =>
      total + Math.max(0, RESIDENCES[residence.type].capacity - residence.occupants),
    0,
  );
}

export function planMonthlyPopulationChange(
  cities: readonly PopulationCity[],
  residences: readonly PopulationResidence[],
  random: () => number = Math.random,
): PopulationChangePlan {
  const citiesById = new Map(cities.map((city) => [city.id, city]));
  const homesByCity = new Map<string, PopulationResidence[]>();
  const originalOccupants = new Map<string, number>();
  const occupantsByResidence = new Map<string, number>();

  for (const residence of residences) {
    if (!isResidentialHome(residence) || !citiesById.has(residence.cityId)) continue;
    const homes = homesByCity.get(residence.cityId) ?? [];
    homes.push(residence);
    homesByCity.set(residence.cityId, homes);
    originalOccupants.set(residence.id, residence.occupants);
    occupantsByResidence.set(residence.id, residence.occupants);
  }
  for (const homes of homesByCity.values()) {
    homes.sort((first, second) => first.id.localeCompare(second.id));
  }

  const populationByCity = new Map(
    cities.map((city) => [
      city.id,
      (homesByCity.get(city.id) ?? []).reduce((total, home) => total + home.occupants, 0),
    ]),
  );
  const decliningCityIds = new Set(
    cities
      .filter(
        (city) =>
          getUnemploymentRate(populationByCity.get(city.id) ?? 0, city.employed) >
          CITY_UNEMPLOYMENT_THRESHOLD,
      )
      .map((city) => city.id),
  );

  const migrations: PopulationMigration[] = [];
  for (const sourceCity of [...cities].sort((first, second) => first.id.localeCompare(second.id))) {
    if (!decliningCityIds.has(sourceCity.id)) continue;

    const sourceHomes = homesByCity.get(sourceCity.id) ?? [];
    const destinations = cities
      .filter(
        (city) =>
          city.id !== sourceCity.id &&
          !decliningCityIds.has(city.id) &&
          isCityNeighbor(sourceCity, city) &&
          getFreeCapacity(homesByCity.get(city.id) ?? []) > 0,
      )
      .sort((first, second) => first.id.localeCompare(second.id));
    const destination =
      destinations.length > 0
        ? destinations[Math.floor(random() * destinations.length)]
        : undefined;
    if (destinations.length > 0 && !destination) {
      throw new RangeError('O gerador aleatório retornou um destino de cidade inválido.');
    }

    let emigrants = 0;
    for (const home of sourceHomes) {
      const rate = home.wellbeing <= 50 ? 0.02 : home.wellbeing > 100 ? 0.01 : 0;
      if (rate === 0) continue;
      const departure = Math.min(
        home.occupants,
        roundPopulationChange(home.occupants, rate, random),
      );
      if (departure === 0) continue;
      home.occupants -= departure;
      occupantsByResidence.set(home.id, home.occupants);
      populationByCity.set(
        sourceCity.id,
        (populationByCity.get(sourceCity.id) ?? 0) - departure,
      );
      if (home.wellbeing > 100) emigrants += departure;
    }

    if (destination && emigrants > 0) {
      const destinationHomes = homesByCity.get(destination.id) ?? [];
      const immigrationCandidates = destinationHomes.map((home) => ({
        id: home.id,
        type: home.type,
        status: home.status,
        rent: home.rent,
        occupants: home.occupants,
      }));
      const additions = allocateImmigrants(immigrationCandidates, emigrants);
      let accepted = 0;
      for (const home of destinationHomes) {
        const added = additions.get(home.id) ?? 0;
        if (added === 0) continue;
        home.occupants += added;
        occupantsByResidence.set(home.id, home.occupants);
        populationByCity.set(
          destination.id,
          (populationByCity.get(destination.id) ?? 0) + added,
        );
        accepted += added;
      }
      if (accepted > 0) {
        migrations.push({
          sourceCityId: sourceCity.id,
          destinationCityId: destination.id,
          quantity: accepted,
        });
      }
    }
  }

  for (const city of [...cities].sort((first, second) => first.id.localeCompare(second.id))) {
    if (
      decliningCityIds.has(city.id) ||
      city.jobOffers <= 0 ||
      !Number.isSafeInteger(city.jobOffers)
    ) {
      continue;
    }
    const cityHomes = homesByCity.get(city.id) ?? [];
    for (const home of cityHomes) {
      if (
        getUnemploymentRate(populationByCity.get(city.id) ?? 0, city.employed) >
        CITY_UNEMPLOYMENT_THRESHOLD
      ) {
        break;
      }
      const rate = getPopulationGrowthRate(home.wellbeing);
      if (rate === 0) continue;
      const freeCapacity = RESIDENCES[home.type].capacity - home.occupants;
      if (freeCapacity <= 0) continue;
      const increase = Math.min(
        freeCapacity,
        roundPopulationChange(home.occupants, rate, random),
      );
      if (increase === 0) continue;
      home.occupants += increase;
      occupantsByResidence.set(home.id, home.occupants);
      populationByCity.set(city.id, (populationByCity.get(city.id) ?? 0) + increase);
    }
  }

  for (const [residenceId, occupants] of occupantsByResidence) {
    if (occupants === originalOccupants.get(residenceId)) {
      occupantsByResidence.delete(residenceId);
    }
  }
  return { occupantsByResidence, migrations };
}
