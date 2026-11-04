export const MUNICIPAL_AREA_SIZE = 303;
export const MUNICIPAL_AREA_RADIUS = Math.floor(MUNICIPAL_AREA_SIZE / 2);
export const ASSEMBLY_SIZE = 3;

export type CityPlacementError =
  | 'map_bounds'
  | 'water'
  | 'building_overlap'
  | 'municipal_area_overlap';

export interface CityAssembly {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  population: number;
  wellbeing: number;
  economy: number;
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
