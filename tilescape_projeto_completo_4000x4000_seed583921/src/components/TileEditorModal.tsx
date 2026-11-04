import React, { useRef, useState } from 'react';
import { TileDefinition, TileRole } from '../types/map';
import { cacheTileImage, extractDominantColor } from '../utils/tileAssets';
import { ImagePlus, RefreshCw, Upload, X } from 'lucide-react';

interface TileEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tileToEdit: TileDefinition | null; // If null, creating new tile
  onSaveTile: (tile: TileDefinition) => void;
}

export const TileEditorModal: React.FC<TileEditorModalProps> = ({
  isOpen,
  onClose,
  tileToEdit,
  onSaveTile,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState(tileToEdit ? tileToEdit.namePt : '');
  const [category, setCategory] = useState<'water' | 'land'>(
    tileToEdit ? tileToEdit.category : 'land'
  );
  const [role, setRole] = useState<TileRole>(
    tileToEdit?.role || (category === 'water' ? 'water_coastal' : 'grass_plains')
  );
  const [color, setColor] = useState(tileToEdit ? tileToEdit.color : '#3d8b2d');
  const [imageSrc, setImageSrc] = useState(tileToEdit ? tileToEdit.src : '');
  const [description, setDescription] = useState(
    tileToEdit ? tileToEdit.descriptionPt : ''
  );
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // Sync state if tileToEdit changes
  React.useEffect(() => {
    if (tileToEdit) {
      setName(tileToEdit.namePt);
      setCategory(tileToEdit.category);
      setRole(tileToEdit.role || (tileToEdit.category === 'water' ? 'water_coastal' : 'grass_plains'));
      setColor(tileToEdit.color);
      setImageSrc(tileToEdit.src);
      setDescription(tileToEdit.descriptionPt);
    } else {
      setName('');
      setCategory('land');
      setRole('grass_plains');
      setColor('#3d8b2d');
      setImageSrc('');
      setDescription('');
    }
  }, [tileToEdit, isOpen]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingImage(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setImageSrc(dataUrl);

      // Auto extract dominant color from image
      try {
        const domColor = await extractDominantColor(dataUrl);
        setColor(domColor);
      } catch (err) {
        console.error(err);
      } finally {
        setIsProcessingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageSrc) return;

    const id = tileToEdit ? tileToEdit.id : `tile_custom_${Date.now()}`;
    const newTile: TileDefinition = {
      id,
      name: name.trim() || 'Custom Tile',
      namePt: name.trim() || 'Tile Personalizado',
      category,
      role,
      src: imageSrc,
      color,
      descriptionPt: description.trim() || `Tile ${category === 'water' ? 'aquático' : 'terrestre'} importado`,
      isCustom: true,
    };

    // Pre-cache image
    await cacheTileImage(newTile.src, newTile.src);

    onSaveTile(newTile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ImagePlus className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">
              {tileToEdit ? 'Editar / Substituir Tile' : 'Importar Novo Tile'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* Image Upload Area */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">
              Imagem do Tile (PNG / JPG)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="group border-2 border-dashed border-slate-700 hover:border-sky-400/80 bg-slate-950/70 rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-all"
            >
              <div className="w-16 h-16 rounded-lg border border-slate-700 bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center relative">
                {imageSrc ? (
                  <img
                    src={imageSrc}
                    alt="Preview"
                    className="w-full h-full object-cover pixelated"
                  />
                ) : (
                  <Upload className="w-6 h-6 text-slate-500 group-hover:text-sky-400 transition-colors" />
                )}
                {isProcessingImage && (
                  <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white group-hover:text-sky-300 transition-colors">
                  {imageSrc ? 'Alterar textura selecionada' : 'Selecionar arquivo de imagem'}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Clique para carregar textura de tile do seu dispositivo.
                </p>
              </div>
            </div>
          </div>

          {/* Nome do Tile */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Nome do Bioma / Tile
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Praia de Areia, Pântano Místico..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* Categoria: Água ou Terra */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Categoria
              </label>
              <select
                value={category}
                onChange={(e) => {
                  const newCat = e.target.value as 'water' | 'land';
                  setCategory(newCat);
                  setRole(newCat === 'water' ? 'water_coastal' : 'grass_plains');
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:border-sky-400"
              >
                <option value="land">Terra (Terrestre)</option>
                <option value="water">Água (Aquático)</option>
              </select>
            </div>

            {/* Papel no Ruído Perlin (Role) */}
            <div>
              <label className="block text-slate-300 font-semibold mb-1">
                Comportamento no Terreno
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as TileRole)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:border-sky-400"
              >
                {category === 'water' ? (
                  <>
                    <option value="water_deep">Oceano Profundo</option>
                    <option value="water_coastal">Costa / Baixio</option>
                    <option value="water_lily">Lago / Enseada Floral</option>
                  </>
                ) : (
                  <>
                    <option value="grass_plains">Planície Base</option>
                    <option value="grass_flower">Campo de Flores</option>
                    <option value="grass_hills">Colinas & Arbustos</option>
                    <option value="grass_clearing">Clareira Serena</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Cor Representativa (para minimapa e visão macro) */}
          <div className="space-y-1">
            <label className="block text-slate-300 font-semibold">
              Cor do Minimapa & Visão Macro
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-9 h-9 rounded-lg border border-slate-700 bg-slate-950 cursor-pointer p-0.5"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-28 font-mono bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-sky-400"
              />
              <span className="text-[11px] text-slate-400">
                Cor utilizada no minimapa e no zoom panorâmico.
              </span>
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-slate-300 font-semibold mb-1">
              Descrição (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Formação rochosa escarpada nas cordilheiras"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!imageSrc || !name.trim()}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors disabled:opacity-50 shadow-md"
            >
              {tileToEdit ? 'Salvar Alterações' : 'Adicionar ao Mapa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
