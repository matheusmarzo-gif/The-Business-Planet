import { useEffect, useMemo, useState } from 'react';
import { PRODUCTS } from '../types/product';
import { getDailyWorkPoints } from '../types/employment';
import { RESIDENCES, RESIDENCE_STATS, type ResidentialBuilding } from '../types/residence';
import {
  MAX_WAREHOUSE_STOCK,
  MAX_WAREHOUSE_PRICE,
  DEFAULT_WAREHOUSE_SETTING,
  type WarehouseDemand,
  type WarehouseProductSetting,
  type WarehouseTradeMode,
} from '../types/warehouse';

interface WarehousePanelProps {
  building: ResidentialBuilding;
  isOwner: boolean;
  settings: Map<string, WarehouseProductSetting>;
  stock: Map<string, number>;
  averagePrices: Map<string, number>;
  demand: WarehouseDemand | null;
  isSaving: boolean;
  isSearchingSuppliers: boolean;
  error: string;
  supplierMessage: string;
  onSave: (setting: WarehouseProductSetting) => void;
  onSearchSuppliers: () => void;
  onClose: () => void;
}

interface Draft {
  minimumStock: string;
  maximumStock: string;
  price: string;
  mode: WarehouseTradeMode;
}

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export default function WarehousePanel({
  building,
  isOwner,
  settings,
  stock,
  averagePrices,
  demand,
  isSaving,
  isSearchingSuppliers,
  error,
  supplierMessage,
  onSave,
  onSearchSuppliers,
  onClose,
}: WarehousePanelProps) {
  const capacity = RESIDENCES[building.type].storageCapacityM3 ?? 0;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState('');
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return query
      ? PRODUCTS.filter((product) => product.name.toLocaleLowerCase('pt-BR').includes(query))
      : PRODUCTS;
  }, [search]);
  const usedM3 = PRODUCTS.reduce(
    (total, product) => total + (stock.get(product.id) ?? 0) * product.volumeM3,
    0,
  );
  const forecast =
    building.employed *
    getDailyWorkPoints(building.workHoursPerDay, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness);
  const wp = (value: number) => number.format(Math.round(value * 10) / 10);

  useEffect(() => {
    const next: Record<string, Draft> = {};
    for (const [productId, setting] of settings) {
      next[productId] = {
        minimumStock: String(setting.minimumStock),
        maximumStock: setting.maximumStock === null ? 'MAX' : String(setting.maximumStock),
        price: String(setting.price),
        mode: setting.mode,
      };
    }
    setDrafts(next);
  }, [building.id, settings]);

  const draftFor = (productId: string): Draft =>
    drafts[productId] ?? {
      minimumStock: String(DEFAULT_WAREHOUSE_SETTING.minimumStock),
      maximumStock: 'MAX',
      price: String(DEFAULT_WAREHOUSE_SETTING.price),
      mode: DEFAULT_WAREHOUSE_SETTING.mode,
    };
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
      <p className="warehouse-summary">
        Demanda de Work Points no último dia{demand?.lastDay ? ` (${demand.lastDay})` : ''}: {wp(demand?.last ?? 0)}
        {' · '}Média do último mês: {wp(demand?.monthAverage ?? 0)}
        {' · '}Previsão de geração no próximo dia: {wp(forecast)}
        {demand && forecast < demand.monthAverage && ' · Contrate mais funcionários.'}
      </p>
      <div className="warehouse-actions">
        <button
          type="button"
          className="warehouse-search-suppliers"
          disabled={!isOwner || isSearchingSuppliers || isSaving}
          onClick={onSearchSuppliers}
        >
          {isSearchingSuppliers ? 'Procurando fornecedores…' : 'Procurar fornecedores'}
        </button>
        <label className="warehouse-search">
          <span>Buscar produto</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex.: trigo, leite, madeira"
          />
        </label>
      </div>
      {supplierMessage && <p role="status" className="warehouse-success">{supplierMessage}</p>}
      <div className="warehouse-list">
        <div className="warehouse-row warehouse-head">
          <span>Produto</span>
          <span>Estoque</span>
          <span>Preço médio</span>
          <span>Estoque Máximo Desejável</span>
          <span>Estoque Mínimo Desejável</span>
          <span>Valor (C$)</span>
          <span>Tipo</span>
          <span />
        </div>
        {filteredProducts.map((product) => {
          const draft = draftFor(product.id);
          const averagePrice = averagePrices.get(product.id);
          return (
            <div className="warehouse-row" key={product.id}>
              <span className="warehouse-product">
                <img src={product.icon} alt="" />
                {product.name}
              </span>
              <span>{number.format(stock.get(product.id) ?? 0)} {product.unit === 'liter' ? 'L' : 'un.'}</span>
              <span>
                {averagePrice !== undefined
                  ? `C$ ${number.format(averagePrice)}`
                  : '—'}
              </span>
              <input
                type="text"
                inputMode="numeric"
                min={0}
                max={MAX_WAREHOUSE_STOCK}
                aria-label={`Estoque máximo desejável de ${product.name}`}
                value={draft.maximumStock}
                disabled={!isOwner || isSaving}
                onChange={(event) => update(product.id, { maximumStock: event.target.value })}
              />
              <input
                type="number"
                min={0}
                max={MAX_WAREHOUSE_STOCK}
                step={1}
                aria-label={`Estoque mínimo desejável de ${product.name}`}
                value={draft.minimumStock}
                disabled={!isOwner || isSaving}
                onChange={(event) => update(product.id, { minimumStock: event.target.value })}
              />
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_WAREHOUSE_PRICE}
                step={0.01}
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
                    minimumStock: Number(draft.minimumStock),
                    maximumStock:
                      draft.maximumStock.trim().toUpperCase() === 'MAX'
                        ? null
                        : Number(draft.maximumStock),
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
        {filteredProducts.length === 0 && (
          <p className="warehouse-empty">Nenhum produto encontrado.</p>
        )}
      </div>
    </section>
  );
}
