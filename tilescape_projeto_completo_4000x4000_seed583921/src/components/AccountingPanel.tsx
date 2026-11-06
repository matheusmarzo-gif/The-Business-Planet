import { useState } from 'react';
import { PRODUCTS } from '../types/product';
import { getResidentialBuildingName } from '../types/residence';
import { formatMoney } from '../types/wallet';
import type { AccountingBuildingPosition, AccountingSummary } from '../types/accounting';

interface AccountingPanelProps {
  summary: AccountingSummary | null;
  isLoading: boolean;
  error: string;
  onViewBuilding: (building: AccountingBuildingPosition) => void;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export default function AccountingPanel({
  summary,
  isLoading,
  error,
  onViewBuilding,
  onClose,
}: AccountingPanelProps) {
  const [activeTab, setActiveTab] = useState<'shops' | 'warehouses'>('shops');

  return (
    <section className="warehouse-panel accounting-panel" aria-label="Painel contábil">
      <div className="panel-title">
        <div className="eyebrow">FINANÇAS DO JOGADOR</div>
        <h1>Contábil</h1>
        <button type="button" className="panel-close" aria-label="Fechar contábil" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Resumo dos últimos 30 dias do relógio do jogo. {isLoading && 'Carregando…'}
      </p>
      <div className="accounting-tabs" role="tablist" aria-label="Relatórios contábeis">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'shops'}
          className={activeTab === 'shops' ? 'active' : ''}
          onClick={() => setActiveTab('shops')}
        >
          Lojas comerciais
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'warehouses'}
          className={activeTab === 'warehouses' ? 'active' : ''}
          onClick={() => setActiveTab('warehouses')}
        >
          Armazéns
        </button>
      </div>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      {activeTab === 'shops' ? (
        <div className="warehouse-list accounting-list">
          <div className="accounting-row warehouse-head">
            <span>Loja</span>
            <span>Gasto com salários</span>
            <span>Receita</span>
            <span />
          </div>
          {!isLoading && !error && (summary?.shops.length ?? 0) === 0 && (
            <p className="warehouse-summary">Você ainda não possui lojas comerciais.</p>
          )}
          {summary?.shops.map((shop) => (
            <div className="accounting-row" key={shop.id}>
              <span>{getResidentialBuildingName(shop.type, shop.buildingNumber)}</span>
              <span>{formatMoney(shop.employeeExpense)}</span>
              <span>{formatMoney(shop.revenue)}</span>
              <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(shop)}>
                Visualizar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="accounting-payroll">
            Salários pagos pelos armazéns: <strong>{formatMoney(summary?.warehouse.employeeExpense ?? 0)}</strong>
          </p>
          <p className="accounting-history-note">
            O histórico de compras, vendas e salários dos armazéns começa com esta atualização; operações
            anteriores não podem ser reconstruídas.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-row accounting-warehouse-building warehouse-head">
              <span>Armazém</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.warehouse.buildings.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui armazéns.</p>
            )}
            {summary?.warehouse.buildings.map((warehouse) => (
              <div className="accounting-row accounting-warehouse-building" key={warehouse.id}>
                <span>{getResidentialBuildingName('warehouse', warehouse.buildingNumber)}</span>
                <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(warehouse)}>
                  Visualizar
                </button>
              </div>
            ))}
          </div>
          <div className="warehouse-list accounting-list">
            <div className="accounting-warehouse-row warehouse-head">
              <span>Produto</span>
              <span>Comprado</span>
              <span>Gasto</span>
              <span>Vendido</span>
              <span>Receita</span>
              <span>Lucro/prejuízo</span>
            </div>
            {!isLoading && !error && (summary?.warehouse.products.length ?? 0) === 0 && (
              <p className="warehouse-summary">Nenhuma compra ou venda de produtos registrada no período.</p>
            )}
            {summary?.warehouse.products.map((item) => {
              const product = PRODUCTS.find((entry) => entry.id === item.productId);
              return (
                <div className="accounting-warehouse-row" key={item.productId}>
                  <span>{product?.name ?? item.productId}</span>
                  <span>{integer.format(item.boughtQuantity)}</span>
                  <span>{formatMoney(item.purchaseExpense)}</span>
                  <span>{integer.format(item.soldQuantity)}</span>
                  <span>{formatMoney(item.salesRevenue)}</span>
                  <span className={item.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
                    {formatMoney(item.profitLoss)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="accounting-history-note">
            O resultado por produto é a receita das vendas menos o custo das compras; não desconta salários.
          </p>
        </>
      )}
    </section>
  );
}
