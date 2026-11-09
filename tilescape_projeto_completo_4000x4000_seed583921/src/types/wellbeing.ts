import {
  ADVANCED_BASKET_PRODUCT_IDS,
  BASIC_BASKET_PRODUCT_IDS,
  GOODS_BASKET_PRODUCT_IDS,
  INTERMEDIATE_BASKET_PRODUCT_IDS,
} from './commerceDemand.js';

const WELLBEING_POINTS_BY_PRODUCT = new Map<string, number>([
  ...BASIC_BASKET_PRODUCT_IDS.map((productId) => [productId, 12.5] as const),
  ...INTERMEDIATE_BASKET_PRODUCT_IDS.map((productId) => [productId, 6.25] as const),
  ...ADVANCED_BASKET_PRODUCT_IDS.map((productId) => [productId, 3] as const),
  ...GOODS_BASKET_PRODUCT_IDS.map((productId) => [productId, 6.25] as const),
]);

export const MAX_RESIDENCE_WELLBEING = [...WELLBEING_POINTS_BY_PRODUCT.values()]
  .reduce((total, points) => total + points, 0);

export interface ResidenceProductConsumption {
  productId: string;
  quantity: number;
  consumerDays: number;
}

export function calculateResidenceWellbeing(
  consumption: readonly ResidenceProductConsumption[],
  dailyDemandByProduct: ReadonlyMap<string, number>,
): number {
  const consumedByProduct = new Map<string, { quantity: number; consumerDays: number }>();
  for (const entry of consumption) {
    if (
      !Number.isFinite(entry.quantity) ||
      entry.quantity < 0 ||
      !Number.isFinite(entry.consumerDays) ||
      entry.consumerDays < 0
    ) {
      throw new RangeError('O histórico de consumo residencial contém valores inválidos.');
    }
    const total = consumedByProduct.get(entry.productId) ?? { quantity: 0, consumerDays: 0 };
    total.quantity += entry.quantity;
    total.consumerDays += entry.consumerDays;
    consumedByProduct.set(entry.productId, total);
  }

  let wellbeing = 0;
  for (const [productId, points] of WELLBEING_POINTS_BY_PRODUCT) {
    const dailyDemand = dailyDemandByProduct.get(productId);
    if (dailyDemand === undefined) {
      throw new Error(`A demanda diária não está configurada para ${productId}.`);
    }
    if (!Number.isFinite(dailyDemand) || dailyDemand < 0) {
      throw new RangeError(`A demanda diária de ${productId} é inválida.`);
    }
    if (dailyDemand === 0) continue;

    const totals = consumedByProduct.get(productId);
    if (!totals || totals.consumerDays === 0) continue;
    const fulfilledRatio = Math.min(
      1,
      totals.quantity / (totals.consumerDays * dailyDemand),
    );
    wellbeing += points * fulfilledRatio;
  }
  return wellbeing;
}

export function getWorkerTechnique(wellbeing: number): number {
  if (!Number.isFinite(wellbeing)) {
    throw new RangeError('O bem-estar residencial precisa ser um número finito.');
  }
  const score = Math.max(0, Math.min(MAX_RESIDENCE_WELLBEING, wellbeing));
  if (score <= 100) return 10 * (1 + score / 200);
  if (score <= 125) return 10 * (1.5 + (score - 100) / 50);
  if (score <= 150) return 10 * (2 + (score - 125) / 25);
  return 10 * (3 + (score - 150) / 12);
}
