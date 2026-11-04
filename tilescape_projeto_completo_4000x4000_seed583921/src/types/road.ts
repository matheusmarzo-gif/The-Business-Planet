import type { CityAssembly } from './city.js';
import { MUNICIPAL_AREA_RADIUS } from './city.js';

export const MAX_ROAD_PATH_TILES = 600;

export interface RoadTile {
  x: number;
  y: number;
  cityId: string;
}

export interface RoadPosition {
  x: number;
  y: number;
}

export type RoadPlacementError =
  | 'outside_municipality'
  | 'water'
  | 'building_overlap'
  | 'path_too_long';

export function getRoadPlacementError(
  position: RoadPosition,
  cities: Pick<CityAssembly, 'id' | 'centerX' | 'centerY'>[],
  isLandAt: (x: number, y: number) => boolean,
): RoadPlacementError | null {
  if (
    !cities.some(
      (city) =>
        Math.abs(city.centerX - position.x) <= MUNICIPAL_AREA_RADIUS &&
        Math.abs(city.centerY - position.y) <= MUNICIPAL_AREA_RADIUS,
    )
  ) {
    return 'outside_municipality';
  }

  if (!isLandAt(position.x, position.y)) return 'water';

  if (
    cities.some(
      (city) =>
        Math.abs(city.centerX - position.x) < 2 &&
        Math.abs(city.centerY - position.y) < 2,
    )
  ) {
    return 'building_overlap';
  }

  return null;
}

export function getRoadAssetIndex(
  position: RoadPosition,
  roads: Pick<RoadTile, 'x' | 'y'>[],
  roadKeys = new Set(roads.map((road) => `${road.x},${road.y}`)),
): number {
  const north = roadKeys.has(`${position.x},${position.y - 1}`);
  const east = roadKeys.has(`${position.x + 1},${position.y}`);
  const south = roadKeys.has(`${position.x},${position.y + 1}`);
  const west = roadKeys.has(`${position.x - 1},${position.y}`);
  const connections = [north, east, south, west].filter(Boolean).length;

  if (connections === 0 || connections === 2 && east && west) return 1;
  if (connections === 2 && north && south || connections === 1 && (north || south)) return 2;
  if (connections === 2 && north && east) return 5;
  if (connections === 2 && east && south) return 4;
  if (connections === 2 && south && west) return 3;
  if (connections === 2 && west && north) return 6;
  if (east || west) return 1;
  return 2;
}

export function getOrthogonalPath(
  from: RoadPosition,
  to: RoadPosition,
): RoadPosition[] {
  const path: RoadPosition[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let progressX = 0;
  let progressY = 0;

  while (x !== to.x || y !== to.y) {
    if (y === to.y) {
      x += stepX;
      progressX += 1;
    } else if (x === to.x) {
      y += stepY;
      progressY += 1;
    } else if ((progressX + 0.5) / dx <= (progressY + 0.5) / dy) {
      x += stepX;
      progressX += 1;
    } else {
      y += stepY;
      progressY += 1;
    }
    path.push({ x, y });
  }

  return path;
}
