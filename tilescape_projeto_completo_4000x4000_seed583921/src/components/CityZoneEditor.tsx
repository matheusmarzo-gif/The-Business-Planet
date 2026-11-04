import { X } from 'lucide-react';
import type { CityAssembly, CityZoneType } from '../types/city';

interface CityZoneEditorProps {
  city: CityAssembly;
  drawingType: CityZoneType | null;
  isSaving: boolean;
  error: string;
  onDraw: (type: CityZoneType | null) => void;
  onDelete: (zoneId: string) => void;
  onClose: () => void;
}

const zoneLabels: Record<CityZoneType, string> = {
  urban: 'Área urbana',
  rural: 'Área rural',
};

export default function CityZoneEditor({
  city,
  drawingType,
  isSaving,
  error,
  onDraw,
  onDelete,
  onClose,
}: CityZoneEditorProps) {
  return (
    <section className="city-zone-editor" aria-label={`Regiões de ${city.name}`}>
      <header className="city-zone-editor-heading">
        <div>
          <span>ZONEAMENTO MUNICIPAL</span>
          <strong>{city.name}</strong>
        </div>
        <button type="button" aria-label="Fechar edição de regiões" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <p>Arraste no mapa para marcar cada área. As regiões não podem se sobrepor.</p>
      {error && <p className="city-zone-editor-error" role="alert">{error}</p>}
      <div className="city-zone-editor-actions">
        {(['urban', 'rural'] as const).map((type) => (
          <button
            key={type}
            className={`city-zone-draw-button ${type}${drawingType === type ? ' active' : ''}`}
            type="button"
            aria-pressed={drawingType === type}
            disabled={isSaving}
            onClick={() => onDraw(drawingType === type ? null : type)}
          >
            {drawingType === type ? 'Cancelar' : `Desenhar ${zoneLabels[type].toLowerCase()}`}
          </button>
        ))}
      </div>
      <div className="city-zone-list">
        {(['urban', 'rural'] as const).map((type) => {
          const zones = city.zones.filter((zone) => zone.type === type);
          return (
            <div className="city-zone-group" key={type}>
              <strong>{zoneLabels[type]} · {zones.length}</strong>
              {zones.length === 0 ? (
                <span>Nenhuma região definida</span>
              ) : (
                zones.map((zone) => (
                  <div className="city-zone-row" key={zone.id}>
                    <span>X {zone.minX}–{zone.maxX} · Y {zone.minY}–{zone.maxY}</span>
                    <button
                      type="button"
                      aria-label={`Remover ${zoneLabels[type].toLowerCase()}`}
                      disabled={isSaving}
                      onClick={() => onDelete(zone.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
      {isSaving && <span className="city-zone-saving">Salvando regiões…</span>}
    </section>
  );
}
