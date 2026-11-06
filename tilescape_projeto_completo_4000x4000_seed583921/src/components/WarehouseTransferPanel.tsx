import { useEffect, useState } from 'react';
import { getTransportDemand } from '../types/logistics';
import { PRODUCTS } from '../types/product';
import {
  getResidentialBuildingName,
  type ResidentialBuilding,
} from '../types/residence';

interface WarehouseTransferPanelProps {
  productId: string;
  destination: ResidentialBuilding;
  maxQuantity: number;
  workPoints: number;
  destinationStock: number;
  destinationCapacity: number | null;
  isSubmitting: boolean;
  error: string;
  onSubmit: (quantity: number) => void;
  onClose: () => void;
}

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export default function WarehouseTransferPanel({
  productId,
  destination,
  maxQuantity,
  workPoints,
  destinationStock,
  destinationCapacity,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}: WarehouseTransferPanelProps) {
  const [quantity, setQuantity] = useState(String(maxQuantity));
  const product = PRODUCTS.find((item) => item.id === productId);
  const parsedQuantity = Number(quantity);
  const quantityIsValid =
    Number.isInteger(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= maxQuantity;

  useEffect(() => {
    setQuantity(String(maxQuantity));
  }, [destination.id, maxQuantity]);

  if (!product) return null;

  return (
    <div className="warehouse-transfer-backdrop">
      <form
        className="warehouse-transfer-panel"
        aria-label="Transferir produto"
        onSubmit={(event) => {
          event.preventDefault();
          if (quantityIsValid && !isSubmitting) onSubmit(parsedQuantity);
        }}
      >
        <div className="panel-title">
          <div className="eyebrow">TRANSFERÊNCIA INTERNA</div>
          <h1>{product.name}</h1>
          <button
            type="button"
            className="panel-close"
            aria-label="Fechar transferência"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="warehouse-summary">
          Destino: {getResidentialBuildingName(destination.type, destination.buildingNumber)}.
          {' '}Limite disponível: {number.format(maxQuantity)} {product.unit === 'liter' ? 'L' : 'un.'}.
        </p>
        {destinationCapacity !== null && (
          <p className="warehouse-summary">
            Estoque no destino: {number.format(destinationStock)} / {number.format(destinationCapacity)}.
          </p>
        )}
        {workPoints > 0 && (
          <p className="warehouse-summary">
            Custo máximo de transporte: {number.format(workPoints)} Work Points.
          </p>
        )}
        {maxQuantity === 0 && (
          <p className="warehouse-error" role="status">
            Não há quantidade disponível para transferir: confira o estoque reservado, o espaço do destino e os Work Points do armazém.
          </p>
        )}
        {error && <p className="warehouse-error" role="alert">{error}</p>}
        <label className="warehouse-transfer-quantity">
          Quantidade a transferir
          <input
            type="number"
            min={1}
            max={maxQuantity}
            step={1}
            value={quantity}
            disabled={maxQuantity === 0 || isSubmitting}
            onChange={(event) => setQuantity(event.target.value)}
            autoFocus
          />
        </label>
        <div className="warehouse-transfer-actions">
          <button type="button" className="accounting-view-button" disabled={isSubmitting} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="accounting-view-button" disabled={!quantityIsValid || isSubmitting}>
            {isSubmitting ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </form>
    </div>
  );
}
