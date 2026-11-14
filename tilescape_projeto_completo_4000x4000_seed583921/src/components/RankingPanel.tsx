import { useMemo, useState } from 'react';
import {
  Building2,
  Coins,
  Factory,
  Map,
  PackageOpen,
  ShoppingCart,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { PRODUCTS } from '../types/product';
import type {
  LeaderboardEntry,
  LeaderboardHistoryAvailability,
  LeaderboardPeriodDays,
  LeaderboardSummary,
} from '../types/leaderboard';
import { formatMoney } from '../types/wallet';

type RankingTab = 'company' | 'expansion' | 'products' | 'finance';
type ProductMetric = 'sales' | 'production';
type FinanceMetric = 'profit' | 'investment';
type RankingMetric =
  | 'company'
  | 'expansion'
  | ProductMetric
  | FinanceMetric;

interface RankingPanelProps {
  summary: LeaderboardSummary | null;
  isLoading: boolean;
  error: string;
  periodDays: LeaderboardPeriodDays;
  onPeriodChange: (days: LeaderboardPeriodDays) => void;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const dayFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDay(day: string): string {
  return dayFormatter.format(new Date(`${day}T12:00:00Z`));
}

function formatScore(score: number, metric: RankingMetric, unit: string): string {
  if (metric === 'company' || metric === 'profit' || metric === 'investment') {
    return formatMoney(score);
  }
  if (metric === 'expansion') return `${integer.format(score)} tiles`;
  return `${quantity.format(score)} ${unit}`;
}

function getHistoryStart(
  history: LeaderboardHistoryAvailability | null,
  metric: RankingMetric,
): string | null {
  if (!history) return null;
  if (metric === 'sales') return history.sales_since;
  if (metric === 'production') return history.production_since;
  if (metric === 'profit') return history.profit_since;
  if (metric === 'investment') return history.investment_since;
  return null;
}

export default function RankingPanel({
  summary,
  isLoading,
  error,
  periodDays,
  onPeriodChange,
  onClose,
}: RankingPanelProps) {
  const [activeTab, setActiveTab] = useState<RankingTab>('company');
  const [productMetric, setProductMetric] = useState<ProductMetric>('sales');
  const [financeMetric, setFinanceMetric] = useState<FinanceMetric>('profit');
  const [selectedProductId, setSelectedProductId] = useState(PRODUCTS[0]?.id ?? '');
  const selectedProduct = PRODUCTS.find((product) => product.id === selectedProductId);
  const selectedProductRanking = summary?.products.find(
    (product) => product.productId === selectedProductId,
  );
  const metric: RankingMetric =
    activeTab === 'company'
      ? 'company'
      : activeTab === 'expansion'
        ? 'expansion'
        : activeTab === 'products'
          ? productMetric
          : financeMetric;
  const entries = useMemo((): LeaderboardEntry[] => {
    if (!summary) return [];
    if (activeTab === 'company') return summary.companyValue;
    if (activeTab === 'expansion') return summary.buildingTiles;
    if (activeTab === 'products') {
      return productMetric === 'sales'
        ? selectedProductRanking?.sales ?? []
        : selectedProductRanking?.production ?? [];
    }
    return financeMetric === 'profit' ? summary.profit : summary.investment;
  }, [activeTab, financeMetric, productMetric, selectedProductRanking, summary]);
  const unit = selectedProduct?.unit === 'liter' ? 'L' : 'unidades';
  const hasProductActivity =
    (metric !== 'sales' && metric !== 'production') || entries.some((entry) => entry.score > 0);
  const historyStart = getHistoryStart(summary?.historyAvailableSince ?? null, metric);
  const periodLabel = periodDays === 30 ? 'Últimos 30 dias' : 'Último ano · 365 dias';
  const heading =
    activeTab === 'company'
      ? 'Empresa mais valorizada'
      : activeTab === 'expansion'
        ? 'Mais expansivo'
        : activeTab === 'products'
          ? `${productMetric === 'sales' ? 'Quem mais vende' : 'Quem mais produz'} · ${selectedProduct?.name ?? 'Produto'}`
          : financeMetric === 'profit'
            ? 'Maior lucro'
              : 'Maior investimento líquido';

  const tabs: { id: RankingTab; label: string; icon: typeof Building2 }[] = [
    { id: 'company', label: 'Empresa', icon: Building2 },
    { id: 'expansion', label: 'Expansão', icon: Map },
    { id: 'products', label: 'Produtos', icon: PackageOpen },
    { id: 'finance', label: 'Finanças', icon: Coins },
  ];

  return (
    <section className="warehouse-panel ranking-panel" aria-label="Painel de ranking">
      <div className="panel-title ranking-panel-title">
        <div className="ranking-heading">
          <span className="ranking-emblem"><Trophy size={20} /></span>
          <div>
            <div className="eyebrow">DISPUTAS DO REINO</div>
            <h1>Ranking</h1>
          </div>
        </div>
        <button type="button" className="panel-close" aria-label="Fechar ranking" onClick={onClose}>
          ×
        </button>
      </div>

      <p className="warehouse-summary">
        Os 30 primeiros e, quando necessário, sua posição atual. {isLoading && 'Atualizando…'}
      </p>

      <div className="ranking-tabs" role="tablist" aria-label="Categorias do ranking">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? 'active' : ''}
            key={id}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {(activeTab === 'products' || activeTab === 'finance') && (
        <div className="ranking-controls">
          <div className="ranking-subtabs" role="tablist" aria-label="Métrica do ranking">
            {activeTab === 'products' ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={productMetric === 'sales'}
                  className={productMetric === 'sales' ? 'active' : ''}
                  onClick={() => setProductMetric('sales')}
                >
                  <ShoppingCart size={14} /> Vendas
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={productMetric === 'production'}
                  className={productMetric === 'production' ? 'active' : ''}
                  onClick={() => setProductMetric('production')}
                >
                  <Factory size={14} /> Produção
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={financeMetric === 'profit'}
                  className={financeMetric === 'profit' ? 'active' : ''}
                  onClick={() => setFinanceMetric('profit')}
                >
                  <TrendingUp size={14} /> Lucro
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={financeMetric === 'investment'}
                  className={financeMetric === 'investment' ? 'active' : ''}
                  onClick={() => setFinanceMetric('investment')}
                >
                  <Coins size={14} /> Investimentos
                </button>
              </>
            )}
          </div>
          <div className="ranking-period-switch" aria-label="Período do ranking">
            {([30, 365] as const).map((days) => (
              <button
                type="button"
                key={days}
                aria-pressed={periodDays === days}
                className={periodDays === days ? 'active' : ''}
                disabled={isLoading}
                onClick={() => onPeriodChange(days)}
              >
                {days === 30 ? '30 dias' : '1 ano'}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'products' && (
        <label className="ranking-product-select">
          Produto
          <select
            value={selectedProductId}
            onChange={(event) => setSelectedProductId(event.target.value)}
          >
            {PRODUCTS.map((product) => (
              <option value={product.id} key={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="warehouse-error" role="alert">{error}</p>}

      <div className="ranking-result-heading">
        <div>
          <span className="eyebrow">{activeTab === 'company' || activeTab === 'expansion' ? 'VALORES ATUAIS' : periodLabel.toLocaleUpperCase('pt-BR')}</span>
          <h2>{heading}</h2>
        </div>
        {summary && <span className="ranking-world-day">Dia do reino · {formatDay(summary.worldDay)}</span>}
      </div>

      {activeTab === 'finance' && financeMetric === 'profit' && (
        <p className="ranking-note">
          Receitas de vendas, aluguéis e comércio entre jogadores, menos compras de produtos e folha salarial.
        </p>
      )}
      {activeTab === 'finance' && financeMetric === 'investment' && (
        <p className="ranking-note">
          Materiais de construção e upgrades aumentam o total; demolições e downgrades são subtraídos. Custos usam estimativas do jogador, com fallback para preços médios anunciados.
        </p>
      )}
      {activeTab === 'company' && (
        <p className="ranking-note">
          Materiais avaliados pelo custo estimado do jogador, com fallback para o preço médio anunciado.
        </p>
      )}
      {activeTab === 'expansion' && (
        <p className="ranking-note">
          Soma dos tiles ocupados por todas as construções do jogador, inclusive obras em andamento.
        </p>
      )}
      {periodDays === 365 && historyStart && (
        <p className="ranking-history-note">
          Dados disponíveis desde {formatDay(historyStart)}. Registros anteriores a essa data não podem ser recuperados.
        </p>
      )}

      <div className="ranking-list" aria-live="polite">
        {isLoading && !summary ? (
          <p className="ranking-empty">Carregando os rankings do mundo…</p>
        ) : !error && !hasProductActivity ? (
          <p className="ranking-empty">
            Ainda não há vendas ou produção de {selectedProduct?.name ?? 'este produto'} neste período.
          </p>
        ) : !error && entries.length > 0 ? (
          entries.map((entry) => (
            <article
              className={`ranking-entry${entry.position <= 3 ? ` podium-${entry.position}` : ''}${entry.isCurrentPlayer ? ' current-player' : ''}`}
              key={entry.playerId}
            >
              <span className="ranking-position">
                {entry.position <= 3 ? <Trophy size={14} /> : `#${entry.position}`}
              </span>
              <span className="ranking-player">
                <strong>{entry.playerName}</strong>
                {entry.isCurrentPlayer && <small>Você</small>}
              </span>
              <strong className="ranking-score">{formatScore(entry.score, metric, unit)}</strong>
            </article>
          ))
        ) : !error ? (
          <p className="ranking-empty">Nenhum jogador encontrado.</p>
        ) : null}
      </div>
    </section>
  );
}
