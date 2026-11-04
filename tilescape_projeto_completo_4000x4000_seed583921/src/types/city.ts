export const MUNICIPAL_AREA_SIZE = 303;
export const MUNICIPAL_AREA_RADIUS = Math.floor(MUNICIPAL_AREA_SIZE / 2);
export const ASSEMBLY_SIZE = 3;

export interface CityAssembly {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  population: number;
  wellbeing: number;
  economy: number;
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
