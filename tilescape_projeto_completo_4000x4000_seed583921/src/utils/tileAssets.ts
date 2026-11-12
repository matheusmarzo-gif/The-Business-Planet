import type { TileDefinition, TileId } from '../types/map.js';

export const DEFAULT_TILES: Record<string, TileDefinition> = {
  water_deep: {
    id: 'water_deep',
    name: 'Deep Ocean',
    namePt: 'Oceano Profundo',
    category: 'water',
    role: 'water_deep',
    src: '/assets/aistudio/water3_16f3204b.jxl',
    color: '#2774a3',
    descriptionPt: 'Águas abissais com ondulações concêntricas azuis profundas.',
  },
  water_lily: {
    id: 'water_lily',
    name: 'Lily Pond',
    namePt: 'Lago de Ninféias',
    category: 'water',
    role: 'water_lily',
    src: '/assets/aistudio/water2_d5899df5.jxl',
    color: '#3f98bd',
    descriptionPt: 'Enseada serena com ninfeias amarelas e rochas submersas.',
  },
  water_coastal: {
    id: 'water_coastal',
    name: 'Coastal Water',
    namePt: 'Água Costeira / Baixio',
    category: 'water',
    role: 'water_coastal',
    src: '/assets/aistudio/water_b6d9fef8.jxl',
    color: '#48a9c5',
    descriptionPt: 'Águas claras costeiras com vegetação rasa e pedras.',
  },
  grass_plains: {
    id: 'grass_plains',
    name: 'Lush Plains',
    namePt: 'Planície Verdejante',
    category: 'land',
    role: 'grass_plains',
    src: '/assets/aistudio/grass_2819e5ba.jxl',
    color: '#3d8b2d',
    descriptionPt: 'Grama vibrante e abundante, base das grandes pradarias.',
  },
  grass_buttercup: {
    id: 'grass_buttercup',
    name: 'Buttercup Meadow',
    namePt: 'Campo de Flores Amarelas',
    category: 'land',
    role: 'grass_flower',
    src: '/assets/aistudio/grass3_be762dfe.jxl',
    color: '#52a632',
    descriptionPt: 'Vales ensolarados repletos de botões de ouro cintilantes.',
  },
  grass_poppy: {
    id: 'grass_poppy',
    name: 'Poppy Shrubland',
    namePt: 'Colina de Papoulas',
    category: 'land',
    role: 'grass_hills',
    src: '/assets/aistudio/grass2_25ac3048.jxl',
    color: '#286b22',
    descriptionPt: 'Colinas e arbustos com papoulas vermelhas e pedras.',
  },
  grass_daisy: {
    id: 'grass_daisy',
    name: 'Daisy Meadow',
    namePt: 'Clareira de Margaridas',
    category: 'land',
    role: 'grass_clearing',
    src: '/assets/aistudio/grass4_d1db289d.jxl',
    color: '#439e34',
    descriptionPt: 'Clareira tranquila pontilhada de margaridas brancas.',
  },
};

export const DEFAULT_TILE_LIST: TileDefinition[] = Object.values(DEFAULT_TILES);

// Backward compatibility alias
export const TILES = DEFAULT_TILES;
export const TILE_LIST = DEFAULT_TILE_LIST;

// Image asset cache for high-speed canvas drawing
const imageCache: Map<string, HTMLImageElement> = new Map();

export function preloadTileImages(tiles: TileDefinition[] = DEFAULT_TILE_LIST): Promise<void> {
  return Promise.all(
    tiles.map(
      (tile) =>
        new Promise<void>((resolve) => {
          if (imageCache.has(tile.src)) {
            resolve();
            return;
          }
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            imageCache.set(tile.src, img);
            resolve();
          };
          img.onerror = () => {
            console.warn(`Could not load tile image ${tile.src}`);
            resolve();
          };
          img.src = tile.src;
        })
    )
  ).then(() => {});
}

export function cacheTileImage(src: string, imgOrDataUrl: string | HTMLImageElement): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof imgOrDataUrl === 'string') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCache.set(src, img);
        resolve();
      };
      img.onerror = () => {
        resolve();
      };
      img.src = imgOrDataUrl;
    } else {
      imageCache.set(src, imgOrDataUrl);
      resolve();
    }
  });
}

export function removeTileImage(src: string): void {
  imageCache.delete(src);
}

export function getCachedTileImage(src: string): HTMLImageElement | undefined {
  return imageCache.get(src);
}

/**
 * Extracts average/dominant RGB color from an image URL or data URL
 */
export async function extractDominantColor(fileOrDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve('#3d8b2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const imgData = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        for (let i = 0; i < imgData.length; i += 4) {
          if (imgData[i + 3] > 64) {
            r += imgData[i];
            g += imgData[i + 1];
            b += imgData[i + 2];
            count++;
          }
        }
        if (count > 0) {
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          resolve(hex);
        } else {
          resolve('#3d8b2d');
        }
      } catch {
        resolve('#3d8b2d');
      }
    };
    img.onerror = () => resolve('#3d8b2d');
    img.src = fileOrDataUrl;
  });
}
