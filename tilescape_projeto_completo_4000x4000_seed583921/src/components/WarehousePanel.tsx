import { useEffect, useState } from 'react';
import { PRODUCTS } from '../types/product';
import { RESIDENCES, type ResidentialBuilding } from '../types/residence';
import {
  MAX_WAREHOUSE_DESIRED_STOCK,
  MAX_WAREHOUSE_PRICE,
  type WarehouseProductSetting,
  type WarehouseTradeMode,
} from '../types/warehouse';

interface WarehousePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  settings: Map<string, WarehouseProductSetting>;
  stock: Map<string, number>;
  isSaving: boolean;
  error: string;
  onSave: (setting: WarehouseProductSetting) => void;
  onClose: () => void;
}

interface Draft {
  desiredStock: string;
  price: string;
  mode: WarehouseTradeMode;
}

const number = new Intl.NumberFormat('pt-BR');

export default function WarehousePanel({
  building,
  isOwner,
  settings,
  stock,
  isSaving,
  error,
  onSave,
  onClose,
}: WarehousePanelProps) {
  const capacity = RESIDENCES[building.type].storageCapacityM3 ?? 0;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const usedM3 = PRODUCTS.reduce(
    (total, product) => total + (stock.get(product.id) ?? 0) * product.volumeM3,
    0,
  );

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const [productId, setting] of settings) {
      next[productId] = {
        desiredStock: String(setting.desiredStock),
        price: String(setting.price),
        mode: setting.mode,
      };
    }
    setDrafts(next);
  }, [building.id, settings]);

  const draftFor = (productId: string): Draft =>
    drafts[productId] ?? { desiredStock: '0', price: '0', mode: 'sell' };
  const update = (productId: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [productId]: { ...draftFor(productId), ...patch } }));

  return (
    <section className="warehouse-panel" aria-label="Estoque do armazém">
      <div className="panel-title">
        <div className="eyebrow">ARMAZÉM</div>
        <h1>Produtos e estoque</h1>
        <button type="button" className="panel-close" aria-label="Fechar estoque" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Espaço ocupado: {number.format(Math.round(usedM3 * 1000) / 1000)} / {number.format(capacity)} m³
        {!isOwner && ' · Somente o dono pode editar.'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        <div className="warehouse-row warehouse-head">
          <span>Produto</span>
          <span>Estoque</span>
          <span>Desejável</span>
          <span>Valor (C$)</span>
          <span>Tipo</span>
          <span />
        </div>
        {PRODUCTS.map((product) => {
          const draft = draftFor(product.id);
          return (
            <div className="warehouse-row" key={product.id}>
              <span className="warehouse-product">
                <img src={product.icon} alt="" />
                {product.name}
              </span>
              <span>{number.format(stock.get(product.id) ?? 0)} {product.unit === 'liter' ? 'L' : 'un.'}</span>
              <input
                type="number"
                min={0}
                max={MAX_WAREHOUSE_DESIRED_STOCK}
                step={1}
                aria-label={`Estoque desejável de ${product.name}`}
                value={draft.desiredStock}
                disabled={!isOwner || isSaving}
                onChange={(event) => update(product.id, { desiredStock: event.target.value })}
              />
              <input
                type="number"
                min={0}
                max={MAX_WAREHOUSE_PRICE}
                step={1}
                aria-label={`Valor de ${product.name}`}
                value={draft.price}
                disabled={!isOwner || isSaving}
                onChange={(event) => update(product.id, { price: event.target.value })}
              />
              <select
                aria-label={`Venda ou compra de ${product.name}`}
                value={draft.mode}
                disabled={!isOwner || isSaving}
                onChange={(event) => update(product.id, { mode: event.target.value as WarehouseTradeMode })}
              >
                <option value="sell">Venda</option>
                <option value="buy">Compra</option>
              </select>
              <button
                type="button"
                disabled={!isOwner || isSaving}
                onClick={() =>
                  onSave({
                    productId: product.id,
                    desiredStock: Number(draft.desiredStock),
                    price: Number(draft.price),
                    mode: draft.mode,
                  })
                }
              >
                Salvar
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
