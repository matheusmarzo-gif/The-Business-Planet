import { BiomeStats, MapConfig, TileDefinition, TileId, TileInfo } from '../types/map';
import { PerlinNoise } from './perlin';
import { DEFAULT_TILE_LIST } from './tileAssets';

export interface MapGeneratorInstance {
  config: MapConfig;
  tiles: TileDefinition[];
  getTileAt: (x: number, y: number) => {
    tileId: TileId;
    elevation: number;
    moisture: number;
  };
  getTileInfo: (x: number, y: number) => TileInfo;
  generateMinimapData: (width: number, height: number) => Uint8ClampedArray;
  calculateStats: (sampleGridSize?: number) => BiomeStats[];
}

// Parse hex color to RGB for fast ImageData writing
function hexToRgb(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function createMapGenerator(
  config: MapConfig,
  tiles: TileDefinition[] = DEFAULT_TILE_LIST
): MapGeneratorInstance {
  const seed = config.seed;
  const elevationNoise = new PerlinNoise(seed);
  const moistureNoise = new PerlinNoise(seed + 1013);
  const floraNoise = new PerlinNoise(seed + 2027);
  const detailNoise = new PerlinNoise(seed + 3041);

  const cx = config.width / 2;
  const cy = config.height / 2;
  const maxRadius = Math.min(cx, cy);

  // Index tiles by ID and partition by category
  const tileMap = new Map<string, TileDefinition>();
  const tileRGB = new Map<string, [number, number, number]>();

  tiles.forEach((t) => {
    tileMap.set(t.id, t);
    tileRGB.set(t.id, hexToRgb(t.color));
  });

  const waterTiles = tiles.filter((t) => t.category === 'water');
  const landTiles = tiles.filter((t) => t.category === 'land');

  // Fallback if user somehow deleted all tiles in a category
  const effectiveWaterTiles = waterTiles.length > 0 ? waterTiles : tiles.slice(0, 1);
  const effectiveLandTiles =
    landTiles.length > 0 ? landTiles : tiles.slice(tiles.length - 1);

  // Map roles or fallback to first
  const deepWaterTile =
    effectiveWaterTiles.find((t) => t.role === 'water_deep') ||
    effectiveWaterTiles[0];
  const coastalWaterTile =
    effectiveWaterTiles.find((t) => t.role === 'water_coastal') ||
    effectiveWaterTiles[effectiveWaterTiles.length - 1];
  const lilyWaterTile =
    effectiveWaterTiles.find((t) => t.role === 'water_lily') || coastalWaterTile;

  const plainsLandTile =
    effectiveLandTiles.find((t) => t.role === 'grass_plains') ||
    effectiveLandTiles[0];
  const flowerLandTile =
    effectiveLandTiles.find((t) => t.role === 'grass_flower') || plainsLandTile;
  const hillsLandTile =
    effectiveLandTiles.find((t) => t.role === 'grass_hills') || plainsLandTile;
  const clearingLandTile =
    effectiveLandTiles.find((t) => t.role === 'grass_clearing') || plainsLandTile;

  // Extra custom tiles for variety
  const extraWaterTiles = effectiveWaterTiles.filter(
    (t) =>
      t.id !== deepWaterTile.id &&
      t.id !== coastalWaterTile.id &&
      t.id !== lilyWaterTile.id
  );
  const extraLandTiles = effectiveLandTiles.filter(
    (t) =>
      t.id !== plainsLandTile.id &&
      t.id !== flowerLandTile.id &&
      t.id !== hillsLandTile.id &&
      t.id !== clearingLandTile.id
  );

  function getTileAt(x: number, y: number): {
    tileId: TileId;
    elevation: number;
    moisture: number;
  } {
    const clampedX = Math.max(0, Math.min(config.width - 1, x));
    const clampedY = Math.max(0, Math.min(config.height - 1, y));

    // Calculate base elevation using multi-octave Perlin noise
    let elevation = elevationNoise.fbm2D(
      clampedX * config.scale,
      clampedY * config.scale,
      config.octaves,
      config.persistence,
      config.lacunarity
    );

    // Apply terrain preset adjustments
    if (config.preset === 'pangaea') {
      const dx = (clampedX - cx) / maxRadius;
      const dy = (clampedY - cy) / maxRadius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, Math.min(1, 1 - dist * 1.15));
      elevation = elevation * 0.7 + mask * 0.45;
    } else if (config.preset === 'archipelago') {
      const highFreq = detailNoise.noise2D(
        clampedX * config.scale * 3,
        clampedY * config.scale * 3
      );
      elevation = elevation * 0.85 + (highFreq * 0.5 + 0.5) * 0.25;
      elevation = Math.pow(elevation, 1.25);
    } else if (config.preset === 'lakes') {
      elevation = 1 - Math.pow(1 - elevation, 1.4);
    } else if (config.preset === 'river_valleys') {
      const raw = elevationNoise.noise2D(
        clampedX * config.scale * 1.5,
        clampedY * config.scale * 1.5
      );
      const valley = 1 - Math.abs(raw);
      elevation = elevation * 0.65 + valley * 0.4;
    }

    elevation = Math.max(0, Math.min(1, elevation));

    // Calculate moisture field
    const moisture = moistureNoise.fbm2D(
      clampedX * config.moistureScale,
      clampedY * config.moistureScale,
      3,
      0.5,
      2.0
    );

    // Flora / micro-feature noise
    const flora = floraNoise.fbm2D(
      clampedX * config.scale * 2.2,
      clampedY * config.scale * 2.2,
      2,
      0.5,
      2.0
    );

    const sea = config.seaLevel;
    let selectedTile: TileDefinition;

    if (elevation < sea) {
      // Water biome
      const deepThreshold = sea * 0.65;
      if (elevation < deepThreshold) {
        // Deep water
        if (extraWaterTiles.length > 0 && moisture < 0.3) {
          const idx = Math.floor(moisture * extraWaterTiles.length) % extraWaterTiles.length;
          selectedTile = extraWaterTiles[idx];
        } else {
          selectedTile = deepWaterTile;
        }
      } else {
        // Shallow / Coastal water
        const isSheltered =
          moisture > 0.58 && flora > 0.55 && elevation > sea * 0.82;
        if (isSheltered) {
          selectedTile = lilyWaterTile;
        } else if (extraWaterTiles.length > 0 && flora < 0.25) {
          selectedTile = extraWaterTiles[0];
        } else {
          selectedTile = coastalWaterTile;
        }
      }
    } else {
      // Land biome (Plains and variants)
      const landHeight = (elevation - sea) / Math.max(0.001, 1 - sea);
      const flowerThreshold = 1 - config.flowerDensity * 0.65;

      if (extraLandTiles.length > 0 && landHeight > 0.85) {
        // Highland / Custom mountain
        selectedTile = extraLandTiles[0];
      } else if (landHeight > 0.68 || (moisture < 0.32 && flora > 0.45)) {
        selectedTile = hillsLandTile;
      } else if (moisture > 0.52 && flora > flowerThreshold) {
        selectedTile = flowerLandTile;
      } else if (flora < 0.28 && moisture >= 0.35 && moisture <= 0.65) {
        selectedTile = clearingLandTile;
      } else if (extraLandTiles.length > 1 && moisture > 0.7) {
        selectedTile = extraLandTiles[1];
      } else {
        selectedTile = plainsLandTile;
      }
    }

    return {
      tileId: selectedTile.id,
      elevation,
      moisture,
    };
  }

  function getTileInfo(x: number, y: number): TileInfo {
    const { tileId, elevation, moisture } = getTileAt(x, y);
    const def = tileMap.get(tileId) || tiles[0];
    return {
      x,
      y,
      tileId,
      elevation,
      moisture,
      tileDef: def,
    };
  }

  function generateMinimapData(width: number, height: number): Uint8ClampedArray {
    const buffer = new Uint8ClampedArray(width * height * 4);
    const stepX = config.width / width;
    const stepY = config.height / height;

    let ptr = 0;
    for (let my = 0; my < height; my++) {
      const worldY = Math.floor(my * stepY);
      for (let mx = 0; mx < width; mx++) {
        const worldX = Math.floor(mx * stepX);
        const { tileId } = getTileAt(worldX, worldY);
        const rgb = tileRGB.get(tileId) || [40, 100, 40];

        buffer[ptr++] = rgb[0];
        buffer[ptr++] = rgb[1];
        buffer[ptr++] = rgb[2];
        buffer[ptr++] = 255;
      }
    }
    return buffer;
  }

  function calculateStats(sampleGridSize: number = 80): BiomeStats[] {
    const counts = new Map<string, number>();
    tiles.forEach((t) => counts.set(t.id, 0));

    let total = 0;
    const stepX = config.width / sampleGridSize;
    const stepY = config.height / sampleGridSize;

    for (let sy = 0; sy < sampleGridSize; sy++) {
      const y = Math.floor(sy * stepY);
      for (let sx = 0; sx < sampleGridSize; sx++) {
        const x = Math.floor(sx * stepX);
        const { tileId } = getTileAt(x, y);
        const current = counts.get(tileId) || 0;
        counts.set(tileId, current + 1);
        total++;
      }
    }

    return tiles.map((tile) => {
      const c = counts.get(tile.id) || 0;
      return {
        tileId: tile.id,
        count: c,
        percentage: total > 0 ? (c / total) * 100 : 0,
      };
    });
  }

  return {
    config,
    tiles,
    getTileAt,
    getTileInfo,
    generateMinimapData,
    calculateStats,
  };
}
