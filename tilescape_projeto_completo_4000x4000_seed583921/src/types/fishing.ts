import type { ProductionRule } from './residence.js';
import { BUILDING_CONFIGS, GAME_RULES } from '../generated/gameConfig.js';

export const FISH_WORK_POINTS = BUILDING_CONFIGS.fishery.production.workPointsPerUnit;
export const TOOL_DEMAND_PER_WORKER = GAME_RULES.work.tools.demandPerWorkerPerDay;
export const INITIAL_PENALTY = GAME_RULES.work.tools.initialEfficiencyPenalty;
export const PENALTY_STEP = GAME_RULES.work.tools.efficiencyPenaltyStep;
export const MAX_PENALTY = GAME_RULES.work.tools.maximumEfficiencyPenalty;

/**
 * Demanda diária de Ferramentas: 0,05 por funcionário. A parte inteira é certa e a
 * fração é a probabilidade de gerar mais uma unidade (0,35 = 35% de chance de 1).
 */
export function rollToolDemand(
  workers: number,
  random: () => number = Math.random,
  perWorker: number = TOOL_DEMAND_PER_WORKER,
): number {
  const expected = Math.max(0, workers) * perWorker;
  const whole = Math.floor(expected + 1e-9);
  return whole + (random() < expected - whole ? 1 : 0);
}

/**
 * Atualiza a penalidade de eficiência: ao faltar Ferramentas ela começa em 30% e sobe
 * 10 pontos por dia até 90%; ao suprir a demanda, cai 10 pontos por dia até zerar.
 */
export function nextEfficiencyPenalty(current: number, demandMet: boolean): number {
  if (demandMet) return Math.max(0, current - PENALTY_STEP);
  return current <= 0 ? INITIAL_PENALTY : Math.min(MAX_PENALTY, current + PENALTY_STEP);
}

/**
 * Produção diária do Pesqueiro: 100 Work Points por peixe, reduzidos pela penalidade.
 * O resto de Work Points acumula para o dia seguinte; o que exceder o espaço livre do
 * estoque é perdido.
 */
export function planFishing(input: {
  progress: number;
  workPoints: number;
  penalty: number;
  freeSpace: number;
}): { fish: number; progress: number } {
  const total = input.progress + Math.max(0, input.workPoints) * (1 - input.penalty / 100);
  const possible = Math.floor(total / FISH_WORK_POINTS + 1e-9);
  const fish = Math.max(0, Math.min(possible, input.freeSpace));
  return { fish, progress: fish < possible ? 0 : Math.max(0, total - fish * FISH_WORK_POINTS) };
}

export interface ProductionInput {
  progress: number;
  workPoints: number;
  penalty: number;
  freeSpace: number;
  wood?: number;
  iron?: number;
  charcoal?: number;
  tools?: number;
  batchStock?: number;
  inputStocks?: Readonly<Record<string, number>>;
}

export interface ProductionResult {
  units: number;
  progress: number;
  woodUsed: number;
  ironUsed: number;
  charcoalUsed: number;
  toolsUsed: number;
  batchStockUsed: number;
  inputStocksUsed: Record<string, number>;
}

/**
 * Produção diária de uma construção produtiva. Os Work Points são reduzidos pela
 * penalidade de Ferramentas. Veja `ProductionRule` para os três modos.
 */
export function planProduction(
  rule: ProductionRule,
  input: ProductionInput,
  random: () => number = Math.random,
): ProductionResult {
  const free = Math.max(0, input.freeSpace);
  const effective = Math.max(0, input.workPoints) * (1 - input.penalty / 100);
  const roundExpected = (expected: number) => {
    const whole = Math.floor(expected + 1e-9);
    const fraction = Math.max(0, expected - whole);
    return whole + (fraction > 0 && random() < fraction ? 1 : 0);
  };
  if (rule.mode === 'accumulate') {
    const total = input.progress + effective;
    const possible = Math.floor(total / rule.workPointsPerUnit + 1e-9);
    const units = Math.max(0, Math.min(possible, free));
    return {
      units,
      progress: units < possible ? 0 : Math.max(0, total - units * rule.workPointsPerUnit),
      woodUsed: 0,
      ironUsed: 0,
      charcoalUsed: 0,
      toolsUsed: 0,
      batchStockUsed: 0,
      inputStocksUsed: {},
    };
  }
  if (rule.mode === 'chance') {
    const expected = effective / rule.workPointsPerUnit;
    const whole = Math.floor(expected + 1e-9);
    const units = whole + (random() < expected - whole ? 1 : 0);
    return {
      units: Math.min(units, free),
      progress: 0,
      woodUsed: 0,
      ironUsed: 0,
      charcoalUsed: 0,
      toolsUsed: 0,
      batchStockUsed: 0,
      inputStocksUsed: {},
    };
  }
  if (rule.batchInputs || rule.batchInputRates) {
    const total = input.progress + effective;
    const batchSize = rule.batchSize ?? 1;
    const requestedCycles = Math.min(
      total / rule.workPointsPerUnit,
      free / batchSize,
    );
    const requiredInputs = rule.batchInputs ?? {};
    const cycles = Object.entries(requiredInputs).reduce((availableCycles, [productId, amount]) => {
      if (amount <= 0) return availableCycles;
      const availableStock =
        productId === 'charcoal'
          ? input.charcoal ?? 0
          : productId === 'tools'
            ? input.tools ?? 0
            : input.inputStocks?.[productId] ?? 0;
      return Math.min(availableCycles, availableStock / amount);
    }, requestedCycles);
    const inputStocksUsed: Record<string, number> = {};
    for (const [productId, amount] of Object.entries(requiredInputs)) {
      inputStocksUsed[productId] = Math.min(
        productId === 'charcoal'
          ? input.charcoal ?? 0
          : productId === 'tools'
            ? input.tools ?? 0
            : input.inputStocks?.[productId] ?? 0,
        roundExpected(cycles * amount),
      );
    }
    for (const [productId, rate] of Object.entries(rule.batchInputRates ?? {})) {
      const availableStock =
        productId === 'charcoal'
          ? input.charcoal ?? 0
          : productId === 'tools'
            ? input.tools ?? 0
            : input.inputStocks?.[productId] ?? 0;
      const expectedUse = roundExpected(cycles * rate);
      const currentUse = inputStocksUsed[productId] ?? 0;
      inputStocksUsed[productId] = currentUse + Math.min(
        Math.max(0, availableStock - currentUse),
        expectedUse,
      );
    }
    const units = Math.min(free, roundExpected(cycles * batchSize));
    const blockedByCapacityOrInputs = cycles + 1e-9 < total / rule.workPointsPerUnit;
    return {
      units,
      progress: blockedByCapacityOrInputs
        ? 0
        : Math.max(0, total - cycles * rule.workPointsPerUnit),
      woodUsed: inputStocksUsed.wood ?? 0,
      ironUsed: inputStocksUsed.iron ?? 0,
      charcoalUsed: inputStocksUsed.charcoal ?? 0,
      toolsUsed: inputStocksUsed.tools ?? 0,
      batchStockUsed: 0,
      inputStocksUsed,
    };
  }
  const batchSize = rule.batchSize ?? 1;
  const batchWood = rule.batchWood ?? 0;
  const batchIron = rule.batchIron ?? 0;
  const batchCharcoal = rule.batchCharcoal ?? 0;
  const batchTools = rule.batchTools ?? 0;
  const batchStock = rule.batchStockAmount ?? 0;
  const total = input.progress + effective;
  const wanted = Math.floor(total / rule.workPointsPerUnit + 1e-9);
  const batches = Math.max(
    0,
    Math.min(
      wanted,
      Math.floor(free / batchSize),
      batchWood > 0 ? Math.floor((input.wood ?? 0) / batchWood) : Infinity,
      batchIron > 0 ? Math.floor((input.iron ?? 0) / batchIron) : Infinity,
      batchCharcoal > 0 ? Math.floor((input.charcoal ?? 0) / batchCharcoal) : Infinity,
      batchTools > 0 ? Math.floor((input.tools ?? 0) / batchTools) : Infinity,
      batchStock > 0 ? Math.floor((input.batchStock ?? 0) / batchStock) : Infinity,
    ),
  );
  return {
    units: batches * batchSize,
    progress: batches < wanted ? 0 : total - batches * rule.workPointsPerUnit,
    woodUsed: batches * batchWood,
    ironUsed: batches * batchIron,
    charcoalUsed: batches * batchCharcoal,
    toolsUsed: batches * batchTools,
    batchStockUsed: batches * batchStock,
    inputStocksUsed: {},
  };
}
