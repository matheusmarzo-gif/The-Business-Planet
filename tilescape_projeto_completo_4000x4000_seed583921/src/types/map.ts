export type TileId = string;

export type TileRole =
  | 'water_deep'
  | 'water_coastal'
  | 'water_lily'
  | 'grass_plains'
  | 'grass_flower'
  | 'grass_hills'
  | 'grass_clearing';

export interface TileDefinition {
  id: TileId;
  name: string;
  namePt: string;
  category: 'water' | 'land';
  role?: TileRole;
  src: string;
  color: string; // Representative hex color for macro zoom / minimap
  descriptionPt: string;
  isCustom?: boolean;
}

export type TerrainPreset =
  | 'continents'
  | 'archipelago'
  | 'pangaea'
  | 'lakes'
  | 'river_valleys';

export interface MapConfig {
  width: number;
  height: number;
  seed: number;
  scale: number; // Noise frequency
  seaLevel: number; // 0 to 1
  octaves: number; // 1 to 6
  persistence: number; // 0.3 to 0.7
  lacunarity: number; // usually 2.0
  moistureScale: number;
  flowerDensity: number; // 0 to 1
  preset: TerrainPreset;
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface WaypointPin {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
}

export interface TileInfo {
  x: number;
  y: number;
  tileId: TileId;
  elevation: number;
  moisture: number;
  tileDef: TileDefinition;
}

export interface BiomeStats {
  tileId: TileId;
  count: number;
  percentage: number;
}
