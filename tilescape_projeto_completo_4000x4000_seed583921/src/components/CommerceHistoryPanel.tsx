import { formatMoney } from '../types/wallet';
import type { ShopResidenceTransaction } from '../types/commerce';
import { PRODUCTS } from '../types/product';
import { GAME_RULES } from '../generated/gameConfig';

export interface CommerceDay {
  day: string;
  employeeExpense: number;
  productExpense: number;
  unitsSold: number;
  unitsLost: number;
  salePrice: number;
  revenue: number;
  profitLoss: number;
  transactions: ShopResidenceTransaction[] | null;
}

interface CommerceHistoryPanelProps {
  title: string;
  days: CommerceDay[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const preciseDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
const preciseMoney = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const benefitFormat = new Intl.NumberFormat('pt-BR', {
  maximumSignificantDigits: 6,
  notation: 'scientific',
});
const percentFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const formatDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const formatPreciseMoney = (amount: number) => `C$ ${preciseMoney.format(amount)}`;
const outcomeText = {
  purchased: 'Comprou',
  negative_benefit: 'Benefício associado zero; não alocado',
  no_stock: 'Sem estoque',
  no_capacity: 'Sem capacidade',
  no_stock_or_capacity: 'Sem estoque e capacidade',
  demand_fulfilled: 'Demanda já atendida',
} as const;
const consumptionRules = GAME_RULES.consumption;

export default function CommerceHistoryPanel({
  title,
  days,
  isLoading,
  error,
  onClose,
}: CommerceHistoryPanelProps) {
  return (
    <section className="warehouse-panel commerce-history-panel" aria-label="Histórico do comércio">
      <div className="panel-title">
        <div className="eyebrow">COMÉRCIO</div>
        <h1>{title}</h1>
        <button type="button" className="panel-close" aria-label="Fechar histórico" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="warehouse-summary">
        Últimos 30 dias. Gastos com produtos consideram apenas pagamentos realizados; reposição interna pelo
        armazém do mesmo dono não gera cobrança. O cálculo da demanda fica salvo somente neste navegador;
        ele precisa estar conectado quando as vendas do dia forem processadas.
        {isLoading && ' Carregando…'}
      </p>
      {error && <p role="alert" className="warehouse-error">{error}</p>}
      <div className="warehouse-list">
        <div className="commerce-history-row warehouse-head">
          <span>Dia</span>
          <span>Funcionários</span>
          <span>Produtos</span>
          <span>Unidades</span>
          <span>Unidades perdidas por validade</span>
          <span>Preço/un.</span>
          <span>Receita</span>
          <span>Lucro/prejuízo</span>
          <span>Cálculo da demanda</span>
        </div>
        {!isLoading && days.length === 0 && (
          <p className="warehouse-summary">Ainda sem registros diários do comércio.</p>
        )}
        {days.map((item) => (
          <div className="commerce-history-row" key={item.day}>
            <span>{formatDay(item.day)}</span>
            <span>{formatMoney(item.employeeExpense)}</span>
            <span>{formatMoney(item.productExpense)}</span>
            <span>{integer.format(item.unitsSold)}</span>
            <span>{integer.format(item.unitsLost)}</span>
            <span>{formatMoney(item.salePrice)}</span>
            <span>{formatMoney(item.revenue)}</span>
            <span className={item.profitLoss < 0 ? 'commerce-loss' : 'commerce-profit'}>
              {formatMoney(item.profitLoss)}
            </span>
            <details className="commerce-transaction-details">
              <summary>
                {item.transactions === null ? 'Ver cálculo' : `Ver cálculo (${item.transactions.length})`}
              </summary>
              {item.transactions === null ? (
                <p>
                  Cálculo indisponível neste navegador. Ele precisava estar conectado quando as vendas
                  deste dia foram processadas.
                </p>
              ) : item.transactions.length === 0 ? (
                <p>Sem residências no raio de compra nesta data.</p>
              ) : (
                item.transactions.map((transaction) => (
                  <section key={transaction.residenceId}>
                    <strong>
                      Residência {transaction.residenceId.slice(0, 8)} · {integer.format(transaction.occupants)} moradores ·
                      {transaction.productId
                        ? `${PRODUCTS.find((product) => product.id === transaction.productId)?.name ?? transaction.productId} · `
                        : ''}
                      renda média {formatMoney(transaction.averageIncome)} · RR básica{' '}
                      {formatMoney(transaction.referenceBasketCost ?? transaction.areaAveragePrice)} · RR2 intermediária{' '}
                      {formatMoney(transaction.intermediateBasketCost ?? 0)} · RR3 avançada{' '}
                      {formatMoney(transaction.advancedBasketCost ?? 0)} · base da fórmula{' '}
                      {formatMoney(transaction.calculationBasketCost ?? transaction.referenceBasketCost ?? transaction.areaAveragePrice)} · preço médio do produto{' '}
                      {formatMoney(transaction.productAveragePrice ?? transaction.areaAveragePrice)} · necessidade diária{' '}
                      {decimal.format(transaction.expectedDemand)} · quantidade desejada total{' '}
                      {integer.format(transaction.desiredQuantity)}
                    </strong>
                    {transaction.basketBreakdown ? (
                      <details className="commerce-basket-breakdown">
                        <summary>Composição das cestas (soma diária por morador)</summary>
                        <p>
                          Cada contribuição é consumo diário configurado × preço médio municipal.
                          Produtos básicos compõem RR, intermediários RR2 e avançados RR3; a cesta
                          de bens usa a soma RR + RR2 + RR3. Os subtotais são somados sem
                          arredondamento intermediário.
                        </p>
                        {transaction.basketBreakdown.map((item) => {
                          const product = PRODUCTS.find(({ id }) => id === item.productId);
                          const unit = product?.unit === 'liter' ? 'L' : 'un.';
                          const priceSource =
                            item.priceSource === 'weighted_sales'
                              ? `média ponderada de ${integer.format(item.historicalUnitsSold)} unidades vendidas, receita ${formatPreciseMoney(item.historicalRevenue)}`
                              : item.priceSource === 'current_shop_prices'
                                ? `média dos preços anunciados em ${integer.format(item.currentShopCount)} loja(s)`
                                : 'indisponível: sem vendas nem loja/preço na cidade';
                          return (
                            <p key={item.productId}>
                              {product?.name ?? item.productId}: {preciseDecimal.format(item.dailyNeedPerPerson)}{' '}
                              {unit}/morador/dia ×{' '}
                              {item.averagePrice === null
                                ? 'sem preço'
                                : formatPreciseMoney(item.averagePrice)}{' '}
                              ={' '}
                              {item.basketContribution === null
                                ? 'não entra na cesta'
                                : formatPreciseMoney(item.basketContribution)}{' '}
                              · {item.basketType === 'goods'
                                ? 'cesta de bens'
                                : item.basketType === 'advanced'
                                ? 'RR3'
                                : item.basketType === 'intermediate'
                                  ? 'RR2'
                                  : 'RR'} · {priceSource}
                            </p>
                          );
                        })}
                        <strong>
                          RR calculado: {formatPreciseMoney(
                            transaction.basketBreakdown.reduce(
                              (total, item) =>
                                total +
                                (item.basketType !== 'basic'
                                  ? 0
                                  : item.basketContribution ?? 0),
                              0,
                            ),
                          )} · RR2 calculado: {formatPreciseMoney(
                            transaction.basketBreakdown.reduce(
                              (total, item) =>
                                total +
                                (item.basketType === 'intermediate'
                                  ? item.basketContribution ?? 0
                                  : 0),
                              0,
                            ),
                          )} · RR3 calculado: {formatPreciseMoney(
                            transaction.basketBreakdown.reduce(
                              (total, item) =>
                                total +
                                (item.basketType === 'advanced'
                                  ? item.basketContribution ?? 0
                                  : 0),
                              0,
                            ),
                          )}
                        </strong>
                      </details>
                    ) : (
                      <p>Composição detalhada das cestas não foi registrada neste diagnóstico.</p>
                    )}
                    {transaction.basketType === 'goods' ? (
                      <p>
                        Cesta básica de bens: RR_total = RR + RR2 + RR3; w = (1 − Pf / RR_total)
                        <sup>{consumptionRules.goods.wExponent}</sup>; q = (
                        {preciseDecimal.format(consumptionRules.goods.discountBase)}<sup>w</sup> − 1) × Rf;
                        benefício de erro = 0 se Rf ≤ RR_total /
                        {preciseDecimal.format(consumptionRules.goods.incomeBasketThresholdDivisor)}; caso contrário,
                        Dᵢ × ((Rf − Pf − q) / RR_total)
                        <sup>{consumptionRules.goods.errorExponent}</sup>. Benefício ideal = (Rf / RR_total −
                        1 / ({preciseDecimal.format(consumptionRules.goods.idealBasketIncomeOffsetDivisor)} × RR_total) +
                        {preciseDecimal.format(consumptionRules.goods.idealConstantOffset)})
                        <sup>{consumptionRules.goods.idealExponent}</sup>; associado = (erro / ideal)
                        <sup>{consumptionRules.goods.associatedBenefitExponent}</sup>.
                      </p>
                    ) : transaction.basketType === 'advanced' ? (
                      <p>
                        Cesta avançada: w = (1 − Pf / (RR + RR2 + RR3))
                        <sup>{consumptionRules.advanced.wExponent}</sup>; q = (
                        {preciseDecimal.format(consumptionRules.advanced.discountBase)}<sup>w</sup> − 1) × Rf;
                        benefício de erro = Dᵢ × ((Rf − Pf − q) / (RR + RR2 + RR3))
                        <sup>{consumptionRules.advanced.errorExponent}</sup> quando Rf &gt;
                        Pf + {preciseDecimal.format(consumptionRules.advanced.minimumIncomeAboveProductCost)} e
                        Rf &gt; RR/{preciseDecimal.format(consumptionRules.advanced.basicBasketThresholdDivisor)} +
                        RR2/{preciseDecimal.format(consumptionRules.advanced.intermediateBasketThresholdDivisor)} +
                        RR3/{preciseDecimal.format(consumptionRules.advanced.advancedBasketThresholdDivisor)};
                        caso contrário, zero. Benefício ideal = ((Rf −
                        {preciseDecimal.format(consumptionRules.advanced.idealIncomeOffset)}) / (RR + RR2 + RR3) −
                        1/{preciseDecimal.format(consumptionRules.advanced.idealBasketDivisor)})
                        <sup>{consumptionRules.advanced.idealExponent}</sup>; associado = (erro / ideal)
                        <sup>{consumptionRules.associatedBenefitExponent}</sup>.
                      </p>
                    ) : transaction.basketType === 'intermediate' ? (
                      <p>
                        Cesta intermediária: w = (1 − Pf / (RR + RR2))
                        <sup>{consumptionRules.intermediate.wExponent}</sup>; q = (
                        {preciseDecimal.format(consumptionRules.intermediate.discountBase)}<sup>w</sup> − 1) × Rf;
                        benefício de erro = Dᵢ × ((Rf − Pf − q) / (RR + RR2))
                        <sup>{consumptionRules.intermediate.errorExponent}</sup> quando Rf &gt;
                        Pf + {preciseDecimal.format(consumptionRules.intermediate.minimumIncomeAboveProductCost)} e
                        Rf &gt; RR/{preciseDecimal.format(consumptionRules.intermediate.basicBasketThresholdDivisor)} +
                        RR2/{preciseDecimal.format(consumptionRules.intermediate.intermediateBasketThresholdDivisor)};
                        caso contrário, zero. Benefício ideal = ((Rf −
                        {preciseDecimal.format(consumptionRules.intermediate.idealIncomeOffset)}) / (RR + RR2) −
                        1/{preciseDecimal.format(consumptionRules.intermediate.idealBasketDivisor)})
                        <sup>{consumptionRules.intermediate.idealExponent}</sup>; associado = (erro / ideal)
                        <sup>{consumptionRules.associatedBenefitExponent}</sup>.
                      </p>
                    ) : (
                      <p>
                        Cesta básica: w = (1 − Pf / RR)
                        <sup>{consumptionRules.basic.wExponent}</sup>; q = (
                        {preciseDecimal.format(consumptionRules.basic.discountBase)}<sup>w</sup> − 1) × Rf;
                        benefício de erro = Dᵢ × ((Rf − Pf − q) / RR)
                        <sup>{consumptionRules.basic.errorExponent}</sup> quando Rf ≥ Pf ×
                        {preciseDecimal.format(consumptionRules.basic.minimumIncomePriceMultiplier)}; caso contrário,
                        zero. Benefício ideal = (|Rf −
                        {preciseDecimal.format(consumptionRules.basic.idealIncomeOffset)}| / RR)
                        <sup>{consumptionRules.basic.idealExponent}</sup>; associado = (erro / ideal)
                        <sup>{consumptionRules.associatedBenefitExponent}</sup>.
                      </p>
                    )}
                    <p className="commerce-candidate-list">
                      Loja #{transaction.candidate.rank} · preço {formatMoney(transaction.candidate.price)} ·
                      distância {decimal.format(transaction.candidate.distance)} tiles · Dᵢ{' '}
                      {transaction.candidate.distanceFactor === undefined
                        ? '—'
                        : decimal.format(transaction.candidate.distanceFactor)} · Pf{' '}
                      {transaction.candidate.pf === undefined
                        ? '—'
                        : formatMoney(transaction.candidate.pf)} · w{' '}
                      {transaction.candidate.w === undefined
                        ? '—'
                        : decimal.format(transaction.candidate.w)} · q{' '}
                      {transaction.candidate.q === undefined
                        ? '—'
                        : benefitFormat.format(transaction.candidate.q)} · benefício erro{' '}
                      {transaction.candidate.errorBenefit === undefined
                        ? '—'
                        : benefitFormat.format(transaction.candidate.errorBenefit)} · benefício ideal{' '}
                      {transaction.candidate.idealBenefit === undefined
                        ? '—'
                        : benefitFormat.format(transaction.candidate.idealBenefit)} · associado{' '}
                      {benefitFormat.format(
                        transaction.candidate.associatedBenefit ?? transaction.candidate.benefit,
                      )}
                      {transaction.candidate.valuesSaturated
                        ? ' (valor saturado; proporção calculada em escala logarítmica)'
                        : ''} · participação de moradores{' '}
                      {transaction.candidate.resultShare === undefined
                        ? '—'
                        : percentFormat.format(transaction.candidate.resultShare)} (
                      {integer.format(transaction.candidate.allocatedResidents ?? 0)} pessoas) · demanda desta loja{' '}
                      {decimal.format(transaction.candidate.desiredQuantity)} · estoque disponível{' '}
                      {integer.format(transaction.candidate.stockAvailable)} · capacidade disponível{' '}
                      {integer.format(transaction.candidate.capacityAvailable)} · disponível efetivo{' '}
                      {integer.format(transaction.candidate.available)} · demanda antes{' '}
                      {integer.format(transaction.candidate.demandBefore)} · comprado{' '}
                      {integer.format(transaction.candidate.purchased)} · demanda restante{' '}
                      {integer.format(transaction.candidate.demandAfter)} · {outcomeText[transaction.candidate.outcome]}
                    </p>
                  </section>
                ))
              )}
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}
