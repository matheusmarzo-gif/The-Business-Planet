import JSZip from 'jszip';
import { BiomeStats, MapConfig, TileDefinition, WaypointPin } from '../types/map';
import { MapGeneratorInstance } from './mapGenerator';
import { generateProceduralStandaloneHtml } from './standaloneHtmlGenerator';
import { getCachedTileImage } from './tileAssets';

// Raw source files imported directly via Vite ?raw bundler feature
import rawIndexHtml from '../../index.html?raw';
import rawPackageJson from '../../package.json?raw';
import rawTsconfig from '../../tsconfig.json?raw';
import rawViteConfig from '../../vite.config.ts?raw';
import rawMainTsx from '../main.tsx?raw';
import rawAppTsx from '../App.tsx?raw';
import rawIndexCss from '../index.css?raw';
import rawTypesMap from '../types/map.ts?raw';
import rawPerlin from './perlin.ts?raw';
import rawMapGenerator from './mapGenerator.ts?raw';
import rawTileAssets from './tileAssets.ts?raw';
import rawStandaloneGen from './standaloneHtmlGenerator.ts?raw';
import rawProjectZip from './projectZipExport.ts?raw';
import rawMapCanvas from '../components/MapCanvas.tsx?raw';
import rawMinimap from '../components/Minimap.tsx?raw';
import rawControlsPanel from '../components/ControlsPanel.tsx?raw';
import rawTileInspector from '../components/TileInspector.tsx?raw';
import rawTileEditorModal from '../components/TileEditorModal.tsx?raw';
import rawExportModal from '../components/ExportModal.tsx?raw';

export interface ZipExportProgress {
  step: string;
  progress: number; // 0 to 100
}

/**
 * Converts an image element or URL to a base64 string or blob
 */
async function getImageBlob(
  src: string,
  cachedImg?: HTMLImageElement
): Promise<Blob | null> {
  if (src.startsWith('data:image')) {
    const res = await fetch(src);
    return res.blob();
  }

  if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = cachedImg.naturalWidth;
    canvas.height = cachedImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(cachedImg, 0, 0);
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      });
    }
  }

  try {
    const response = await fetch(src);
    return await response.blob();
  } catch (err) {
    console.warn('Could not fetch image blob for', src, err);
    return null;
  }
}

/**
 * Generates high-resolution PNG blob of the map overview
 */
function generateMapOverviewBlob(
  generator: MapGeneratorInstance,
  size: number = 2048
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve(null);

    const data = generator.generateMinimapData(size, size);
    const imgData = ctx.createImageData(size, size);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);

    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Generates comprehensive README.md
 */
function generateReadmeMarkdown(
  config: MapConfig,
  tiles: TileDefinition[],
  stats: BiomeStats[]
): string {
  return `# TileScape 4K - Projeto Completo de Mapa Procedural

Este pacote contém todos os arquivos do projeto, o código-fonte completo (React + TypeScript + Vite) e o arquivo HTML autônomo com toda a lógica procedural de geração e renderização do mapa em Canvas.

---

## 🚀 Como Executar o Projeto

### Opção 1: Execução Imediata (Sem Instalar Nada)
Basta dar dois cliques no arquivo **\`map_procedural_standalone.html\`** ou **\`index_standalone.html\`** para abrir no seu navegador!
- Contém todo o algoritmo de ruído Perlin, Fractal Brownian Motion, renderizador de chunks, câmera interativa, minimapa e controles em tempo real em um único arquivo HTML.

### Opção 2: Projeto Completo (React + Vite)
Para rodar ou modificar o código-fonte com o servidor Vite local:
1. Instale as dependências:
   \`\`\`bash
   npm install
   \`\`\`
2. Inicie o servidor de desenvolvimento:
   \`\`\`bash
   npm run dev
   \`\`\`
3. Abra o link exibido no terminal (geralmente \`http://localhost:3000\`).

---

## 📁 Estrutura de Arquivos no Pacote .ZIP

\`\`\`
├── map_procedural_standalone.html  # HTML com toda a lógica procedural de construção do mapa
├── index_standalone.html           # Cópia direta para abertura rápida
├── map_overview.png                # Renderização panorâmica de alta resolução (2048x2048)
├── map_config.json                 # Metadados e coeficientes numéricos do mundo
├── tiles/                          # Pasta com todas as texturas de tiles PNG
│   ├── manifest.json               # Metadados de cada textura e cores
│   └── tile_*.png
├── src/                            # Código-fonte completo em TypeScript
│   ├── App.tsx                     # Componente principal da aplicação
│   ├── main.tsx                    # Ponto de entrada React
│   ├── index.css                   # Estilização Tailwind
│   ├── types/map.ts                # Definições de tipos e interfaces
│   ├── utils/                      # Algoritmos procedurais
│   │   ├── perlin.ts               # Algoritmo matemático de ruído Perlin 2D e fBm
│   │   ├── mapGenerator.ts         # Distribuição de biomas e elevação
│   │   └── tileAssets.ts           # Cache e carregamento de texturas
│   └── components/                 # Componentes de interface e Canvas
│       ├── MapCanvas.tsx           # Renderizador Canvas com LOD e culling
│       ├── Minimap.tsx             # Minimapa em tempo real
│       ├── ControlsPanel.tsx       # Painel de parâmetros e biomas
│       └── TileInspector.tsx       # HUD de inspeção e coordenadas
├── public/assets/aistudio/         # Texturas originais servidas pelo Vite
├── package.json                    # Dependências do projeto
├── tsconfig.json                   # Configurações TypeScript
└── vite.config.ts                  # Configuração do Vite
\`\`\`

---

## ⚙️ Parâmetros do Mapa Gerado
- **Dimensões**: ${config.width} x ${config.height} tiles (${(config.width * config.height).toLocaleString()} blocos no total)
- **Semente (Seed)**: ${config.seed}
- **Escala de Frequência**: ${config.scale}
- **Nível do Mar**: ${Math.round(config.seaLevel * 100)}%
- **Oitavas Fractais**: ${config.octaves}
- **Preset de Terreno**: ${config.preset}
- **Data da Exportação**: ${new Date().toLocaleString('pt-BR')}

## 🌿 Distribuição Atual de Biomas
${stats
  .map(
    (s) =>
      `- **${tiles.find((t) => t.id === s.tileId)?.namePt || s.tileId}**: ${s.percentage.toFixed(2)}%`
  )
  .join('\n')}
`;
}

/**
 * Main function to export the entire project to a .ZIP file
 */
export async function exportProjectToZip(
  config: MapConfig,
  generator: MapGeneratorInstance,
  tiles: TileDefinition[],
  stats: BiomeStats[],
  pins: WaypointPin[],
  onProgress?: (progress: ZipExportProgress) => void
): Promise<void> {
  const zip = new JSZip();

  // 1. Standalone HTML with procedural generation logic
  onProgress?.({ step: 'Gerando HTML com a lógica procedural de construção...', progress: 10 });
  const standaloneHtml = generateProceduralStandaloneHtml(config, tiles, pins);
  zip.file('map_procedural_standalone.html', standaloneHtml);
  zip.file('index_standalone.html', standaloneHtml);

  // 2. High-Res Overview PNG
  onProgress?.({ step: 'Renderizando visão geral em alta resolução (2048x2048)...', progress: 25 });
  const mapOverviewBlob = await generateMapOverviewBlob(generator, 2048);
  if (mapOverviewBlob) {
    zip.file('map_overview.png', mapOverviewBlob);
  }

  // 3. Tile Textures Folder (for both standalone HTML and Vite public folder)
  onProgress?.({ step: 'Empacotando texturas dos tiles...', progress: 40 });
  const tilesFolder = zip.folder('tiles');
  const publicAssetsFolder = zip.folder('public/assets/aistudio');

  const tilesManifest: Array<{
    id: string;
    name: string;
    namePt: string;
    category: string;
    role?: string;
    color: string;
    filename: string;
  }> = [];

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const safeFilename = `tile_${i + 1}_${tile.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const cached = getCachedTileImage(tile.src);
    const blob = await getImageBlob(tile.src, cached);

    if (blob) {
      tilesFolder?.file(safeFilename, blob);
      // Also place in public assets folder with its original filename if matched
      const originalName = tile.src.split('/').pop();
      if (originalName && publicAssetsFolder) {
        publicAssetsFolder.file(originalName, blob);
      }
    }

    tilesManifest.push({
      id: tile.id,
      name: tile.name,
      namePt: tile.namePt,
      category: tile.category,
      role: tile.role,
      color: tile.color,
      filename: `tiles/${safeFilename}`,
    });

    onProgress?.({
      step: `Processando tile ${i + 1} de ${tiles.length} (${tile.namePt})...`,
      progress: 40 + Math.round(((i + 1) / tiles.length) * 20),
    });
  }

  tilesFolder?.file('manifest.json', JSON.stringify(tilesManifest, null, 2));

  // 4. Map Config & Waypoints JSON
  onProgress?.({ step: 'Criando dados de configuração e sementes...', progress: 65 });
  const configData = {
    appName: 'TileScape 4K',
    dimensions: {
      width: config.width,
      height: config.height,
      totalTiles: config.width * config.height,
    },
    noiseSettings: {
      seed: config.seed,
      scale: config.scale,
      seaLevel: config.seaLevel,
      octaves: config.octaves,
      persistence: config.persistence,
      lacunarity: config.lacunarity,
      moistureScale: config.moistureScale,
      flowerDensity: config.flowerDensity,
      preset: config.preset,
    },
    biomeStatistics: stats.map((s) => ({
      tileId: s.tileId,
      name: tiles.find((t) => t.id === s.tileId)?.namePt || s.tileId,
      percentage: Number(s.percentage.toFixed(2)),
    })),
    waypoints: pins,
    exportedAt: new Date().toISOString(),
  };
  zip.file('map_config.json', JSON.stringify(configData, null, 2));
  zip.file('waypoints.json', JSON.stringify(pins, null, 2));

  // 5. Complete Source Code Project (Package, TSConfig, Vite, React app)
  onProgress?.({ step: 'Empacotando código-fonte completo do projeto...', progress: 75 });
  zip.file('package.json', rawPackageJson);
  zip.file('tsconfig.json', rawTsconfig);
  zip.file('vite.config.ts', rawViteConfig);
  zip.file('index.html', rawIndexHtml);

  const srcFolder = zip.folder('src');
  if (srcFolder) {
    srcFolder.file('main.tsx', rawMainTsx);
    srcFolder.file('App.tsx', rawAppTsx);
    srcFolder.file('index.css', rawIndexCss);

    const typesFolder = srcFolder.folder('types');
    typesFolder?.file('map.ts', rawTypesMap);

    const utilsFolder = srcFolder.folder('utils');
    utilsFolder?.file('perlin.ts', rawPerlin);
    utilsFolder?.file('mapGenerator.ts', rawMapGenerator);
    utilsFolder?.file('tileAssets.ts', rawTileAssets);
    utilsFolder?.file('standaloneHtmlGenerator.ts', rawStandaloneGen);
    utilsFolder?.file('projectZipExport.ts', rawProjectZip);

    const componentsFolder = srcFolder.folder('components');
    componentsFolder?.file('MapCanvas.tsx', rawMapCanvas);
    componentsFolder?.file('Minimap.tsx', rawMinimap);
    componentsFolder?.file('ControlsPanel.tsx', rawControlsPanel);
    componentsFolder?.file('TileInspector.tsx', rawTileInspector);
    componentsFolder?.file('TileEditorModal.tsx', rawTileEditorModal);
    componentsFolder?.file('ExportModal.tsx', rawExportModal);
  }

  // 6. Comprehensive Documentation
  onProgress?.({ step: 'Criando documentação do projeto...', progress: 85 });
  const readmeMd = generateReadmeMarkdown(config, tiles, stats);
  zip.file('README.md', readmeMd);

  // 7. Compress into .ZIP file
  onProgress?.({ step: 'Compactando arquivo .ZIP final...', progress: 92 });
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  onProgress?.({ step: 'Download pronto!', progress: 100 });

  // 8. Trigger Browser Download
  const link = document.createElement('a');
  const filename = `tilescape_projeto_completo_${config.width}x${config.height}_seed${config.seed}.zip`;
  link.href = URL.createObjectURL(zipBlob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
