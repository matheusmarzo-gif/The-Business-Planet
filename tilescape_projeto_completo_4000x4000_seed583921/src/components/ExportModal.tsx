import React, { useState } from 'react';
import { BiomeStats, MapConfig, TileDefinition, WaypointPin } from '../types/map';
import { MapGeneratorInstance } from '../utils/mapGenerator';
import { exportProjectToZip, ZipExportProgress } from '../utils/projectZipExport';
import {
  Check,
  Copy,
  Download,
  FileArchive,
  FileJson,
  Image,
  Loader2,
  X,
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: MapConfig;
  generator: MapGeneratorInstance;
  tiles: TileDefinition[];
  stats: BiomeStats[];
  pins: WaypointPin[];
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  config,
  generator,
  tiles,
  stats,
  pins,
}) => {
  const [isExportingPNG, setIsExportingPNG] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState<ZipExportProgress | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [exportRes, setExportRes] = useState<number>(1024);

  if (!isOpen) return null;

  // Export full project .ZIP
  const handleExportZip = async () => {
    setIsExportingZip(true);
    setZipProgress({ step: 'Iniciando empacotamento...', progress: 5 });
    try {
      await exportProjectToZip(
        config,
        generator,
        tiles,
        stats,
        pins,
        (p) => setZipProgress(p)
      );
    } catch (err) {
      console.error('Error generating zip:', err);
    } finally {
      setTimeout(() => {
        setIsExportingZip(false);
        setZipProgress(null);
      }, 800);
    }
  };

  // Export rendered map thumbnail as PNG
  const handleExportPNG = async () => {
    setIsExportingPNG(true);
    try {
      const canvas = document.createElement('canvas');
      const size = exportRes;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      const data = generator.generateMinimapData(size, size);
      const imgData = ctx.createImageData(size, size);
      imgData.data.set(data);
      ctx.putImageData(imgData, 0, 0);

      // Download
      const link = document.createElement('a');
      link.download = `map_${config.width}x${config.height}_seed${config.seed}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setIsExportingPNG(false);
    }
  };

  // Export JSON configuration & matrix summary
  const getMapJsonString = () => {
    const exportObject = {
      name: 'Procedural Map',
      generator: 'Perlin Noise (fBm 2D)',
      dimensions: {
        width: config.width,
        height: config.height,
        totalTiles: config.width * config.height,
      },
      seed: config.seed,
      noiseSettings: {
        scale: config.scale,
        seaLevel: config.seaLevel,
        octaves: config.octaves,
        persistence: config.persistence,
        lacunarity: config.lacunarity,
        flowerDensity: config.flowerDensity,
        preset: config.preset,
      },
      biomeStatistics: stats.map((s) => ({
        tileId: s.tileId,
        tileName:
          tiles.find((t) => t.id === s.tileId)?.namePt || s.tileId,
        percentage: Number(s.percentage.toFixed(2)),
      })),
      waypoints: pins,
      timestamp: new Date().toISOString(),
    };
    return JSON.stringify(exportObject, null, 2);
  };

  const handleDownloadJSON = () => {
    const jsonStr = getMapJsonString();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `map_config_${config.seed}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJSON = () => {
    const jsonStr = getMapJsonString();
    navigator.clipboard.writeText(jsonStr);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">Exportação do Mapa</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Export Full Project .ZIP */}
          <div className="space-y-3 bg-gradient-to-br from-sky-950/50 via-slate-900 to-slate-950 p-4 rounded-xl border border-sky-500/40 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-semibold text-sm">
                <FileArchive className="w-5 h-5 text-sky-400" />
                <span>Exportar Todo o Projeto (.ZIP)</span>
              </div>
              <span className="text-[11px] font-mono text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                Recomendado
              </span>
            </div>

            <p className="text-slate-300 text-xs leading-relaxed">
              Gera um arquivo compacto contendo <strong>todas as texturas de tiles</strong> em PNG, a <strong>visão panorâmica do mapa</strong> em 2048x2048, o <strong>arquivo JSON</strong> com todas as sementes e parâmetros procedurais, o <strong>README</strong> explicativo e um <strong>visualizador HTML offline</strong> independente para abrir no navegador.
            </p>

            {zipProgress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-sky-300">
                  <span>{zipProgress.step}</span>
                  <span className="font-mono">{zipProgress.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 transition-all duration-200"
                    style={{ width: `${zipProgress.progress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleExportZip}
              disabled={isExportingZip}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg text-xs shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {isExportingZip ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compactando Projeto...</span>
                </>
              ) : (
                <>
                  <FileArchive className="w-4 h-4" />
                  <span>Baixar Projeto Completo (.ZIP)</span>
                </>
              )}
            </button>
          </div>

          {/* Export PNG */}
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <Image className="w-4 h-4 text-sky-400" />
              <span>Exportar Apenas Imagem PNG do Terreno</span>
            </div>
            <p className="text-slate-400 text-xs">
              Renderiza o mapa com a distribuição de biomas em alta resolução.
            </p>

            <div className="flex items-center gap-3 pt-1">
              <span className="text-slate-400">Resolução:</span>
              <div className="flex gap-2">
                {[512, 1024, 2048].map((res) => (
                  <button
                    key={res}
                    onClick={() => setExportRes(res)}
                    className={`px-3 py-1 rounded-md font-mono text-xs transition-colors ${
                      exportRes === res
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/50'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {res}x{res}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleExportPNG}
              disabled={isExportingPNG}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg text-xs transition-colors disabled:opacity-50"
            >
              {isExportingPNG ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Renderizando imagem...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Baixar Imagem PNG ({exportRes}x{exportRes})</span>
                </>
              )}
            </button>
          </div>

          {/* Export JSON */}
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <FileJson className="w-4 h-4 text-emerald-400" />
              <span>Exportar Metadados & Semente (JSON)</span>
            </div>
            <p className="text-slate-400 text-xs">
              Estrutura de dados com todos os coeficientes de ruído e estatísticas.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleDownloadJSON}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Salvar Arquivo .json</span>
              </button>
              <button
                onClick={handleCopyJSON}
                className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg font-medium transition-colors"
              >
                {copiedJson ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copiar JSON</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
