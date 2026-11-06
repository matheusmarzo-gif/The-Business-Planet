const DEMAND_BASIC_PREFIX = 'demanda_basica.';
export const BASIC_BASKET_PRODUCT_IDS = [
  'rice',
  'wheat',
  'barley',
  'corn',
  'potato',
  'fish',
  'sugar',
  'vegetables',
  'salt',
  'spices',
  'red_meat',
  'milk',
] as const;

export function parseBasicDemandConfig(contents: string): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Configuração de demanda inválida na linha ${index + 1}.`);
    }
    const key = line.slice(0, separator).trim();
    const productId = key.startsWith(DEMAND_BASIC_PREFIX)
      ? key.slice(DEMAND_BASIC_PREFIX.length)
      : '';
    const rawValue = line.slice(separator + 1).trim();
    const value = Number(rawValue);
    if (
      !/^[a-z][a-z0-9_]*$/.test(productId) ||
      !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawValue) ||
      !Number.isFinite(value) ||
      value < 0 ||
      multipliers.has(productId)
    ) {
      throw new Error(`Configuração de demanda inválida na linha ${index + 1}.`);
    }
    multipliers.set(productId, value);
  }
  if (multipliers.size === 0) {
    throw new Error('A configuração demanda_basica não define nenhum produto.');
  }
  for (const productId of BASIC_BASKET_PRODUCT_IDS) {
    if (!multipliers.has(productId)) {
      throw new Error(`A configuração demanda_basica não define o produto ${productId}.`);
    }
  }
  return multipliers;
}
