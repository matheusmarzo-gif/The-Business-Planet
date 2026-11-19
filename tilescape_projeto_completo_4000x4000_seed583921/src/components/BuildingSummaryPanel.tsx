import {
  getResidentialBuildingName,
  RESIDENCES,
  supportsLocalDemand,
  type ResidentialBuildingSummary,
} from '../types/residence';

interface BuildingSummaryPanelProps {
  building: ResidentialBuildingSummary;
  cityName: string;
  onOpenConsumption: () => void;
  onOpenLocalDemand: () => void;
  onClose: () => void;
}

export default function BuildingSummaryPanel({
  building,
  cityName,
  onOpenConsumption,
  onOpenLocalDemand,
  onClose,
}: BuildingSummaryPanelProps) {
  return (
    <aside className="realm-panel">
      <div className="panel-title">
        <div className="eyebrow">
          {building.status === 'under_construction' ? 'EM CONSTRUÇÃO' : 'CONSTRUÇÃO'}
        </div>
        <h1>{getResidentialBuildingName(building.type, building.buildingNumber)}</h1>
        <button type="button" className="panel-close" aria-label="Fechar painel" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="production-description">{RESIDENCES[building.type].name}</p>
      <div className="panel-divider" />
      <dl className="detail-list">
        <div>
          <dt>Proprietário</dt>
          <dd>{building.ownerName}</dd>
        </div>
        <div>
          <dt>Cidade</dt>
          <dd>{cityName}</dd>
        </div>
        <div>
          <dt>Posição</dt>
          <dd>{building.x}, {building.y}</dd>
        </div>
        <div>
          <dt>Situação</dt>
          <dd>
            {building.status === 'under_construction' ? 'Em construção' : 'Concluída'}
          </dd>
        </div>
      </dl>
      {building.status === 'completed' && RESIDENCES[building.type].kind === 'residence' && (
        <button type="button" className="warehouse-open" onClick={onOpenConsumption}>
          Ver consumo da casa
        </button>
      )}
      {building.status === 'completed' && supportsLocalDemand(RESIDENCES[building.type].kind) && (
        <button type="button" className="warehouse-open" onClick={onOpenLocalDemand}>
          Demanda Local
        </button>
      )}
    </aside>
  );
}
