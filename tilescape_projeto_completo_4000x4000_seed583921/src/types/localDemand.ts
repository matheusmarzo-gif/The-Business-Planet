import { CONSUMPTION_PRODUCT_IDS } from './commerceDemand.js';

export interface LocalDemandResidence {
  id: string;
  occupants: number;
  employed: number;
  wageTotal: number;
}

export interface LocalDemandProductHistory {
  residenceId: string;
  productId: string;
  monthQuantity: number;
  monthSpent: number;
  monthConsumedQuantity: number;
  monthConsumerDays: number;
  monthDesiredQuantity: number;
  monthDesiredConsumerDays: number;
}

export interface LocalDemandProduct {
  productId: string;
  demandTotal: number;
  offerTotal: number;
  weightedPrice: number | null;
}

export interface LocalDemandSummary {
  population: number;
  employedResidents: number;
  openJobOffers: number;
  averageWage: number;
  products: LocalDemandProduct[];
}

export function calculateLocalDemandSummary(
  residences: readonly LocalDemandResidence[],
  history: readonly LocalDemandProductHistory[],
  openJobOffers: number,
): LocalDemandSummary {
  if (!Number.isSafeInteger(openJobOffers) || openJobOffers < 0) {
    throw new RangeError('O total de vagas locais é inválido.');
  }

  const residencesById = new Map<string, LocalDemandResidence>();
  let population = 0;
  let employedResidents = 0;
  let wageTotal = 0;
  for (const residence of residences) {
    if (
      !Number.isSafeInteger(residence.occupants) ||
      residence.occupants < 0 ||
      !Number.isSafeInteger(residence.employed) ||
      residence.employed < 0 ||
      !Number.isFinite(residence.wageTotal) ||
      residence.wageTotal < 0
    ) {
      throw new RangeError('Os dados de população ou emprego locais são inválidos.');
    }
    residencesById.set(residence.id, residence);
    population += residence.occupants;
    employedResidents += residence.employed;
    wageTotal += residence.wageTotal;
  }

  const totalsByProduct = new Map<
    string,
    {
      demandTotal: number;
      offerTotal: number;
      quantity: number;
      spent: number;
    }
  >();
  for (const productId of CONSUMPTION_PRODUCT_IDS) {
    totalsByProduct.set(productId, {
      demandTotal: 0,
      offerTotal: 0,
      quantity: 0,
      spent: 0,
    });
  }

  for (const entry of history) {
    const residence = residencesById.get(entry.residenceId);
    const totals = totalsByProduct.get(entry.productId);
    if (!residence || !totals) continue;
    if (
      !Number.isFinite(entry.monthQuantity) ||
      entry.monthQuantity < 0 ||
      !Number.isFinite(entry.monthSpent) ||
      entry.monthSpent < 0 ||
      !Number.isFinite(entry.monthConsumedQuantity) ||
      entry.monthConsumedQuantity < 0 ||
      !Number.isFinite(entry.monthConsumerDays) ||
      entry.monthConsumerDays < 0 ||
      !Number.isFinite(entry.monthDesiredQuantity) ||
      entry.monthDesiredQuantity < 0 ||
      !Number.isFinite(entry.monthDesiredConsumerDays) ||
      entry.monthDesiredConsumerDays < 0
    ) {
      throw new RangeError('O histórico de consumo local contém valores inválidos.');
    }
    if (entry.monthConsumerDays > 0) {
      totals.offerTotal +=
        (entry.monthConsumedQuantity / entry.monthConsumerDays) * residence.employed;
    }
    if (entry.monthDesiredConsumerDays > 0) {
      totals.demandTotal +=
        (entry.monthDesiredQuantity / entry.monthDesiredConsumerDays) * residence.employed;
    }
    totals.quantity += entry.monthQuantity;
    totals.spent += entry.monthSpent;
  }

  return {
    population,
    employedResidents,
    openJobOffers,
    averageWage: employedResidents > 0 ? wageTotal / employedResidents : 0,
    products: CONSUMPTION_PRODUCT_IDS.map((productId) => {
      const totals = totalsByProduct.get(productId);
      if (!totals) {
        throw new Error(`O produto ${productId} não tem agregação local.`);
      }
      return {
        productId,
        demandTotal: totals.demandTotal,
        offerTotal: totals.offerTotal,
        weightedPrice: totals.quantity > 0 ? totals.spent / totals.quantity : null,
      };
    }),
  };
}
