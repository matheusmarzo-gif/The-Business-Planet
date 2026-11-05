export const FISH_WORK_POINTS = 100;
export const TOOL_DEMAND_PER_WORKER = 0.05;
export const INITIAL_PENALTY = 30;
export const PENALTY_STEP = 10;
export const MAX_PENALTY = 90;

/**
 * Demanda diária de Ferramentas: 0,05 por funcionário. A parte inteira é certa e a
 * fração é a probabilidade de gerar mais uma unidade (0,35 = 35% de chance de 1).
 */
export function rollToolDemand(workers: number, random: () => number = Math.random): number {
  const expected = Math.max(0, workers) * TOOL_DEMAND_PER_WORKER;
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
