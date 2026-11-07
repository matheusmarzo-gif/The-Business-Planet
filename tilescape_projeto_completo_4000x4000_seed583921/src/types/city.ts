export const MUNICIPAL_AREA_SIZE = 303;
export const MUNICIPAL_AREA_RADIUS = Math.floor(MUNICIPAL_AREA_SIZE / 2);
export const ASSEMBLY_SIZE = 3;
export const MAX_CITY_ZONES = 100;

export type CityPlacementError =
  | 'map_bounds'
  | 'water'
  | 'building_overlap'
  | 'municipal_area_overlap';

export type CityZoneType = 'urban' | 'rural';

export type ConstructionCategory =
  | 'artesanais'
  | 'comerciais'
  | 'fazendas'
  | 'residencias'
  | 'recursos'
  | 'industrias'
  | 'prefeitura';

export interface CityZoneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CityZone extends CityZoneBounds {
  id: string;
  cityId: string;
  type: CityZoneType;
}

export type CityZonePlacementError = 'invalid_zone' | 'zone_outside_municipality' | 'zone_overlap';

export interface CityAssembly {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  population: number;
  wellbeing: number;
  economy: number;
  employed?: number;
  jobOffers?: number;
  averageWage?: number;
  zones: CityZone[];
}

export function getCityZonePlacementError(
  bounds: CityZoneBounds,
  type: CityZoneType,
  city: Pick<CityAssembly, 'centerX' | 'centerY'>,
  existingZones: CityZone[],
): CityZonePlacementError | null {
  if (
    !Number.isInteger(bounds.minX) ||
    !Number.isInteger(bounds.minY) ||
    !Number.isInteger(bounds.maxX) ||
    !Number.isInteger(bounds.maxY) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    return 'invalid_zone';
  }

  const municipalityMinX = city.centerX - MUNICIPAL_AREA_RADIUS;
  const municipalityMinY = city.centerY - MUNICIPAL_AREA_RADIUS;
  const municipalityMaxX = city.centerX + MUNICIPAL_AREA_RADIUS;
  const municipalityMaxY = city.centerY + MUNICIPAL_AREA_RADIUS;
  if (
    bounds.minX < municipalityMinX ||
    bounds.minY < municipalityMinY ||
    bounds.maxX > municipalityMaxX ||
    bounds.maxY > municipalityMaxY
  ) {
    return 'zone_outside_municipality';
  }

  if (
    existingZones.some(
      (zone) =>
        zone.type !== type &&
        bounds.minX <= zone.maxX &&
        bounds.maxX >= zone.minX &&
        bounds.minY <= zone.maxY &&
        bounds.maxY >= zone.minY,
    )
  ) {
    return 'zone_overlap';
  }

  return null;
}

export function getRequiredCityZone(
  category: ConstructionCategory,
): CityZoneType | null {
  switch (category) {
    case 'artesanais':
    case 'comerciais':
    case 'residencias':
      return 'urban';
    case 'fazendas':
    case 'recursos':
    case 'industrias':
      return 'rural';
    default:
      return null;
  }
}

export function isFootprintInCityZone(
  footprint: CityZoneBounds[],
  zones: CityZone[],
  requiredType: CityZoneType,
): boolean {
  if (footprint.length === 0) return false;
  const matchingZones = zones.filter((zone) => zone.type === requiredType);

  for (const area of footprint) {
    if (
      !Number.isInteger(area.minX) ||
      !Number.isInteger(area.minY) ||
      !Number.isInteger(area.maxX) ||
      !Number.isInteger(area.maxY) ||
      area.minX > area.maxX ||
      area.minY > area.maxY
    ) {
      return false;
    }

    for (let y = area.minY; y <= area.maxY; y += 1) {
      for (let x = area.minX; x <= area.maxX; x += 1) {
        if (
          !matchingZones.some(
            (zone) => x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY,
          )
        ) {
          return false;
        }
      }
    }
  }

  return true;
}

export function getCityPlacementError(
  center: { x: number; y: number },
  cities: Pick<CityAssembly, 'centerX' | 'centerY'>[],
  isLandAt: (x: number, y: number) => boolean,
  map: { width: number; height: number },
  occupiedTiles: { x: number; y: number }[] = [],
): CityPlacementError | null {
  if (
    center.x < MUNICIPAL_AREA_RADIUS ||
    center.y < MUNICIPAL_AREA_RADIUS ||
    center.x >= map.width - MUNICIPAL_AREA_RADIUS ||
    center.y >= map.height - MUNICIPAL_AREA_RADIUS
  ) {
    return 'map_bounds';
  }

  const buildingOffset = Math.floor(ASSEMBLY_SIZE / 2);
  for (let y = center.y - buildingOffset; y <= center.y + buildingOffset; y += 1) {
    for (let x = center.x - buildingOffset; x <= center.x + buildingOffset; x += 1) {
      if (!isLandAt(x, y)) return 'water';
      if (occupiedTiles.some((tile) => tile.x === x && tile.y === y)) {
        return 'building_overlap';
      }
    }
  }

  if (
    cities.some(
      (city) =>
        Math.abs(city.centerX - center.x) < ASSEMBLY_SIZE &&
        Math.abs(city.centerY - center.y) < ASSEMBLY_SIZE,
    )
  ) {
    return 'building_overlap';
  }

  if (
    cities.some(
      (city) =>
        Math.abs(city.centerX - center.x) < MUNICIPAL_AREA_SIZE &&
        Math.abs(city.centerY - center.y) < MUNICIPAL_AREA_SIZE,
    )
  ) {
    return 'municipal_area_overlap';
  }

  return null;
}

export function municipalAreasOverlap(
  first: Pick<CityAssembly, 'centerX' | 'centerY'>,
  second: Pick<CityAssembly, 'centerX' | 'centerY'>,
): boolean {
  return (
    Math.abs(first.centerX - second.centerX) < MUNICIPAL_AREA_SIZE &&
    Math.abs(first.centerY - second.centerY) < MUNICIPAL_AREA_SIZE
  );
}
