import { useMemo, useState } from 'react';
import { PRODUCTS } from '../types/product';
import { getResidentialBuildingName } from '../types/residence';
import { formatMoney } from '../types/wallet';
import {
  getAccountingPeriodLabel,
  parseAccountingWeekOffset,
  parseAccountingPeriodDays,
  type AccountingBuildingPosition,
  type AccountingPeriodDays,
  type AccountingWeekOffset,
  type AccountingSummary,
} from '../types/accounting';

interface AccountingPanelProps {
  summary: AccountingSummary | null;
  isLoading: boolean;
  error: string;
  periodDays: AccountingPeriodDays;
  onPeriodChange: (days: AccountingPeriodDays) => void;
  weekOffset: AccountingWeekOffset;
  onWeekChange: (offset: AccountingWeekOffset) => void;
  onViewBuilding: (building: AccountingBuildingPosition) => void;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const unitCost = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export default function AccountingPanel({
  summary,
  isLoading,
  error,
  periodDays,
  onPeriodChange,
  weekOffset,
  onWeekChange,
  onViewBuilding,
  onClose,
}: AccountingPanelProps) {
  const [activeTab, setActiveTab] = useState<
    'summary' | 'shops' | 'warehouses' | 'residences' | 'production' | 'products'
  >('summary');
  const [productSearch, setProductSearch] = useState('');
  const periodLabel = getAccountingPeriodLabel(periodDays);
  const weeklySummary = summary?.weeklySummary;
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase('pt-BR');
    return (summary?.products ?? []).filter((item) => {
      if (!query) return true;
      const product = PRODUCTS.find((entry) => entry.id === item.productId);
      return (product?.name ?? item.productId).toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [productSearch, summary?.products]);
  const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

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
        {activeTab === 'summary'
          ? 'O resumo mostra os resultados semanais e as estimativas atuais da empresa.'
          : `Período: ${periodLabel} do relógio do jogo.`}{' '}
        {isLoading && 'Carregando…'}
      </p>
      {activeTab !== 'summary' && (
        <label className="accounting-period">
          Período do relatório
          <select
            value={periodDays}
            disabled={isLoading}
            onChange={(event) => {
              const days = parseAccountingPeriodDays(event.target.value);
              if (days !== null) onPeriodChange(days);
            }}
          >
            <option value={1}>Último dia</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
        </label>
      )}
      <div className="accounting-tabs" role="tablist" aria-label="Relatórios contábeis">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={activeTab === 'summary' ? 'active' : ''}
          onClick={() => setActiveTab('summary')}
        >
          Resumo
        </button>
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'residences'}
          className={activeTab === 'residences' ? 'active' : ''}
          onClick={() => setActiveTab('residences')}
        >
          Residências
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'production'}
          className={activeTab === 'production' ? 'active' : ''}
          onClick={() => setActiveTab('production')}
        >
          Produção
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'products'}
          className={activeTab === 'products' ? 'active' : ''}
          onClick={() => setActiveTab('products')}
        >
          Produto
        </button>
      </div>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      {activeTab === 'summary' ? (
        <>
          <label className="accounting-period">
            Semana do relatório
            <select
              value={weekOffset}
              disabled={isLoading}
              onChange={(event) => {
                const offset = parseAccountingWeekOffset(event.target.value);
                if (offset !== null) onWeekChange(offset);
              }}
            >
              <option value={0}>Semana atual</option>
              <option value={1}>Semana anterior</option>
              <option value={2}>2 semanas antes</option>
              <option value={3}>3 semanas antes</option>
              <option value={4}>4 semanas antes</option>
            </select>
          </label>
          {weeklySummary && (
            <>
              <p className="accounting-history-note">
                Semana do jogo: {formatDay(weeklySummary.startDay)} a {formatDay(weeklySummary.endDay)}.
                As avaliações de empresa e estoque usam os preços de venda atuais configurados nos armazéns.
              </p>
              <div className="accounting-summary-grid">
                <article>
                  <span>Lucro / prejuízo da semana</span>
                  <strong className={weeklySummary.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
                    {formatMoney(weeklySummary.profitLoss)}
                  </strong>
                  <small>Receitas {formatMoney(weeklySummary.revenue)} · despesas {formatMoney(weeklySummary.expenses)}</small>
                </article>
                <article>
                  <span>Funcionários empregados</span>
                  <strong>{integer.format(weeklySummary.employees)}</strong>
                  <small>Empregos atualmente preenchidos</small>
                </article>
                <article>
                  <span>Valor estimado da empresa</span>
                  <strong>{formatMoney(weeklySummary.companyValue)}</strong>
                  <small>Custo dos materiais de construção a preços médios atuais</small>
                </article>
                <article>
                  <span>Produtos em estoque</span>
                  <strong>{formatMoney(weeklySummary.inventoryValue)}</strong>
                  <small>Estoque de armazéns e construções produtivas</small>
                </article>
              </div>
            </>
          )}
        </>
      ) : activeTab === 'shops' ? (
        <>
          <p className="accounting-history-note">
            Receita líquida estimada = receita − custo médio do produto nos armazéns da cidade no dia
            registrado × (unidades vendidas + perdidas) − salários. O custo é salvo no histórico diário e
            não muda com os preços atuais; períodos anteriores sem esse registro aparecem como indisponíveis.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-row accounting-shop-row warehouse-head">
              <span>Loja</span>
              <span>Gasto com salários</span>
              <span>Receita</span>
              <span>Unidades vendidas</span>
              <span>Unidades perdidas</span>
              <span>Receita líquida estimada</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.shops.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui lojas comerciais.</p>
            )}
            {summary?.shops.map((shop) => (
              <div className="accounting-row accounting-shop-row" key={shop.id}>
                <span>{getResidentialBuildingName(shop.type, shop.buildingNumber)}</span>
                <span>{formatMoney(shop.employeeExpense)}</span>
                <span>{formatMoney(shop.revenue)}</span>
                <span>{integer.format(shop.unitsSold)}</span>
                <span>{integer.format(shop.unitsLost)}</span>
                <span>
                  {shop.estimatedNetRevenue === null ? 'Indisponível' : formatMoney(shop.estimatedNetRevenue)}
                </span>
                <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(shop)}>
                  Visualizar
                </button>
              </div>
            ))}
          </div>
        </>
      ) : activeTab === 'warehouses' ? (
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
      ) : activeTab === 'residences' ? (
        <>
          <p className="accounting-history-note">
            A receita é o aluguel efetivamente gerado no período selecionado. Moradores são NPCs sem carteira
            individual; o valor é creditado diretamente ao proprietário. O histórico começa com esta atualização.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-four-row warehouse-head">
              <span>Residência</span>
              <span>Moradores / capacidade</span>
              <span>Aluguel gerado</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.residences.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui residências.</p>
            )}
            {summary?.residences.map((residence) => (
              <div className="accounting-four-row" key={residence.id}>
                <span>{getResidentialBuildingName(residence.type, residence.buildingNumber)}</span>
                <span>{integer.format(residence.occupants)} / {integer.format(residence.capacity)}</span>
                <span>{formatMoney(residence.rentRevenue)}</span>
                <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(residence)}>
                  Visualizar
                </button>
              </div>
            ))}
          </div>
        </>
      ) : activeTab === 'production' ? (
        <>
          <p className="accounting-history-note">
            Salários e produção somam os registros diários do período selecionado. Não há dados recuperáveis de
            salários anteriores à implantação deste histórico.
          </p>
          <div className="warehouse-list accounting-list">
            <div className="accounting-four-row warehouse-head">
              <span>Construção</span>
              <span>Gasto com salários</span>
              <span>Produção</span>
              <span />
            </div>
            {!isLoading && !error && (summary?.production.length ?? 0) === 0 && (
              <p className="warehouse-summary">Você ainda não possui construções produtivas.</p>
            )}
            {summary?.production.map((building) => {
              const product = PRODUCTS.find((entry) => entry.id === building.stockProductId);
              const produced = building.stockProductId
                ? `${integer.format(building.produced)} ${product?.name ?? building.stockProductId}`
                : integer.format(building.produced);
              return (
                <div className="accounting-four-row" key={building.id}>
                  <span>{getResidentialBuildingName(building.type, building.buildingNumber)}</span>
                  <span>{formatMoney(building.employeeExpense)}</span>
                  <span>{produced}</span>
                  <button type="button" className="accounting-view-button" onClick={() => onViewBuilding(building)}>
                    Visualizar
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <p className="accounting-history-note">
            Estoque atual e movimentações do período selecionado. Consumo inclui as residências e os insumos
            usados na produção. Custos são estimativas atualizadas diariamente, combinando Work Points,
            insumos avaliados pelo custo do dia anterior e compras de outros jogadores. A coluna lojas e perda
            de estoque soma vendas das lojas e produtos perdidos por validade no período.
          </p>
          <label className="warehouse-search accounting-product-search">
            <span>Buscar produto</span>
            <input
              type="search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Ex.: trigo, leite, madeira"
            />
          </label>
          <div className="warehouse-list accounting-list">
            <div className="accounting-product-row warehouse-head">
              <span>Produto</span>
              <span>Estoque</span>
              <span>Produzido</span>
              <span>Importado</span>
              <span>Exportado</span>
              <span>Lojas e perda de estoque</span>
              <span>Consumido</span>
              <span>Custo estimado</span>
            </div>
            {filteredProducts.map((item) => {
              const product = PRODUCTS.find((entry) => entry.id === item.productId);
              const shopsAndLoss = item.shopSalesQuantity + item.shopStockLossQuantity;
              return (
                <div className="accounting-product-row" key={item.productId}>
                  <span>{product?.name ?? item.productId}</span>
                  <span>{quantity.format(item.stockQuantity)}</span>
                  <span>{quantity.format(item.producedQuantity)}</span>
                  <span>{quantity.format(item.importedQuantity)}</span>
                  <span>{quantity.format(item.exportedQuantity)}</span>
                  <span
                    title={`Vendas nas lojas: ${quantity.format(item.shopSalesQuantity)} · Perda de estoque: ${quantity.format(item.shopStockLossQuantity)}`}
                  >
                    {quantity.format(shopsAndLoss)}
                  </span>
                  <span title={`Residências: ${quantity.format(item.residentialConsumption)} · Produção: ${quantity.format(item.productionInputConsumption)}`}>
                    {quantity.format(item.consumedQuantity)}
                  </span>
                  <span>
                    {item.unitCostEstimate === null
                      ? 'Indisponível'
                      : `C$ ${unitCost.format(item.unitCostEstimate)} / un.`}
                  </span>
                </div>
              );
            })}
            {!isLoading && !error && filteredProducts.length === 0 && (
              <p className="warehouse-empty">Nenhum produto encontrado.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
