import type { MapConfig } from '../types/map.js';

export const WORLD_CONFIG: MapConfig = {
  width: 4000,
  height: 4000,
  seed: 583921,
  scale: 0.008,
  seaLevel: 0.46,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  moistureScale: 0.006,
  flowerDensity: 0.5,
  preset: 'continents',
};
