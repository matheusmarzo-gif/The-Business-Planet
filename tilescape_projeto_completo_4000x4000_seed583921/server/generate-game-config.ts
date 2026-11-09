import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBasicDemandConfig } from '../src/types/commerceDemand.js';
import { PRODUCTS } from '../src/types/product.js';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const configDirectory = resolve(appDirectory, 'config');
const buildingDirectory = resolve(configDirectory, 'construcoes');
const generatedFile = resolve(appDirectory, 'src/generated/gameConfig.ts');
const expectedBuildingIds = [
  'charcoal_works',
  'bread_factory',
  'cheese_factory',
  'chocolate_factory',
  'farm_cotton',
  'farm_sheep',
  'furniture_factory',
  'glass_factory',
  'farm_barley',
  'farm_cane',
  'farm_cattle',
  'farm_cocoa',
  'farm_corn',
  'farm_dairy',
  'farm_fruit',
  'farm_potato',
  'farm_rice',
  'farm_spices',
  'farm_vegetables',
  'farm_wheat',
  'flour_mill',
  'fishery',
  'house_poor1',
  'house_poor2',
  'house_poor3',
  'iron_mine',
  'lumber_mill',
  'quarry',
  'salt_gatherer',
  'sand_pit',
  'shop_barley',
  'shop_bread',
  'shop_butcher',
  'shop_cheese',
  'shop_chocolate',
  'shop_clothing',
  'shop_corn',
  'shop_fish',
  'shop_fruit',
  'shop_furniture',
  'shop_glass',
  'shop_milk',
  'shop_potato',
  'shop_rice',
  'shop_salt',
  'shop_spices',
  'shop_sugar',
  'shop_vegetables',
  'shop_utilities',
  'shop_wheat',
  'steelworks',
  'sugar_mill',
  'textile_factory',
  'thread_factory',
  'toolmaker',
  'utilities_factory',
  'warehouse',
  'silo',
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Configuração inválida em ${path}: ${message}`);
}

function readNumber(config: JsonRecord, path: string): number {
  let value: unknown = config;
  for (const part of path.split('.')) {
    if (!isRecord(value) || !(part in value)) fail(path, 'campo numérico obrigatório ausente.');
    value = value[part];
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'o valor precisa ser um número finito.');
  }
  return value;
}

function readRecord(config: JsonRecord, path: string): JsonRecord {
  let value: unknown = config;
  for (const part of path.split('.')) {
    if (!isRecord(value) || !(part in value)) fail(path, 'objeto obrigatório ausente.');
    value = value[part];
  }
  if (!isRecord(value)) fail(path, 'o valor precisa ser um objeto.');
  return value;
}

function requirePositive(config: JsonRecord, path: string): void {
  if (readNumber(config, path) <= 0) fail(path, 'o valor precisa ser maior que zero.');
}

function validateKeys(
  value: unknown,
  path: string,
  requiredKeys: string[],
  optionalKeys: string[] = [],
): asserts value is JsonRecord {
  if (!isRecord(value)) fail(path, 'o conteúdo precisa ser um objeto.');
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) {
    if (!(key in value)) fail(path, `campo obrigatório "${key}" ausente.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `campo "${key}" não é reconhecido.`);
  }
}

function parseJsonFile(contents: string, path: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(path, `JSON inválido (${detail}).`);
  }
  if (!isRecord(value)) fail(path, 'o conteúdo precisa ser um objeto JSON.');
  return value;
}

function validateFourNumbers(value: unknown, path: string, minimum: number): void {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry) || entry < minimum)
  ) {
    fail(path, 'o valor precisa conter exatamente quatro números válidos.');
  }
}

function validateBuilding(value: JsonRecord, buildingId: string): void {
  const path = `config/construcoes/${buildingId}.txt`;
  const required = [
    'type',
    'kind',
    'requiredZone',
    'requiresRoad',
    'name',
    'asset',
    'width',
    'height',
    'capacity',
    'localAppeal',
    'cost',
    'workPoints',
    'maxWorkers',
  ];
  validateKeys(value, path, required, [
    'stockProduct',
    'stockProductId',
    'stockCapacity',
    'cropRule',
    'toolCapacity',
    'woodCapacity',
    'ironCapacity',
    'charcoalCapacity',
    'sugarcaneCapacity',
    'toolCapacity',
    'inputCapacities',
    'selectableInputProductIds',
    'defaultInputProductId',
    'salesPerWorkerPerDay',
    'salesWorkPointsPerUnit',
    'toolDemandPerWorker',
    'production',
    'requiresWater',
    'requiresAdjacentWater',
    'storageCapacityM3',
    'allowedStorageProductIds',
    'dairyEfficiencyByQuarter',
  ]);
  if (value.type !== buildingId) fail(path, `o campo type precisa ser "${buildingId}".`);
  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.asset !== 'string' ||
    !value.asset.startsWith('/buildings/')
  ) {
    fail(path, 'nome ou URL pública da imagem inválidos.');
  }
  if (
    !['residence', 'farm', 'shop', 'warehouse', 'fishery', 'resource', 'workshop', 'industry'].includes(
      String(value.kind),
    ) ||
    !['urban', 'rural'].includes(String(value.requiredZone)) ||
    typeof value.requiresRoad !== 'boolean'
  ) {
    fail(path, 'kind, requiredZone ou requiresRoad inválidos.');
  }
  for (const field of ['width', 'height', 'workPoints']) {
    requirePositive(value, field);
  }
  for (const field of ['width', 'height', 'maxWorkers']) {
    const number = readNumber(value, field);
    if (!Number.isInteger(number) || number < (field === 'maxWorkers' ? 0 : 1)) {
      fail(path, `"${field}" precisa ser um inteiro válido.`);
    }
  }
  for (const field of ['capacity', 'localAppeal', 'maxWorkers']) {
    if (readNumber(value, field) < 0) fail(path, `"${field}" não pode ser negativo.`);
  }
  validateKeys(value.cost, `${path}:cost`, ['wood', 'stone'], ['iron', 'steel']);
  for (const material of ['wood', 'stone', 'iron', 'steel']) {
    const amount = value.cost[material] ?? 0;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      fail(path, `custo de "${material}" inválido.`);
    }
  }
  if ('stockProductId' in value) {
    if (
      typeof value.stockProductId !== 'string' ||
      typeof value.stockProduct !== 'string' ||
      typeof value.stockCapacity !== 'number' ||
      !Number.isFinite(value.stockCapacity) ||
      value.stockCapacity < 0
    ) {
      fail(path, 'produto principal e capacidade de estoque precisam estar completos.');
    }
  }
  for (const field of [
    'stockCapacity',
    'toolCapacity',
    'woodCapacity',
    'ironCapacity',
    'charcoalCapacity',
    'sugarcaneCapacity',
    'toolDemandPerWorker',
    'storageCapacityM3',
  ]) {
    if (field in value && (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0)) {
      fail(path, `"${field}" precisa ser um número não negativo.`);
    }
    if ('allowedStorageProductIds' in value) {
      const productIds = value.allowedStorageProductIds;
      const knownProductIds = new Set(PRODUCTS.map((product) => product.id));
      if (
        value.kind !== 'warehouse' ||
        !Array.isArray(productIds) ||
        productIds.length === 0 ||
        productIds.some((productId) => typeof productId !== 'string' || !knownProductIds.has(productId)) ||
        new Set(productIds).size !== productIds.length
      ) {
        fail(path, '"allowedStorageProductIds" precisa listar produtos únicos existentes em um tipo warehouse.');
      }
    }
  }
  if ('inputCapacities' in value) {
    if (!isRecord(value.inputCapacities)) fail(path, '"inputCapacities" precisa ser um objeto.');
    for (const [productId, capacity] of Object.entries(value.inputCapacities)) {
      if (
        !/^[a-z][a-z0-9_]*$/.test(productId) ||
        typeof capacity !== 'number' ||
        !Number.isFinite(capacity) ||
        capacity <= 0
      ) {
        fail(path, '"inputCapacities" precisa mapear produtos para capacidades positivas.');
      }
    }
  }
  if ('selectableInputProductIds' in value) {
    const selectable = value.selectableInputProductIds;
    const inputCapacities = isRecord(value.inputCapacities) ? value.inputCapacities : {};
    if (
      !Array.isArray(selectable) ||
      selectable.length === 0 ||
      selectable.some((productId) => typeof productId !== 'string' || !(productId in inputCapacities)) ||
      new Set(selectable).size !== selectable.length
    ) {
      fail(path, '"selectableInputProductIds" precisa listar entradas únicas de inputCapacities.');
    }
  }
  if (
    'defaultInputProductId' in value &&
    (typeof value.defaultInputProductId !== 'string' ||
      !Array.isArray(value.selectableInputProductIds) ||
      !value.selectableInputProductIds.includes(value.defaultInputProductId))
  ) {
    fail(path, '"defaultInputProductId" precisa ser uma das matérias-primas selecionáveis.');
  }
  if (
    'salesPerWorkerPerDay' in value &&
    (typeof value.salesPerWorkerPerDay !== 'number' ||
      !Number.isInteger(value.salesPerWorkerPerDay) ||
      value.salesPerWorkerPerDay <= 0)
  ) {
    fail(path, '"salesPerWorkerPerDay" precisa ser um inteiro positivo.');
  }
  if (
    'salesWorkPointsPerUnit' in value &&
    (typeof value.salesWorkPointsPerUnit !== 'number' ||
      !Number.isFinite(value.salesWorkPointsPerUnit) ||
      value.salesWorkPointsPerUnit <= 0)
  ) {
    fail(path, '"salesWorkPointsPerUnit" precisa ser um número positivo.');
  }
  if ('requiresWater' in value && typeof value.requiresWater !== 'boolean') {
    fail(path, '"requiresWater" precisa ser booleano.');
  }
  if ('requiresAdjacentWater' in value && typeof value.requiresAdjacentWater !== 'boolean') {
    fail(path, '"requiresAdjacentWater" precisa ser booleano.');
  }
  if ('production' in value) {
    validateKeys(
      value.production,
      `${path}:production`,
      ['mode', 'workPointsPerUnit'],
      [
        'batchSize',
        'batchWood',
        'batchIron',
        'batchCharcoal',
        'batchTools',
        'batchStockProductId',
        'batchStockAmount',
        'batchInputs',
        'batchInputRates',
      ],
    );
    if (!['accumulate', 'chance', 'batch'].includes(String(value.production.mode))) {
      fail(path, 'modo de produção inválido.');
    }
    if (
      typeof value.production.workPointsPerUnit !== 'number' ||
      !Number.isFinite(value.production.workPointsPerUnit) ||
      value.production.workPointsPerUnit <= 0
    ) {
      fail(path, 'production.workPointsPerUnit precisa ser maior que zero.');
    }
    if (
      value.production.mode === 'batch' &&
      !('batchInputs' in value.production) &&
      !('batchInputRates' in value.production)
    ) {
      requirePositive(value.production, 'batchSize');
    }
    for (const field of [
      'batchSize',
      'batchWood',
      'batchIron',
      'batchCharcoal',
      'batchTools',
      'batchStockAmount',
    ]) {
      if (
        field in value.production &&
        (typeof value.production[field] !== 'number' ||
          !Number.isFinite(value.production[field]) ||
          value.production[field] < 0)
      ) {
        fail(path, `production.${field} precisa ser um número não negativo.`);
      }
    }
    if (
      'batchStockProductId' in value.production &&
      typeof value.production.batchStockProductId !== 'string'
    ) {
      fail(path, 'production.batchStockProductId precisa ser um identificador.');
    }
    for (const field of ['batchInputs', 'batchInputRates']) {
      if (!(field in value.production)) continue;
      const inputs = value.production[field];
      if (!isRecord(inputs)) fail(path, `production.${field} precisa ser um objeto.`);
      for (const [productId, amount] of Object.entries(inputs)) {
        if (
          !/^[a-z][a-z0-9_]*$/.test(productId) ||
          typeof amount !== 'number' ||
          !Number.isFinite(amount) ||
          amount <= 0
        ) {
          fail(path, `production.${field} precisa mapear produtos para quantidades positivas.`);
        }
      }
    }
  }
  if ('cropRule' in value) {
    validateKeys(value.cropRule, `${path}:cropRule`, [
      'growthMonths',
      'dailyWorkPoints',
      'harvestWorkPointsPerUnit',
      'baseYield',
      'plantingEfficiencyByQuarter',
    ]);
    for (const field of [
      'growthMonths',
      'dailyWorkPoints',
      'harvestWorkPointsPerUnit',
      'baseYield',
    ]) {
      const number = value.cropRule[field];
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
        fail(path, `cropRule.${field} precisa ser um número não negativo.`);
      }
    }
    if (
      !Number.isInteger(readNumber(value, 'cropRule.growthMonths')) ||
      readNumber(value, 'cropRule.growthMonths') <= 0 ||
      readNumber(value, 'cropRule.dailyWorkPoints') <= 0 ||
      readNumber(value, 'cropRule.harvestWorkPointsPerUnit') <= 0
    ) {
      fail(path, 'os meses de crescimento e requisitos de Work Points precisam ser positivos.');
    }
    validateFourNumbers(
      value.cropRule.plantingEfficiencyByQuarter,
      `${path}:cropRule.plantingEfficiencyByQuarter`,
      0,
    );
  }
  if ('dairyEfficiencyByQuarter' in value) {
    validateFourNumbers(value.dairyEfficiencyByQuarter, `${path}:dairyEfficiencyByQuarter`, 0);
  }
  if (buildingId === 'farm_dairy' && !('dairyEfficiencyByQuarter' in value)) {
    fail(path, 'dairyEfficiencyByQuarter é obrigatório para a Fazenda Leiteira.');
  }
}

function validateFormulaConfig(
  config: JsonRecord,
  path: string,
  positiveFields: string[],
): void {
  for (const field of positiveFields) requirePositive(config, field);
}

async function loadFormulaConfig(filename: string): Promise<JsonRecord> {
  const relativePath = `config/formulas/${filename}`;
  const contents = await readFile(resolve(configDirectory, 'formulas', filename), 'utf8');
  return parseJsonFile(contents, relativePath);
}

async function generateGameConfig(): Promise<void> {
  const buildingFiles = (await readdir(buildingDirectory))
    .filter((filename) => filename.endsWith('.txt'))
    .map((filename) => filename.slice(0, -4))
    .sort();
  const expected = [...expectedBuildingIds].sort();
  if (JSON.stringify(buildingFiles) !== JSON.stringify(expected)) {
    throw new Error(
      `O catálogo de config/construcoes precisa conter exatamente: ${expected.join(', ')}.`,
    );
  }

  const buildings: Record<string, JsonRecord> = {};
  for (const buildingId of buildingFiles) {
    const path = `config/construcoes/${buildingId}.txt`;
    const contents = await readFile(resolve(buildingDirectory, `${buildingId}.txt`), 'utf8');
    const building = parseJsonFile(contents, path);
    validateBuilding(building, buildingId);
    buildings[buildingId] = building;
  }

  const formulas = {
    consumption: await loadFormulaConfig('consumo.txt'),
    work: await loadFormulaConfig('trabalho.txt'),
    transport: await loadFormulaConfig('transporte.txt'),
  };
  validateKeys(
    formulas.consumption,
    'config/formulas/consumo.txt',
    [
      'averagePriceWindowDays',
      'distance',
      'salesCapacity',
      'basic',
      'intermediate',
      'advanced',
      'goods',
      'associatedBenefitExponent',
    ],
  );
  validateKeys(
    readRecord(formulas.consumption, 'distance'),
    'config/formulas/consumo.txt:distance',
    ['radiusTiles', 'radicandNumerator'],
  );
  validateKeys(
    readRecord(formulas.consumption, 'salesCapacity'),
    'config/formulas/consumo.txt:salesCapacity',
    ['unitWorkPointsPerSale', 'literWorkPointsPerSale'],
  );
  validateKeys(
    readRecord(formulas.consumption, 'basic'),
    'config/formulas/consumo.txt:basic',
    [
      'discountBase',
      'wExponent',
      'errorExponent',
      'minimumIncomePriceMultiplier',
      'idealIncomeOffset',
      'idealExponent',
    ],
  );
  validateKeys(
    readRecord(formulas.consumption, 'intermediate'),
    'config/formulas/consumo.txt:intermediate',
    [
      'discountBase',
      'wExponent',
      'errorExponent',
      'minimumIncomeAboveProductCost',
      'basicBasketThresholdDivisor',
      'intermediateBasketThresholdDivisor',
      'idealIncomeOffset',
      'idealBasketDivisor',
      'idealExponent',
    ],
  );
  validateKeys(
    readRecord(formulas.consumption, 'advanced'),
    'config/formulas/consumo.txt:advanced',
    [
      'discountBase',
      'wExponent',
      'errorExponent',
      'minimumIncomeAboveProductCost',
      'basicBasketThresholdDivisor',
      'intermediateBasketThresholdDivisor',
      'advancedBasketThresholdDivisor',
      'idealIncomeOffset',
      'idealBasketDivisor',
      'idealExponent',
    ],
  );
  validateKeys(
    readRecord(formulas.consumption, 'goods'),
    'config/formulas/consumo.txt:goods',
    [
      'discountBase',
      'wExponent',
      'errorExponent',
      'incomeBasketThresholdDivisor',
      'idealBasketIncomeOffsetDivisor',
      'idealConstantOffset',
      'idealExponent',
      'associatedBenefitExponent',
    ],
  );
  validateKeys(
    formulas.work,
    'config/formulas/trabalho.txt',
    [
      'workerSearchRadiusTiles',
      'maxConstructionWorkers',
      'workPointsPerHour',
      'hoursFactor',
      'distanceFactor',
      'restFactor',
      'hours',
      'wage',
      'rent',
      'residentStats',
      'tools',
    ],
  );
  validateKeys(
    readRecord(formulas.work, 'hoursFactor'),
    'config/formulas/trabalho.txt:hoursFactor',
    ['optimalHours', 'deviationScaleHours', 'penalty', 'benefitExponent'],
  );
  validateKeys(
    readRecord(formulas.work, 'distanceFactor'),
    'config/formulas/trabalho.txt:distanceFactor',
    ['radiusTiles', 'radicandNumerator'],
  );
  validateKeys(
    readRecord(formulas.work, 'restFactor'),
    'config/formulas/trabalho.txt:restFactor',
    [
      'shortDayHours',
      'standardDayHours',
      'longDayHours',
      'shortDayValue',
      'standardDayValue',
      'longDayValue',
    ],
  );
  validateKeys(
    readRecord(formulas.work, 'hours'),
    'config/formulas/trabalho.txt:hours',
    ['minimum', 'maximum', 'default'],
  );
  validateKeys(
    readRecord(formulas.work, 'wage'),
    'config/formulas/trabalho.txt:wage',
    ['default', 'maximum'],
  );
  validateKeys(
    readRecord(formulas.work, 'rent'),
    'config/formulas/trabalho.txt:rent',
    ['default', 'minimum', 'maximum'],
  );
  validateKeys(
    readRecord(formulas.work, 'residentStats'),
    'config/formulas/trabalho.txt:residentStats',
    ['skill', 'health', 'happiness'],
  );
  validateKeys(
    readRecord(formulas.work, 'tools'),
    'config/formulas/trabalho.txt:tools',
    [
      'demandPerWorkerPerDay',
      'initialEfficiencyPenalty',
      'efficiencyPenaltyStep',
      'maximumEfficiencyPenalty',
    ],
  );
  validateKeys(
    formulas.transport,
    'config/formulas/transporte.txt',
    ['workPointsPerCubicMeter', 'workPointsPerKilogram', 'linkRadiusTiles'],
  );
  validateFormulaConfig(formulas.consumption, 'config/formulas/consumo.txt', [
    'averagePriceWindowDays',
    'distance.radiusTiles',
    'distance.radicandNumerator',
    'salesCapacity.unitWorkPointsPerSale',
    'salesCapacity.literWorkPointsPerSale',
    'basic.discountBase',
    'basic.wExponent',
    'basic.errorExponent',
    'basic.minimumIncomePriceMultiplier',
    'basic.idealExponent',
    'intermediate.discountBase',
    'intermediate.wExponent',
    'intermediate.errorExponent',
    'intermediate.minimumIncomeAboveProductCost',
    'intermediate.basicBasketThresholdDivisor',
    'intermediate.intermediateBasketThresholdDivisor',
    'intermediate.idealBasketDivisor',
    'intermediate.idealExponent',
    'advanced.discountBase',
    'advanced.wExponent',
    'advanced.errorExponent',
    'advanced.minimumIncomeAboveProductCost',
    'advanced.basicBasketThresholdDivisor',
    'advanced.intermediateBasketThresholdDivisor',
    'advanced.idealIncomeOffset',
    'advanced.advancedBasketThresholdDivisor',
    'advanced.idealBasketDivisor',
    'advanced.idealExponent',
    'associatedBenefitExponent',
  ]);
  validateFormulaConfig(formulas.work, 'config/formulas/trabalho.txt', [
    'workerSearchRadiusTiles',
    'maxConstructionWorkers',
    'workPointsPerHour',
    'hoursFactor.optimalHours',
    'hoursFactor.deviationScaleHours',
    'hoursFactor.benefitExponent',
    'distanceFactor.radiusTiles',
    'distanceFactor.radicandNumerator',
    'restFactor.shortDayHours',
    'restFactor.standardDayHours',
    'restFactor.longDayHours',
    'restFactor.shortDayValue',
    'restFactor.standardDayValue',
    'restFactor.longDayValue',
    'hours.minimum',
    'hours.maximum',
    'wage.maximum',
    'rent.default',
    'rent.minimum',
    'rent.maximum',
    'residentStats.skill',
    'residentStats.health',
    'residentStats.happiness',
    'tools.demandPerWorkerPerDay',
    'tools.efficiencyPenaltyStep',
    'tools.maximumEfficiencyPenalty',
  ]);
  validateFormulaConfig(formulas.transport, 'config/formulas/transporte.txt', [
    'workPointsPerCubicMeter',
    'workPointsPerKilogram',
    'linkRadiusTiles',
  ]);

  for (const path of [
    'consumption.averagePriceWindowDays',
    'consumption.basic.wExponent',
    'consumption.basic.errorExponent',
    'consumption.basic.idealExponent',
    'consumption.intermediate.wExponent',
    'consumption.intermediate.errorExponent',
    'consumption.intermediate.idealExponent',
    'consumption.advanced.wExponent',
    'consumption.advanced.errorExponent',
    'consumption.advanced.idealExponent',
    'consumption.goods.wExponent',
    'consumption.goods.errorExponent',
    'consumption.goods.incomeBasketThresholdDivisor',
    'consumption.goods.idealBasketIncomeOffsetDivisor',
    'consumption.goods.idealExponent',
    'consumption.goods.associatedBenefitExponent',
    'consumption.associatedBenefitExponent',
    'work.hoursFactor.benefitExponent',
    'work.hours.minimum',
    'work.hours.maximum',
    'work.hours.default',
    'work.maxConstructionWorkers',
  ]) {
    if (!Number.isInteger(readNumber(formulas, path))) {
      throw new Error(`${path} precisa ser um número inteiro.`);
    }
  }
  if (readNumber(formulas, 'consumption.associatedBenefitExponent') % 2 !== 0) {
    throw new Error('consumption.associatedBenefitExponent precisa ser par.');
  }
  if (readNumber(formulas, 'consumption.goods.associatedBenefitExponent') % 2 !== 0) {
    throw new Error('consumption.goods.associatedBenefitExponent precisa ser par.');
  }
  for (const path of [
    'consumption.goods.wExponent',
    'consumption.goods.errorExponent',
    'consumption.goods.idealExponent',
  ]) {
    if (readNumber(formulas, path) % 2 !== 1) {
      throw new Error(`${path} precisa ser ímpar para manter a fórmula da cesta de bens.`);
    }
  }
  for (const path of ['consumption.basic.errorExponent', 'consumption.basic.idealExponent']) {
    if (readNumber(formulas, path) % 2 !== 0) {
      throw new Error(`${path} precisa ser par para manter os benefícios não negativos.`);
    }
  }
  for (const path of [
    'consumption.intermediate.errorExponent',
    'consumption.intermediate.idealExponent',
  ]) {
    if (readNumber(formulas, path) % 2 !== 1) {
      throw new Error(`${path} precisa ser ímpar para manter a fórmula intermediária.`);
    }
    for (const path of ['consumption.advanced.errorExponent', 'consumption.advanced.idealExponent']) {
      if (readNumber(formulas, path) % 2 !== 0) {
        throw new Error(`${path} precisa ser par para manter os benefícios não negativos.`);
      }
    }
  }
  for (const path of [
    'consumption.basic.discountBase',
    'consumption.intermediate.discountBase',
    'consumption.advanced.discountBase',
    'consumption.goods.discountBase',
  ]) {
    const discountBase = readNumber(formulas, path);
    if (discountBase >= 1) throw new Error(`${path} precisa ser menor que 1.`);
  }
  for (const path of [
    'consumption.basic.idealIncomeOffset',
    'consumption.intermediate.idealIncomeOffset',
    'consumption.advanced.idealIncomeOffset',
    'consumption.goods.idealConstantOffset',
    'work.hoursFactor.penalty',
    'work.wage.default',
    'work.rent.default',
    'work.tools.initialEfficiencyPenalty',
    'work.wage.default',
    'work.hours.default',
  ]) {
    if (readNumber(formulas, path) < 0) throw new Error(`${path} não pode ser negativo.`);
  }
  if (readNumber(formulas, 'work.hours.minimum') > readNumber(formulas, 'work.hours.maximum')) {
    throw new Error('A configuração de horas de trabalho tem limites invertidos.');
  }
  if (
    readNumber(formulas, 'work.hours.default') < readNumber(formulas, 'work.hours.minimum') ||
    readNumber(formulas, 'work.hours.default') > readNumber(formulas, 'work.hours.maximum')
  ) {
    throw new Error('A carga horária padrão precisa estar dentro dos limites configurados.');
  }
  if (
    readNumber(formulas, 'work.restFactor.shortDayHours') >=
    readNumber(formulas, 'work.restFactor.standardDayHours') ||
    readNumber(formulas, 'work.restFactor.standardDayHours') >=
    readNumber(formulas, 'work.restFactor.longDayHours')
  ) {
    throw new Error('Os pontos de referência do fator de descanso precisam estar em ordem.');
  }
  if (
    readNumber(formulas, 'work.tools.initialEfficiencyPenalty') >
    readNumber(formulas, 'work.tools.maximumEfficiencyPenalty')
  ) {
    throw new Error('A penalidade inicial de Ferramentas excede o máximo configurado.');
  }

  const demandConfig = await readFile(resolve(configDirectory, 'demanda_basica.txt'), 'utf8');
  parseBasicDemandConfig(demandConfig);
  const farmRules = Object.fromEntries(
    Object.entries(buildings)
      .filter(([, building]) => 'cropRule' in building)
      .map(([buildingId, building]) => [buildingId, building.cropRule]),
  );
  if (Object.keys(farmRules).length === 0) {
    throw new Error('Nenhuma regra de cultivo foi definida nos arquivos das construções.');
  }

  const generated = [
    `export const BUILDING_CONFIGS = ${JSON.stringify(buildings, null, 2)} as const;`,
    `export const FARM_CROP_RULES = ${JSON.stringify(farmRules, null, 2)} as const;`,
    `export const GAME_RULES = ${JSON.stringify(formulas, null, 2)} as const;`,
    '',
  ].join('\n');
  await mkdir(dirname(generatedFile), { recursive: true });
  await writeFile(generatedFile, generated, 'utf8');
  console.log(`Configuração validada: ${buildingFiles.length} construções e 3 arquivos de fórmulas.`);
}

await generateGameConfig();
