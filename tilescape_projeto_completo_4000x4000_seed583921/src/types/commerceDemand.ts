const DEMAND_PREFIXES = ['demanda_basica.', 'demanda_intermediaria.'] as const;
export const BASIC_BASKET_PRODUCT_IDS = [
  'rice',
  'wheat',
  'barley',
  'corn',
  'potato',
  'fish',
  'red_meat',
  'milk',
] as const;
export const INTERMEDIATE_BASKET_PRODUCT_IDS = [
  'sugar',
  'vegetables',
  'salt',
  'spices',
] as const;
export const CONSUMPTION_PRODUCT_IDS = [
  ...BASIC_BASKET_PRODUCT_IDS,
  ...INTERMEDIATE_BASKET_PRODUCT_IDS,
] as const;

export function parseBasicDemandConfig(contents: string): Map<string, number> {
  const multipliers = new Map<string, number>();
  const prefixByProduct = new Map<string, (typeof DEMAND_PREFIXES)[number]>();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Configuração de demanda inválida na linha ${index + 1}.`);
    }
    const key = line.slice(0, separator).trim();
    const prefix = DEMAND_PREFIXES.find((candidate) => key.startsWith(candidate));
    const productId = prefix ? key.slice(prefix.length) : '';
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
    if (prefix) prefixByProduct.set(productId, prefix);
  }
  if (multipliers.size === 0) {
    throw new Error('A configuração de demanda não define nenhum produto.');
  }
  for (const productId of CONSUMPTION_PRODUCT_IDS) {
    if (!multipliers.has(productId)) {
      throw new Error(`A configuração de demanda não define o produto ${productId}.`);
    }
  }
  for (const productId of multipliers.keys()) {
    const isBasic = (BASIC_BASKET_PRODUCT_IDS as readonly string[]).includes(productId);
    const isIntermediate = (INTERMEDIATE_BASKET_PRODUCT_IDS as readonly string[]).includes(productId);
    const expectedPrefix = isIntermediate ? DEMAND_PREFIXES[1] : DEMAND_PREFIXES[0];
    const actualPrefix = prefixByProduct.get(productId);
    if ((!isBasic && !isIntermediate) || actualPrefix !== expectedPrefix) {
      throw new Error(`O produto ${productId} está na categoria de demanda incorreta.`);
    }
  }
  return multipliers;
}
