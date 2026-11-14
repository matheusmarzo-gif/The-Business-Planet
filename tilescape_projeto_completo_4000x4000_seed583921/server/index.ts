import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { Pool, types, type PoolClient } from 'pg';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type CityZone,
  type CityZoneBounds,
  type CityZoneType,
  type CityPlacementError,
  calculateCityEconomy,
  getCityZonePlacementError,
  getCityPlacementError,
  parseCityMinimumWage,
  MAX_CITY_ZONES,
  MUNICIPAL_AREA_RADIUS,
} from '../src/types/city.js';
import {
  getRoadPlacementError,
  MAX_ROAD_PATH_TILES,
  type RoadPlacementError,
  type RoadPosition,
  type RoadTile,
} from '../src/types/road.js';
import {
  getResidenceDefinition,
  getResidencePlacementError,
  isRentIncreaseWithinCityAverageStepLimit,
  isStorageBuilding,
  canStoreProduct,
  isPlayerBuildableConstructionType,
  planConstructionMaterialWithdrawals,
  parseInputProductSelection,
  parseRent,
  parseWorkSettings,
  RESIDENCES,
  RESIDENCE_STATS,
  SHOP_TYPES,
  type ResidentialBuilding,
  type ResidenceType,
  type ResidencePlacementError,
} from '../src/types/residence.js';
import type {
  WebSocketTrafficHour,
  WebSocketTrafficSnapshot,
} from '../src/types/websocketTraffic.js';
import {
  getExpectedConstructionCost,
  getStockCapacity,
  getStockCapacitySlots,
  getStockLevel,
  getStockUpgradeCost,
  type StockCapacityKey,
  type StockCapacityUpgradeQuote,
  type StockLevels,
} from '../src/types/stockCapacity.js';
import {
  createWorldDelta,
  type WorldDelta,
  type WorldEntities,
} from '../src/types/worldSync.js';
import { STARTING_BALANCE } from '../src/types/wallet.js';
import { roundCurrency } from '../src/types/currency.js';
import {
  calculateDailyRentRevenue,
  calculateEstimatedShopNetRevenue,
  estimateBlendedUnitCost,
  estimateProductionUnitCost,
  getShopProductUnitCostEstimate,
  getShopSalesAndLossByProduct,
  getAccountingWeekRange,
  parseAccountingPeriodDays,
  parseAccountingWeekOffset,
  type ProductUnitCostInput,
} from '../src/types/accounting.js';
import { rankPlayers } from '../src/types/leaderboard.js';
import {
  isPastDailyWorldRefreshTime,
  isValidTimeScale,
  parseMasterGrant,
} from '../src/types/worldClock.js';
import {
  advanceConstruction,
  allocateWorkers,
  getAverageWorkerTechnique,
  getAverageIncomes,
  getDailyWorkPoints,
  getEmploymentSummary,
  getMaxDesiredWorkers,
  getPayroll,
  type EmploymentSummaryWorkplace,
  type JobAssignment,
} from '../src/types/employment.js';
import {
  getCityProductAveragePrices,
  getInitialShopPrice,
  getShopDailyFinancials,
  getShopProfitLoss,
  getShopSalesCapacity,
  parsePrice,
  planShopSalesDetailed,
  simulateShopSales,
  type CityProductSale,
  type SalesResidence,
  type SalesShop,
  type ShopSalesSimulation,
  type ShopResidenceTransaction,
} from '../src/types/commerce.js';
import {
  nextEfficiencyPenalty,
  planProduction,
  rollToolDemand,
  routeProductionStockUsage,
} from '../src/types/fishing.js';
import { getDairyFarmEfficiency } from '../src/types/dairy.js';
import { parseBasicDemandConfig } from '../src/types/commerceDemand.js';
import {
  calculateResidenceWellbeing,
  getAverageWellbeing,
  getWorkerTechnique,
  type ResidenceProductConsumption,
} from '../src/types/wellbeing.js';
import {
  applyTransferToLinkedBuilding,
  canLinkToWarehouse,
  getTransportDemand,
  getMaxManualTransferQuantity,
  isWithinLinkRadius,
  parseWarehouseLink,
  planTransfersDetailed,
  planWarehouseStockWrites,
  planWarehouseTrades,
  LINK_RADIUS,
  type TradeWarehouse,
  type WarehouseTrade,
} from '../src/types/logistics.js';
import {
  advanceGrowth,
  AUTOMATABLE_FARM_TYPES,
  FARM_CROP_TYPES,
  getDailyWorkRatio,
  getHarvestDay,
  isAutomatableFarmType,
  isFarmCropType,
  parseFarmAutomationSettings,
  planHarvest,
  shouldStartAutomatedCrop,
  type Crop,
  type FarmCropType,
} from '../src/types/farming.js';
import { parseWarehouseSetting } from '../src/types/warehouse.js';
import { GAME_RULES } from '../src/generated/gameConfig.js';
import { planDailySpoilage, PRODUCTS, type ProductDefinition } from '../src/types/product.js';
import {
  allocateImmigrants,
  getCityPopulation,
  IMMIGRATION_POPULATION_LIMIT,
} from '../src/types/immigration.js';
import {
  planMonthlyPopulationChange,
  type PopulationCity,
  type PopulationResidence,
} from '../src/types/population.js';
import {
  calculateResidenceAppealsFromIncome,
  calculateResidenceAppeals,
  calculateResidenceBenefit,
  getResidenceBenefitIncome,
  planResidenceRelocations,
  type ResidenceEmploymentOffer,
  type ResidenceRelocation,
} from '../src/types/residence-relocation.js';
import { DEFAULT_TILE_LIST } from '../src/utils/tileAssets.js';
import { createMapGenerator } from '../src/utils/mapGenerator.js';
import { WORLD_CONFIG } from '../src/utils/worldConfig.js';

loadDotEnv({
  path: [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')],
});

const PORT = Number(process.env.PORT ?? 3001);
const websocketUsers = new WeakMap<object, string>();
const websocketWorldDeltaSupport = new WeakMap<WebSocket, boolean>();
const MAP = {
  width: WORLD_CONFIG.width,
  height: WORLD_CONFIG.height,
  seed: WORLD_CONFIG.seed,
};
const mapGenerator = createMapGenerator(WORLD_CONFIG, DEFAULT_TILE_LIST);
let demandBasicByProduct = new Map<string, number>();
const landTileIds = new Set(
  DEFAULT_TILE_LIST.filter((tile) => tile.category === 'land').map((tile) => tile.id),
);
const RESIDENCE_BUILDING_TYPES = Object.values(RESIDENCES)
  .filter((definition) => definition.kind === 'residence')
  .map((definition) => definition.type);
const PRODUCTION_BUILDING_TYPES = Object.values(RESIDENCES)
  .filter((definition) => Boolean(definition.production))
  .map((definition) => definition.type);
const PRODUCT_PRODUCER_DEFINITIONS = Object.values(RESIDENCES).filter(
  (definition) => Boolean(definition.stockProductId && (definition.production || definition.cropRule)),
);
const PRODUCT_PRODUCER_TYPES = PRODUCT_PRODUCER_DEFINITIONS.map((definition) => definition.type);
const CLOCK_LEADER_KEY = 'valdora:clock:leader';
const PRESENCE_KEY = 'valdora:presence';
const SNAPSHOT_CHANNEL = 'valdora:world:snapshots';
const CITIES_CHANNEL = 'valdora:world:cities';
const WORLD_SYNC_STATE_KEY = 'valdora:world:sync-state';
const WORLD_SYNC_LOCK_KEY = 'valdora:world:sync-lock';
const WORLD_SYNC_LOCK_LEASE_SECONDS = 60;
const WORLD_SYNC_LOCK_WAIT_MS = 90_000;
const PERFORMANCE_LOGS_KEY = 'valdora:world:performance-logs';
const PERFORMANCE_LOG_LIMIT = 100;
const PERFORMANCE_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;
const LEADERBOARD_HISTORY_DAYS = 365;
const WEBSOCKET_TRAFFIC_KEY_PREFIX = 'valdora:world:websocket-traffic:';
const WEBSOCKET_TRAFFIC_TTL_SECONDS = 8 * 24 * 60 * 60;
const WEBSOCKET_TRAFFIC_WINDOW_HOURS = 24;
const INSTANCE_ID = randomUUID();
const PRESENCE_TTL_MS = 35_000;
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));

interface PerformanceEntityCounts {
  residences: number;
  workplaces: number;
  shops: number;
  warehouses: number;
}

interface PerformanceLogRecord {
  id: string;
  cycleId: string;
  gameDay: string;
  phase: string;
  stage: string;
  recordedAt: string;
  durationMs: number;
  databaseMs: number;
  lockWaitMs: number;
  queryCount: number;
  counts: PerformanceEntityCounts;
  status: 'ok' | 'error';
}

const performanceMetricsContext = new AsyncLocalStorage<PerformanceLogRecord>();

function trackDatabaseQuery(method: Function, target: object, args: unknown[]): unknown {
  const metrics = performanceMetricsContext.getStore();
  if (!metrics || args.some((argument) => typeof argument === 'function')) {
    return Reflect.apply(method, target, args);
  }
  metrics.queryCount += 1;
  const startedAt = performance.now();
  const finish = () => {
    metrics.databaseMs += performance.now() - startedAt;
  };
  try {
    const result = Reflect.apply(method, target, args);
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      'then' in result &&
      typeof Reflect.get(result, 'then') === 'function'
    ) {
      return Reflect.apply(Reflect.get(result, 'then'), result, [
        (value: unknown) => {
          finish();
          return value;
        },
        (error: unknown) => {
          finish();
          throw error;
        },
      ]);
    }
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function instrumentPoolClient(client: PoolClient): PoolClient {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'query' && typeof value === 'function') {
        return (...args: unknown[]) => trackDatabaseQuery(value, target, args);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const rawPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://valdora:valdora_dev_password@localhost:5432/valdora',
});
const pool = new Proxy(rawPool, {
  get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property === 'query' && typeof value === 'function') {
      return (...args: unknown[]) => trackDatabaseQuery(value, target, args);
    }
    if (property === 'connect' && typeof value === 'function') {
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        if (result !== null && typeof result === 'object' && 'then' in result) {
          const then = Reflect.get(result, 'then');
          if (typeof then === 'function') {
            return Reflect.apply(then, result, [
              (client: PoolClient) => instrumentPoolClient(client),
            ]);
          }
        }
        return result;
      };
    }
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
const subscriber = redis.duplicate();
const clients = new Set<WebSocket>();
const websocketReconnects = new WeakMap<WebSocket, boolean>();
const websocketWorldInitialized = new WeakMap<WebSocket, boolean>();
const websocketTrafficLastAccountedAt = new WeakMap<WebSocket, number>();
type WebSocketTrafficCounter =
  | 'connections'
  | 'reconnections'
  | 'connectionMilliseconds'
  | 'snapshotMessages'
  | 'snapshotPayloadBytes'
  | 'worldUpdateMessages'
  | 'worldUpdatePayloadBytes'
  | 'commerceDiagnosticsMessages'
  | 'commerceDiagnosticsPayloadBytes';
interface PendingWebSocketTraffic {
  counters: Partial<Record<WebSocketTrafficCounter, number>>;
  peakConcurrentConnections: number;
}
const pendingWebSocketTraffic = new Map<string, PendingWebSocketTraffic>();
const app = express();
const server = createServer(app);
const websocketServer = new WebSocketServer({ noServer: true });

function getWebSocketTrafficHourKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function getPendingWebSocketTraffic(timestamp: number): PendingWebSocketTraffic {
  const hour = getWebSocketTrafficHourKey(timestamp);
  let pending = pendingWebSocketTraffic.get(hour);
  if (!pending) {
    pending = { counters: {}, peakConcurrentConnections: 0 };
    pendingWebSocketTraffic.set(hour, pending);
  }
  return pending;
}

function recordWebSocketTrafficCounter(
  timestamp: number,
  counter: WebSocketTrafficCounter,
  amount: number,
): void {
  const pending = getPendingWebSocketTraffic(timestamp);
  pending.counters[counter] = (pending.counters[counter] ?? 0) + amount;
}

function recordWebSocketMessage(
  messageType: 'snapshot' | 'worldUpdate' | 'commerceDiagnostics',
  payload: string,
): void {
  const bytes = Buffer.byteLength(payload, 'utf8');
  const fields = {
    snapshot: ['snapshotMessages', 'snapshotPayloadBytes'],
    worldUpdate: ['worldUpdateMessages', 'worldUpdatePayloadBytes'],
    commerceDiagnostics: ['commerceDiagnosticsMessages', 'commerceDiagnosticsPayloadBytes'],
  } as const;
  const [messageCounter, byteCounter] = fields[messageType];
  const timestamp = Date.now();
  recordWebSocketTrafficCounter(timestamp, messageCounter, 1);
  recordWebSocketTrafficCounter(timestamp, byteCounter, bytes);
}

function accountWebSocketConnectionTime(websocket: WebSocket, timestamp: number): void {
  const lastAccountedAt = websocketTrafficLastAccountedAt.get(websocket);
  if (lastAccountedAt === undefined) return;

  let segmentStart = lastAccountedAt;
  while (segmentStart < timestamp) {
    const date = new Date(segmentStart);
    const nextHour = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours() + 1,
    );
    const segmentEnd = Math.min(timestamp, nextHour);
    recordWebSocketTrafficCounter(
      segmentStart,
      'connectionMilliseconds',
      segmentEnd - segmentStart,
    );
    segmentStart = segmentEnd;
  }
  websocketTrafficLastAccountedAt.set(websocket, timestamp);
}

async function flushWebSocketTraffic(): Promise<void> {
  const buckets = [...pendingWebSocketTraffic.entries()];
  if (buckets.length === 0) return;
  pendingWebSocketTraffic.clear();

  let peakConnections = 0;
  try {
    await redis.zRemRangeByScore(PRESENCE_KEY, '-inf', Date.now());
    peakConnections = await redis.zCard(PRESENCE_KEY);
  } catch (error) {
    console.error('Não foi possível medir conexões WebSocket simultâneas:', error);
  }

  for (const [hour, pending] of buckets) {
    const key = `${WEBSOCKET_TRAFFIC_KEY_PREFIX}${hour}`;
    if (hour === getWebSocketTrafficHourKey(Date.now())) {
      pending.peakConcurrentConnections = Math.max(
        pending.peakConcurrentConnections,
        peakConnections,
      );
    }
    const argumentsList = Object.entries(pending.counters).flatMap(([field, value]) => [
      field,
      String(Math.round(value)),
    ]);
    argumentsList.push(
      'peakConcurrentConnections',
      String(pending.peakConcurrentConnections),
      String(WEBSOCKET_TRAFFIC_TTL_SECONDS),
    );
    try {
      await redis.eval(
        `for i = 1, #ARGV - 2, 2 do
           redis.call('HINCRBY', KEYS[1], ARGV[i], ARGV[i + 1])
         end
         local peak = tonumber(ARGV[#ARGV - 1])
         local current = tonumber(redis.call('HGET', KEYS[1], 'peakConcurrentConnections')) or 0
         if peak > current then
           redis.call('HSET', KEYS[1], 'peakConcurrentConnections', peak)
         end
         redis.call('EXPIRE', KEYS[1], ARGV[#ARGV])
         return 1`,
        { keys: [key], arguments: argumentsList },
      );
    } catch (error) {
      const current = pendingWebSocketTraffic.get(hour);
      if (current) {
        for (const [field, value] of Object.entries(pending.counters)) {
          const counter = field as WebSocketTrafficCounter;
          current.counters[counter] = (current.counters[counter] ?? 0) + (value ?? 0);
        }
        current.peakConcurrentConnections = Math.max(
          current.peakConcurrentConnections,
          pending.peakConcurrentConnections,
        );
      } else {
        pendingWebSocketTraffic.set(hour, pending);
      }
      console.error('Não foi possível persistir as métricas de tráfego WebSocket:', error);
    }
  }
}

async function getWebSocketTrafficSnapshot(): Promise<WebSocketTrafficSnapshot> {
  const now = Date.now();
  const hours = Array.from({ length: WEBSOCKET_TRAFFIC_WINDOW_HOURS }, (_, index) => {
    const timestamp = now - index * 60 * 60 * 1000;
    return {
      timestamp,
      hour: getWebSocketTrafficHourKey(timestamp),
      key: `${WEBSOCKET_TRAFFIC_KEY_PREFIX}${getWebSocketTrafficHourKey(timestamp)}`,
    };
  }).reverse();
  const [storedMetrics] = await Promise.all([
    Promise.all(hours.map(({ key }) => redis.hGetAll(key))),
    redis.zRemRangeByScore(PRESENCE_KEY, '-inf', now),
  ]);
  const activeConnections = await redis.zCard(PRESENCE_KEY);
  return {
    activeConnections,
    hours: hours.map(({ hour }, index): WebSocketTrafficHour => {
      const metrics = storedMetrics[index];
      return {
        hour,
        connections: Number(metrics.connections ?? 0),
        reconnections: Number(metrics.reconnections ?? 0),
        connectionHours: Number(metrics.connectionMilliseconds ?? 0) / 3_600_000,
        peakConcurrentConnections: Number(metrics.peakConcurrentConnections ?? 0),
        snapshots: {
          messages: Number(metrics.snapshotMessages ?? 0),
          payloadBytes: Number(metrics.snapshotPayloadBytes ?? 0),
        },
        worldUpdates: {
          messages: Number(metrics.worldUpdateMessages ?? 0),
          payloadBytes: Number(metrics.worldUpdatePayloadBytes ?? 0),
        },
        commerceDiagnostics: {
          messages: Number(metrics.commerceDiagnosticsMessages ?? 0),
          payloadBytes: Number(metrics.commerceDiagnosticsPayloadBytes ?? 0),
        },
      };
    }),
  };
}

const websocketTrafficTimer = setInterval(() => {
  const now = Date.now();
  for (const websocket of clients) accountWebSocketConnectionTime(websocket, now);
  void flushWebSocketTraffic();
}, 10_000);

function emptyPerformanceCounts(): PerformanceEntityCounts {
  return { residences: 0, workplaces: 0, shops: 0, warehouses: 0 };
}

function getPerformanceEntityCounts(
  buildings: { building_type: ResidenceType; desired_workers: number; status: string }[],
): PerformanceEntityCounts {
  return buildings.reduce((counts, building) => {
    const definition = getResidenceDefinition(building.building_type);
    if (definition?.kind === 'residence') counts.residences += 1;
    if (definition?.kind === 'shop') counts.shops += 1;
    if (definition?.kind === 'warehouse') counts.warehouses += 1;
    if (
      building.desired_workers > 0 &&
      (definition?.kind !== 'residence' || building.status === 'under_construction')
    ) {
      counts.workplaces += 1;
    }
    return counts;
  }, emptyPerformanceCounts());
}

function getWorldPerformanceEntityCounts(buildings: ResidentialBuilding[]): PerformanceEntityCounts {
  return buildings.reduce((counts, building) => {
    const definition = getResidenceDefinition(building.type);
    if (definition?.kind === 'residence') counts.residences += 1;
    if (definition?.kind === 'shop') counts.shops += 1;
    if (getResidenceDefinition(building.type)?.kind === 'warehouse') counts.warehouses += 1;
    if (
      building.desiredWorkers > 0 &&
      (definition?.kind !== 'residence' || building.status === 'under_construction')
    ) {
      counts.workplaces += 1;
    }
    return counts;
  }, emptyPerformanceCounts());
}

async function persistPerformanceLog(log: PerformanceLogRecord): Promise<void> {
  await redis
    .multi()
    .lPush(PERFORMANCE_LOGS_KEY, JSON.stringify(log))
    .lTrim(PERFORMANCE_LOGS_KEY, 0, PERFORMANCE_LOG_LIMIT - 1)
    .expire(PERFORMANCE_LOGS_KEY, PERFORMANCE_LOG_TTL_SECONDS)
    .exec();
}

async function measurePerformanceStage<T>(
  stage: string,
  phase: string,
  gameDay: string,
  cycleId: string,
  counts: PerformanceEntityCounts,
  operation: () => Promise<T>,
  lockWaitMs = 0,
  falseResultIsError = false,
  initialQueryCount = 0,
): Promise<T> {
  const log: PerformanceLogRecord = {
    id: randomUUID(),
    cycleId,
    gameDay,
    phase,
    stage,
    recordedAt: new Date().toISOString(),
    durationMs: 0,
    databaseMs: 0,
    lockWaitMs: Math.round(lockWaitMs * 10) / 10,
    queryCount: initialQueryCount,
    counts,
    status: 'ok',
  };
  const startedAt = performance.now();
  try {
    const result = await performanceMetricsContext.run(log, operation);
    if (falseResultIsError && result === false) log.status = 'error';
    return result;
  } catch (error) {
    log.status = 'error';
    throw error;
  } finally {
    log.durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    log.databaseMs = Math.round(log.databaseMs * 10) / 10;
    void persistPerformanceLog(log).catch((error: unknown) => {
      console.error(`Não foi possível registrar a métrica da etapa ${stage}:`, error);
    });
  }
}

interface AuthConfig {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  issuer: string;
}

interface CityAssembly {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  minimumWage: number;
  population: number;
  populationChangeLastMonth?: number;
  wellbeing: number;
  economy: number;
  zones: CityZone[];
}

type CityZoneInput = CityZoneBounds & { type: CityZoneType };
type ResidentialBuildingRow = {
  id: string;
  building_type: ResidenceType;
  building_number: number;
  tile_x: number;
  tile_y: number;
  city_id: string;
  status: ResidentialBuilding['status'];
  started_at: Date;
  completed_at: Date | null;
  wage: number;
  work_hours_per_day: number;
  rent: number;
  occupants: number;
  wellbeing: number;
  desired_workers: number;
  minimum_worker_technique: number;
  work_points_done: number;
  price: number;
  stock: number;
  stock_levels: StockLevels;
  warehouse_ids: string[];
  tool_stock: number;
  wood_stock: number;
  iron_stock: number;
  charcoal_stock: number;
  sugarcane_stock: number;
  input_stocks: Record<string, number>;
  selected_input_product_id: string | null;
  efficiency_penalty: number;
  crop_phase: Crop['phase'] | null;
  crop_planted_day: string | null;
  crop_ratio_sum: number;
  crop_days: number;
  crop_yield: number;
  crop_harvested: number;
  farm_auto_planting_enabled: boolean;
  farm_auto_planting_months: number[];
  farm_planting_workers: number;
  farm_harvest_workers: number;
  employed: number;
  average_income: number;
  average_worker_technique: number | null;
  owner_name?: string | null;
  created_by?: string;
};

const CITY_RESIDENCE_TYPES = Object.values(RESIDENCES)
  .filter((definition) => definition.kind === 'residence')
  .map((definition) => definition.type);

function getCityWellbeingById(
  residences: readonly {
    city_id: string;
    building_type: ResidenceType;
    status: ResidentialBuilding['status'];
    occupants: number;
    wellbeing: number;
  }[],
): Map<string, number> {
  const residencesByCity = new Map<string, { occupants: number; wellbeing: number }[]>();
  for (const residence of residences) {
    if (
      residence.status !== 'completed' ||
      getResidenceDefinition(residence.building_type)?.kind !== 'residence'
    ) continue;
    const cityResidences = residencesByCity.get(residence.city_id) ?? [];
    cityResidences.push({
      occupants: residence.occupants,
      wellbeing: residence.wellbeing,
    });
    residencesByCity.set(residence.city_id, cityResidences);
  }
  return new Map(
    [...residencesByCity].map(([cityId, cityResidences]) => [
      cityId,
      getAverageWellbeing(cityResidences),
    ]),
  );
}

const ALL_BUILDING_COLUMNS = `id, building_type, building_number, tile_x, tile_y, city_id, status, started_at, completed_at, wage, work_hours_per_day, minimum_worker_technique, rent, occupants, wellbeing, desired_workers, work_points_done, price, stock, stock_levels, tool_stock, wood_stock, iron_stock, charcoal_stock, sugarcane_stock, selected_input_product_id,
  COALESCE((SELECT array_agg(link.warehouse_id::text ORDER BY link.warehouse_id)
            FROM building_warehouse_links link
            WHERE link.building_id = all_buildings.id), ARRAY[]::text[]) AS warehouse_ids,
  COALESCE((SELECT jsonb_object_agg(input.product_id, input.quantity)
            FROM building_input_stock input
            WHERE input.building_id = all_buildings.id), '{}'::jsonb) AS input_stocks,
  efficiency_penalty,
  farm_auto_planting_enabled, farm_auto_planting_months, farm_planting_workers, farm_harvest_workers,
  crop_phase, to_char(crop_planted_day, 'YYYY-MM-DD') AS crop_planted_day, crop_ratio_sum, crop_days,
  crop_yield, crop_harvested,
  (SELECT COALESCE(SUM(j.count), 0)::int FROM job_assignments j
   WHERE j.workplace_id = all_buildings.id OR j.residence_id = all_buildings.id) AS employed,
  (SELECT SUM(j.count * CASE
             WHEN LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) <= 100
               THEN 10 * (1 + LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) / 200)
             WHEN LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) <= 125
               THEN 10 * (1.5 + (LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) - 100) / 50)
             WHEN LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) <= 150
               THEN 10 * (2 + (LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) - 125) / 25)
             ELSE 10 * (3 + (LEAST(162::float8, GREATEST(0::float8, home.wellbeing)) - 150) / 12)
           END) / NULLIF(SUM(j.count), 0)
   FROM job_assignments j
   JOIN all_buildings home ON home.id = j.residence_id
   WHERE j.workplace_id = all_buildings.id) AS average_worker_technique,
  COALESCE((SELECT SUM(j.count * w.wage) FROM job_assignments j
            JOIN all_buildings w ON w.id = j.workplace_id
            WHERE j.residence_id = all_buildings.id)
       / NULLIF((SELECT SUM(j.count) FROM job_assignments j
                 WHERE j.residence_id = all_buildings.id), 0),
           0)::float8 AS average_income`;

function mapResidentialBuilding(row: ResidentialBuildingRow): ResidentialBuilding {
  const farmAutomation = {
    enabled: row.farm_auto_planting_enabled,
    plantingMonths: row.farm_auto_planting_months,
    plantingWorkers: row.farm_planting_workers,
    harvestWorkers: row.farm_harvest_workers,
  };
  return {
    id: row.id,
    ownerName: row.owner_name ?? undefined,
    type: row.building_type,
    buildingNumber: row.building_number,
    x: row.tile_x,
    y: row.tile_y,
    cityId: row.city_id,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    wage: row.wage,
    workHoursPerDay: row.work_hours_per_day,
    minimumWorkerTechnique: row.minimum_worker_technique,
    rent: row.rent,
    occupants: row.occupants,
    wellbeing: row.wellbeing,
    desiredWorkers: farmAutomation.enabled
      ? row.crop_phase === 'growing'
        ? farmAutomation.plantingWorkers
        : row.crop_phase === 'harvesting'
          ? farmAutomation.harvestWorkers
          : 0
      : row.desired_workers,
    workPointsDone: row.work_points_done,
    price: row.price,
    stock: row.stock,
    stockLevels: row.stock_levels,
    warehouseIds: row.warehouse_ids,
    toolStock: row.tool_stock,
    woodStock: row.wood_stock,
    ironStock: row.iron_stock,
    charcoalStock: row.charcoal_stock,
    sugarcaneStock: row.sugarcane_stock,
    inputStocks: row.input_stocks,
    selectedInputProductId: row.selected_input_product_id,
    efficiencyPenalty: row.efficiency_penalty,
    farmAutomation,
    crop:
      row.crop_phase && row.crop_planted_day
        ? {
            phase: row.crop_phase,
            plantedDay: row.crop_planted_day,
            ratioSum: row.crop_ratio_sum,
            days: row.crop_days,
            yieldUnits: row.crop_yield,
            harvested: row.crop_harvested,
          }
        : null,
    employed: row.employed,
    averageIncome: row.average_income,
    averageWorkerTechnique: row.average_worker_technique,
  };
}

function getStockQuantityForKey(
  building: ResidentialBuildingRow,
  key: StockCapacityKey,
): number {
  if (key === 'stock') return building.stock;
  if (key === 'tools') return building.tool_stock;
  if (key === 'wood') return building.wood_stock;
  if (key === 'iron') return building.iron_stock;
  if (key === 'charcoal') return building.charcoal_stock;
  if (key === 'sugarcane') return building.sugarcane_stock;
  return building.input_stocks[key.slice('input:'.length)] ?? 0;
}

async function getStockCapacityUpgradeQuotes(
  client: PoolClient,
  building: ResidentialBuildingRow,
): Promise<StockCapacityUpgradeQuote[]> {
  const definition = getResidenceDefinition(building.building_type);
  if (!definition) throw new Error(`Tipo de construção inválido: ${building.building_type}`);
  const { rows: priceRows } = await client.query<{
    product_id: string;
    average_price: number;
  }>(
    `SELECT settings.product_id, AVG(settings.price)::float8 AS average_price
     FROM warehouse_product_settings settings
     JOIN all_buildings warehouse ON warehouse.id = settings.building_id
     WHERE warehouse.building_type IN ('warehouse', 'silo')
       AND warehouse.status = 'completed'
       AND settings.mode = 'sell'
       AND settings.price > 0
       AND settings.product_id = ANY($1::text[])
     GROUP BY settings.product_id`,
    [['wood', 'stone', 'iron', 'steel']],
  );
  const warehousePrices = new Map(
    priceRows.map((row) => [row.product_id, row.average_price]),
  );
  const { rows: salaryRows } = await client.query<{ average_salary: number }>(
    `SELECT COALESCE(
              (SELECT SUM(assignment.count * workplace.wage)
                        / NULLIF(SUM(assignment.count), 0)
               FROM job_assignments assignment
               JOIN all_buildings workplace ON workplace.id = assignment.workplace_id
               WHERE workplace.city_id = city.id),
              city.minimum_wage
            )::float8 AS average_salary
     FROM city_assemblies city
     WHERE city.id = $1`,
    [building.city_id],
  );
  if (!salaryRows[0]) throw new Error(`A cidade ${building.city_id} não foi encontrada.`);
  const expectedConstructionCost = getExpectedConstructionCost(
    definition,
    warehousePrices,
    salaryRows[0].average_salary,
  );
  return getStockCapacitySlots(definition, building.selected_input_product_id).map(({ key }) => {
    const level = getStockLevel(building.stock_levels, key);
    const capacity = getStockCapacity(definition, key, building.stock_levels);
    const nextLevel = level < 4 ? level + 1 : null;
    const previousCapacity = level > 1
      ? getStockCapacity(definition, key, { ...building.stock_levels, [key]: level - 1 })
      : null;
    const currentStock = getStockQuantityForKey(building, key);
    return {
      key,
      level,
      capacity,
      currentStock,
      nextLevel,
      nextCapacity: nextLevel === null
        ? null
        : getStockCapacity(definition, key, { ...building.stock_levels, [key]: nextLevel }),
      upgradeCost: nextLevel === null || expectedConstructionCost === null
        ? null
        : getStockUpgradeCost(expectedConstructionCost, nextLevel),
      previousCapacity,
      canDowngrade: previousCapacity !== null && currentStock <= previousCapacity,
    };
  });
}

async function applyDailySpoilage(client: PoolClient, day: string): Promise<boolean> {
  const perishableProducts = PRODUCTS.filter(
    (product): product is ProductDefinition & { shelfLifeDays: number } => product.shelfLifeDays !== null,
  );
  const shelfLifeByProduct = new Map(
    perishableProducts.map((product) => [product.id, product.shelfLifeDays]),
  );
  const perishableBuildingTypes = Object.entries(RESIDENCES)
    .filter(([_, definition]) => {
      const productId = definition.stockProductId;
      return productId !== undefined && shelfLifeByProduct.has(productId);
    })
    .map(([type]) => type);
  let changed = false;
  const shopTypes = new Set<string>(SHOP_TYPES);
  const spoiledShopStocks: { id: string; quantity: number }[] = [];

  const { rows: buildingStocks } = await client.query<{
    id: string;
    building_type: ResidenceType;
    stock: number;
    stock_levels: StockLevels;
  }>(
    `SELECT id, building_type, stock
     FROM all_buildings
     WHERE building_type = ANY($1::text[]) AND stock > 0
     FOR UPDATE`,
    [perishableBuildingTypes],
  );
  for (const building of buildingStocks) {
    const productId = getResidenceDefinition(building.building_type)?.stockProductId;
    const shelfLifeDays = productId ? shelfLifeByProduct.get(productId) : undefined;
    if (!productId || shelfLifeDays === undefined) continue;
    const quantity = planDailySpoilage(building.stock, shelfLifeDays);
    if (quantity === 0) continue;
    await client.query('UPDATE all_buildings SET stock = stock - $2 WHERE id = $1', [
      building.id,
      quantity,
    ]);
    if (shopTypes.has(building.building_type)) {
      spoiledShopStocks.push({ id: building.id, quantity });
    }
    changed = true;
  }
  if (spoiledShopStocks.length > 0) {
    await client.query(
      `INSERT INTO commerce_history (building_id, day, units_lost, sale_price)
       SELECT spoiled.id, $3::date, spoiled.quantity, building.price
       FROM UNNEST($1::uuid[], $2::integer[]) AS spoiled(id, quantity)
       JOIN all_buildings building ON building.id = spoiled.id
       ON CONFLICT (building_id, day) DO UPDATE
       SET units_lost = commerce_history.units_lost + EXCLUDED.units_lost`,
      [
        spoiledShopStocks.map(({ id }) => id),
        spoiledShopStocks.map(({ quantity }) => quantity),
        day,
      ],
    );
  }

  const { rows: warehouseStocks } = await client.query<{
    building_id: string;
    product_id: string;
    quantity: number;
  }>(
    `SELECT building_id, product_id, quantity
     FROM warehouse_stock
     WHERE quantity > 0 AND product_id = ANY($1::text[])
     FOR UPDATE`,
    [perishableProducts.map((product) => product.id)],
  );
  for (const stock of warehouseStocks) {
    const shelfLifeDays = shelfLifeByProduct.get(stock.product_id);
    if (shelfLifeDays === undefined) continue;
    const quantity = planDailySpoilage(stock.quantity, shelfLifeDays);
    if (quantity === 0) continue;
    await client.query(
      'UPDATE warehouse_stock SET quantity = quantity - $3 WHERE building_id = $1 AND product_id = $2',
      [stock.building_id, stock.product_id, quantity],
    );
    changed = true;
  }

  const { rows: sugarcaneStocks } = await client.query<{
    id: string;
    sugarcane_stock: number;
  }>(
    `SELECT id, sugarcane_stock
     FROM all_buildings
     WHERE sugarcane_stock > 0
     FOR UPDATE`,
  );
  const spoiledSugarcane = sugarcaneStocks.flatMap((building) => {
    const quantity = planDailySpoilage(building.sugarcane_stock, 3);
    return quantity > 0 ? [{ id: building.id, quantity }] : [];
  });
  if (spoiledSugarcane.length > 0) {
    await client.query(
      `UPDATE all_buildings building
       SET sugarcane_stock = building.sugarcane_stock - spoiled.quantity
       FROM UNNEST($1::uuid[], $2::integer[]) AS spoiled(id, quantity)
       WHERE building.id = spoiled.id`,
      [spoiledSugarcane.map(({ id }) => id), spoiledSugarcane.map(({ quantity }) => quantity)],
    );
    changed = true;
  }
  const { rows: inputStocks } = await client.query<{
    building_id: string;
    product_id: string;
    quantity: number;
  }>(
    `SELECT building_id, product_id, quantity
     FROM building_input_stock
     WHERE quantity > 0 AND product_id = ANY($1::text[])
     FOR UPDATE`,
    [perishableProducts.map((product) => product.id)],
  );
  const spoiledInputs = inputStocks.flatMap((stock) => {
    const shelfLifeDays = shelfLifeByProduct.get(stock.product_id);
    if (shelfLifeDays === undefined) return [];
    const quantity = planDailySpoilage(stock.quantity, shelfLifeDays);
    return quantity > 0 ? [{ ...stock, spoiled: quantity }] : [];
  });
  if (spoiledInputs.length > 0) {
    await client.query(
      `UPDATE building_input_stock stock
       SET quantity = stock.quantity - spoiled.spoiled
       FROM UNNEST($1::uuid[], $2::text[], $3::integer[])
         AS spoiled(building_id, product_id, spoiled)
       WHERE stock.building_id = spoiled.building_id
         AND stock.product_id = spoiled.product_id`,
      [
        spoiledInputs.map((stock) => stock.building_id),
        spoiledInputs.map((stock) => stock.product_id),
        spoiledInputs.map((stock) => stock.spoiled),
      ],
    );
    changed = true;
  }
  return changed;
}

const authenticatedUserIds = new WeakMap<express.Request, string>();

redis.on('error', (error) => console.error('Redis:', error));
subscriber.on('error', (error) => console.error('Redis subscriber:', error));
pool.on('error', (error) => console.error('PostgreSQL:', error));

async function getSnapshot() {
  const [clock, online] = await Promise.all([
    pool.query(
      `SELECT
         world_time + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - last_real_at)))
           * time_scale * INTERVAL '1 second' AS world_time,
         time_scale,
         clock_timestamp() AS server_time
       FROM world_state
       WHERE id = 1`,
    ),
    (async () => {
      await redis.zRemRangeByScore(PRESENCE_KEY, '-inf', Date.now());
      return redis.zCard(PRESENCE_KEY);
    })(),
  ]);
  const row = clock.rows[0];
  if (!row) throw new Error('O relógio global ainda não foi inicializado.');

  return {
    worldTime: new Date(row.world_time).toISOString(),
    serverTime: new Date(row.server_time).toISOString(),
    timeScale: Number(row.time_scale),
    map: MAP,
    onlinePlayers: online,
  };
}

function broadcast(payload: string) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      recordWebSocketMessage('snapshot', payload);
    }
  }
}

type WorldResidentialBuilding = ResidentialBuilding & { ownerId: string };
type FullWorldUpdate = {
  type: 'cities';
  revision?: number;
  cities: CityAssembly[];
  roads: RoadTile[];
  buildings: WorldResidentialBuilding[];
};
type WorldPublication = {
  type: 'world_publication';
  full: FullWorldUpdate;
  delta: WorldDelta<WorldResidentialBuilding> | null;
};
type WorldSyncState = {
  revision: number;
  entities: WorldEntities<WorldResidentialBuilding>;
};

function createPlayerWorldUpdate(
  update: FullWorldUpdate,
  userId: string | undefined,
) {
  return {
    ...update,
    buildings: update.buildings.map(({ ownerId, ...building }) => ({
      ...building,
      isOwnedByCurrentUser: ownerId === userId,
    })),
  };
}

function createPlayerWorldDelta(
  delta: WorldDelta<WorldResidentialBuilding>,
  userId: string | undefined,
): WorldDelta<ResidentialBuilding> {
  return {
    type: 'world_delta',
    revision: delta.revision,
    ...(delta.cities ? { cities: delta.cities } : {}),
    ...(delta.roads ? { roads: delta.roads } : {}),
    ...(delta.buildings
      ? {
          buildings: {
            ...delta.buildings,
            upsert: delta.buildings.upsert.map(({ ownerId, ...building }) => ({
              ...building,
              isOwnedByCurrentUser: ownerId === userId,
            })),
          },
        }
      : {}),
  };
}

function isFullWorldUpdate(value: unknown): value is FullWorldUpdate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'cities' &&
    'cities' in value &&
    Array.isArray(value.cities) &&
    'roads' in value &&
    Array.isArray(value.roads) &&
    'buildings' in value &&
    Array.isArray(value.buildings) &&
    value.buildings.every(
      (building) =>
        typeof building === 'object' &&
        building !== null &&
        'ownerId' in building &&
        typeof building.ownerId === 'string',
    )
  );
}

function deliverCities(message: string) {
  let update: unknown;
  try {
    update = JSON.parse(message);
  } catch (error) {
    console.error('Não foi possível interpretar a atualização de cidades do Redis:', error);
    return;
  }
  if (typeof update !== 'object' || update === null || !('type' in update)) {
    console.error('O Redis publicou uma atualização de cidades inválida.');
    return;
  }

  if ('type' in update && update.type === 'world_publication') {
    if (
      !('full' in update) ||
      !isFullWorldUpdate(update.full) ||
      !('delta' in update) ||
      (update.delta !== null &&
        (typeof update.delta !== 'object' ||
          update.delta === null ||
          !('type' in update.delta) ||
          update.delta.type !== 'world_delta' ||
          !('revision' in update.delta) ||
          !Number.isInteger(update.delta.revision)))
    ) {
      console.error('O Redis publicou uma sincronização incremental inválida.');
      return;
    }

    const publication = update as WorldPublication;
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const sendDelta = Boolean(
        websocketWorldDeltaSupport.get(client) &&
          websocketWorldInitialized.get(client) &&
          publication.delta,
      );
      const payload = JSON.stringify(
        sendDelta && publication.delta
          ? createPlayerWorldDelta(publication.delta, websocketUsers.get(client))
          : createPlayerWorldUpdate(publication.full, websocketUsers.get(client)),
      );
      client.send(payload);
      recordWebSocketMessage('worldUpdate', payload);
      if (!sendDelta) websocketWorldInitialized.set(client, true);
    }
    return;
  }

  if (!isFullWorldUpdate(update)) {
    console.error('O Redis publicou uma atualização de cidades inválida.');
    return;
  }

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(
        createPlayerWorldUpdate(update, websocketUsers.get(client)),
      );
      client.send(payload);
      recordWebSocketMessage('worldUpdate', payload);
      websocketWorldInitialized.set(client, false);
    }
  }
}

async function publishSnapshot() {
  const snapshot = await getSnapshot();
  await redis.publish(SNAPSHOT_CHANNEL, JSON.stringify(snapshot));
}

async function publishDailyFullWorldStateIfDue(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateReadStartedAt = performance.now();
    const { rows } = await client.query<{
      day: string;
      hour: number;
      minute: number;
      last_full_world_sync_day: string | null;
    }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour,
              EXTRACT(MINUTE FROM world_time AT TIME ZONE 'UTC')::int AS minute,
              to_char(last_full_world_sync_day, 'YYYY-MM-DD') AS last_full_world_sync_day
       FROM world_state
       WHERE id = 1
       FOR UPDATE`,
    );
    const stateReadLockMs = performance.now() - stateReadStartedAt;
    const state = rows[0];
    if (!state) throw new Error('O relógio global ainda não foi inicializado.');
    if (
      !isPastDailyWorldRefreshTime(state.hour, state.minute) ||
      state.last_full_world_sync_day === state.day
    ) {
      await client.query('COMMIT');
      return;
    }

    const publicationCounts = emptyPerformanceCounts();
    await measurePerformanceStage(
      'publicação completa do mundo',
      `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`,
      state.day,
      randomUUID(),
      publicationCounts,
      async () => {
        Object.assign(publicationCounts, await publishCities(true));
        await client.query(
          'UPDATE world_state SET last_full_world_sync_day = $1::date WHERE id = 1',
          [state.day],
        );
        await client.query('COMMIT');
      },
      stateReadLockMs,
      false,
      2,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a sincronização diária do mundo:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function getCities(): Promise<CityAssembly[]> {
  const [
    { rows },
    { rows: workplaceRows },
    { rows: residenceRows },
    { rows: consumptionSpendingRows },
  ] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      minimum_wage: number;
      population: number;
      population_change_last_month: number;
      zones: CityZone[];
    }>(
      `SELECT city.id, city.name, city.center_x, city.center_y, city.minimum_wage,
            city.population_change_last_month,
            COALESCE((
              SELECT SUM(home.occupants)::integer
              FROM all_buildings AS home
              WHERE home.city_id = city.id
            ), 0) AS population,
            COALESCE(
              json_agg(json_build_object(
                'id', zone.id,
                'cityId', zone.city_id,
                'type', zone.zone_type,
                'minX', zone.min_x,
                'minY', zone.min_y,
                'maxX', zone.max_x,
                'maxY', zone.max_y
              ) ORDER BY zone.min_y, zone.min_x)
                FILTER (WHERE zone.id IS NOT NULL),
              '[]'::json
            ) AS zones
     FROM city_assemblies AS city
     LEFT JOIN city_zones AS zone ON zone.city_id = city.id
     GROUP BY city.id
     ORDER BY city.created_at, city.id`,
    ),
    pool.query<{
      city_id: string;
      building_type: ResidenceType;
      status: ResidentialBuilding['status'];
      wage: number;
      desired_workers: number;
      employed: number;
    }>(
      `SELECT b.city_id, b.building_type, b.status, b.wage, b.desired_workers,
              COALESCE(SUM(j.count), 0)::int AS employed
       FROM all_buildings b
       LEFT JOIN job_assignments j ON j.workplace_id = b.id
       GROUP BY b.id`,
    ),
    pool.query<{
      city_id: string;
      building_type: ResidenceType;
      status: ResidentialBuilding['status'];
      occupants: number;
      wellbeing: number;
    }>(
      `SELECT city_id, building_type, status, occupants, wellbeing
       FROM all_buildings
       WHERE building_type = ANY($1::text[]) AND status = 'completed'`,
      [CITY_RESIDENCE_TYPES],
    ),
    pool.query<{ city_id: string; monthly_spending: number }>(
      `SELECT building.city_id, COALESCE(SUM(consumption.spent), 0)::float8 AS monthly_spending
       FROM residence_consumption consumption
       JOIN all_buildings building ON building.id = consumption.building_id
       WHERE consumption.day > (
         SELECT (world_time AT TIME ZONE 'UTC')::date - 30
         FROM world_state WHERE id = 1
       )
       GROUP BY building.city_id`,
    ),
  ]);
  const wellbeingByCity = getCityWellbeingById(residenceRows);
  const workplacesByCity = new Map<string, EmploymentSummaryWorkplace[]>();
  const monthlySpendingByCity = new Map(
    consumptionSpendingRows.map((row) => [row.city_id, row.monthly_spending]),
  );
  for (const row of workplaceRows) {
    const workplaces = workplacesByCity.get(row.city_id) ?? [];
    workplaces.push({
      type: row.building_type,
      status: row.status,
      wage: row.wage,
      desiredWorkers: row.desired_workers,
      employed: row.employed,
    });
    workplacesByCity.set(row.city_id, workplaces);
  }
  return rows.map((row) => {
    const employment = getEmploymentSummary(workplacesByCity.get(row.id) ?? []);
    return {
      ...employment,
      id: row.id,
      name: row.name,
      centerX: row.center_x,
      centerY: row.center_y,
      minimumWage: row.minimum_wage,
      population: row.population,
      populationChangeLastMonth: row.population_change_last_month,
      wellbeing: wellbeingByCity.get(row.id) ?? 0,
      economy: calculateCityEconomy(
        monthlySpendingByCity.get(row.id) ?? 0,
        employment.averageWage,
        employment.employed,
      ),
      zones: row.zones,
    };
  });
}

async function getRoadTiles(): Promise<RoadTile[]> {
  const { rows } = await pool.query<{ tile_x: number; tile_y: number; city_id: string }>(
    `SELECT tile_x, tile_y, city_id FROM road_tiles ORDER BY tile_y, tile_x`,
  );
  return rows.map((row) => ({
    x: row.tile_x,
    y: row.tile_y,
    cityId: row.city_id,
  }));
}

async function getResidentialBuildings(): Promise<WorldResidentialBuilding[]> {
  const { rows } = await pool.query<ResidentialBuildingRow & { created_by: string }>(
    `SELECT ${ALL_BUILDING_COLUMNS}, created_by,
            (SELECT COALESCE(NULLIF(BTRIM(player.name), ''), 'Jogador')
             FROM neon_auth."user" player WHERE player.id::text = all_buildings.created_by) AS owner_name
     FROM all_buildings
     ORDER BY started_at, id`,
  );
  return rows.map((row) => ({
    ...mapResidentialBuilding(row),
    ownerId: row.created_by,
  }));
}

async function getWorldEntities(): Promise<WorldEntities<WorldResidentialBuilding>> {
  const [cities, roads, buildings] = await Promise.all([
    getCities(),
    getRoadTiles(),
    getResidentialBuildings(),
  ]);
  return { cities, roads, buildings };
}

async function withWorldSyncLock<Result>(
  operation: (assertOwned: () => void) => Promise<Result>,
): Promise<Result> {
  const token = randomUUID();
  const deadline = Date.now() + WORLD_SYNC_LOCK_WAIT_MS;
  let acquired = false;
  while (Date.now() < deadline) {
    if (
      await redis.set(WORLD_SYNC_LOCK_KEY, token, {
        NX: true,
        EX: WORLD_SYNC_LOCK_LEASE_SECONDS,
      })
    ) {
      acquired = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  if (!acquired) {
    throw new Error('Não foi possível adquirir o bloqueio de sincronização do mundo.');
  }

  let lockLost = false;
  const renewTimer = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        {
          keys: [WORLD_SYNC_LOCK_KEY],
          arguments: [token, String(WORLD_SYNC_LOCK_LEASE_SECONDS)],
        },
      )
      .then((renewed) => {
        if (Number(renewed) !== 1) lockLost = true;
      })
      .catch((error: unknown) => {
        lockLost = true;
        console.error('Não foi possível renovar o bloqueio de sincronização do mundo:', error);
      });
  }, Math.floor((WORLD_SYNC_LOCK_LEASE_SECONDS * 1000) / 3));

  const assertOwned = () => {
    if (lockLost) {
      throw new Error('O bloqueio de sincronização do mundo foi perdido.');
    }
  };
  let result!: Result;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation(assertOwned);
    assertOwned();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    clearInterval(renewTimer);
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [WORLD_SYNC_LOCK_KEY], arguments: [token] },
      );
    } catch (error) {
      console.error('Não foi possível liberar o bloqueio de sincronização do mundo:', error);
      if (!operationFailed) {
        operationFailed = true;
        operationError = error;
      }
    }
  }
  if (operationFailed) throw operationError;
  return result;
}

function isWorldEntities(value: unknown): value is WorldEntities<WorldResidentialBuilding> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cities' in value &&
    Array.isArray(value.cities) &&
    value.cities.every(
      (city) =>
        typeof city === 'object' &&
        city !== null &&
        'id' in city &&
        typeof city.id === 'string',
    ) &&
    'roads' in value &&
    Array.isArray(value.roads) &&
    value.roads.every(
      (road) =>
        typeof road === 'object' &&
        road !== null &&
        'x' in road &&
        Number.isInteger(road.x) &&
        'y' in road &&
        Number.isInteger(road.y),
    ) &&
    'buildings' in value &&
    Array.isArray(value.buildings) &&
    value.buildings.every(
      (building) =>
        typeof building === 'object' &&
        building !== null &&
        'id' in building &&
        typeof building.id === 'string' &&
        'ownerId' in building &&
        typeof building.ownerId === 'string',
    )
  );
}

function isWorldSyncState(value: unknown): value is WorldSyncState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'revision' in value &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    'entities' in value &&
    isWorldEntities(value.entities)
  );
}

async function publishCities(forceFull = false): Promise<PerformanceEntityCounts> {
  return withWorldSyncLock(async (assertOwned) => {
    const current = await getWorldEntities();
    assertOwned();
    const cachedState = await redis.get(WORLD_SYNC_STATE_KEY);
    let previousState: WorldSyncState | null = null;
    if (cachedState !== null) {
      try {
        const parsed: unknown = JSON.parse(cachedState);
        if (isWorldSyncState(parsed)) {
          previousState = parsed;
        } else {
          console.error('O estado de sincronização do mundo no Redis está inválido; será recriado.');
        }
      } catch (error) {
        console.error('Não foi possível interpretar o estado de sincronização do mundo no Redis:', error);
      }
    }

    const delta = previousState
      ? createWorldDelta(previousState.entities, current, previousState.revision + 1)
      : null;
    const revision = previousState
      ? previousState.revision + (delta ? 1 : 0)
      : 1;
    const sendFull = forceFull || previousState === null;
    if (!sendFull && delta === null) {
      return getWorldPerformanceEntityCounts(current.buildings);
    }

    const publication: WorldPublication = {
      type: 'world_publication',
      full: { type: 'cities', revision, ...current },
      delta: sendFull ? null : delta,
    };
    assertOwned();
    await redis.publish(CITIES_CHANNEL, JSON.stringify(publication));
    assertOwned();
    await redis.set(
      WORLD_SYNC_STATE_KEY,
      JSON.stringify({ revision, entities: current } satisfies WorldSyncState),
    );
    return getWorldPerformanceEntityCounts(current.buildings);
  });
}

async function runDailyImmigration(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockStartedAt = performance.now();
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const lockWaitMs = performance.now() - lockStartedAt;
    const { rows: stateRows } = await client.query<{ day: string; last_day: string | null }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              to_char(last_immigration_day, 'YYYY-MM-DD') AS last_day
       FROM world_state WHERE id = 1 FOR UPDATE`,
    );
    const state = stateRows[0];
    if (!state) {
      await client.query('ROLLBACK');
      return false;
    }

    const currentDay = Date.parse(`${state.day}T00:00:00Z`);
    const lastDay = state.last_day ? Date.parse(`${state.last_day}T00:00:00Z`) : currentDay;
    const missedDays = Math.min(30, Math.round((currentDay - lastDay) / 86_400_000));
    if (missedDays <= 0) {
      if (!state.last_day) {
        await client.query('UPDATE world_state SET last_immigration_day = $1 WHERE id = 1', [state.day]);
      }
      await client.query('COMMIT');
      return false;
    }

    const immigrationCounts = emptyPerformanceCounts();
    return await measurePerformanceStage(
      'imigração',
      '00:00',
      state.day,
      randomUUID(),
      immigrationCounts,
      async () => {
    const { rows } = await client.query<ResidentialBuildingRow>(
      `SELECT ${ALL_BUILDING_COLUMNS} FROM all_buildings WHERE status = 'completed'`,
    );
    Object.assign(immigrationCounts, getPerformanceEntityCounts(rows));
    const byCity = new Map<string, ResidentialBuilding[]>();
    for (const building of rows.map(mapResidentialBuilding)) {
      byCity.set(building.cityId, [...(byCity.get(building.cityId) ?? []), building]);
    }

    let changed = false;
    for (const homes of byCity.values()) {
      for (let day = 0; day < missedDays; day += 1) {
        if (getCityPopulation(homes) >= IMMIGRATION_POPULATION_LIMIT) break;
        const additions = allocateImmigrants(homes);
        for (const home of homes) {
          const added = additions.get(home.id);
          if (!added) continue;
          home.occupants += added;
          changed = true;
          await client.query('UPDATE all_buildings SET occupants = $2 WHERE id = $1', [
            home.id,
            home.occupants,
          ]);
        }
      }
    }
    await client.query('UPDATE world_state SET last_immigration_day = $1 WHERE id = 1', [state.day]);
    await client.query('COMMIT');
    return changed;
      },
      lockWaitMs,
      false,
      3,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a imigração diária:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function applyResidenceRelocations(
  client: PoolClient,
  day: string,
  counts: PerformanceEntityCounts,
  sourceResidenceId?: string,
): Promise<ResidenceRelocation[]> {
  const { rows: residences } = await client.query<{
    id: string;
    city_id: string;
    building_type: ResidenceType;
    tile_x: number;
    tile_y: number;
    rent: number;
    occupants: number;
  }>(
    `SELECT id, city_id, building_type, tile_x, tile_y, rent, occupants
     FROM all_buildings
     WHERE status = 'completed'`,
  );
  counts.residences = residences.filter(
    (row) => getResidenceDefinition(row.building_type)?.kind === 'residence',
  ).length;
  const { rows: workplaces } = await client.query<{
    id: string;
    city_id: string;
    building_type: ResidenceType;
    tile_x: number;
    tile_y: number;
    wage: number;
    desired_workers: number;
    status: ResidentialBuilding['status'];
    employed: number;
  }>(
    `SELECT workplace.id, workplace.city_id, workplace.building_type,
            workplace.tile_x, workplace.tile_y, workplace.wage,
            workplace.desired_workers, workplace.status,
            COALESCE(SUM(assignment.count), 0)::int AS employed
     FROM all_buildings workplace
     LEFT JOIN job_assignments assignment ON assignment.workplace_id = workplace.id
     GROUP BY workplace.id`,
  );
  const { rows: assignments } = await client.query<{
    workplace_id: string;
    residence_id: string;
    count: number;
  }>('SELECT workplace_id, residence_id, count FROM job_assignments');
  const assignmentsForIncome = assignments.map((row) => ({
    workplaceId: row.workplace_id,
    residenceId: row.residence_id,
    count: row.count,
  }));
  const averageIncomes = getAverageIncomes(
    residences.map((row) => ({ id: row.id })),
    new Map(workplaces.map((row) => [row.id, row.wage])),
    assignmentsForIncome,
  );
  const residentialRows = residences.filter(
    (row) => getResidenceDefinition(row.building_type)?.kind === 'residence',
  );
  const employedByResidence = new Map<string, number>();
  for (const assignment of assignmentsForIncome) {
    employedByResidence.set(
      assignment.residenceId,
      (employedByResidence.get(assignment.residenceId) ?? 0) + assignment.count,
    );
  }
  const cityIncomeTotals = new Map<string, { income: number; employees: number }>();
  for (const residence of residentialRows) {
    const employed = employedByResidence.get(residence.id) ?? 0;
    const current = cityIncomeTotals.get(residence.city_id) ?? { income: 0, employees: 0 };
    current.income += (averageIncomes.get(residence.id) ?? 0) * employed;
    current.employees += employed;
    cityIncomeTotals.set(residence.city_id, current);
  }
  const cityAverageSalaries = new Map(
    [...cityIncomeTotals].map(([cityId, totals]) => [
      cityId,
      totals.employees > 0 ? totals.income / totals.employees : 0,
    ]),
  );
  const employmentOffers: ResidenceEmploymentOffer[] = workplaces.flatMap((workplace) => {
    if (
      getResidenceDefinition(workplace.building_type)?.kind === 'residence' &&
      workplace.status !== 'under_construction'
    ) {
      return [];
    }
    const vacancies = Math.max(
      0,
      Math.min(
        workplace.desired_workers,
        getMaxDesiredWorkers(workplace.building_type, workplace.status),
      ) - workplace.employed,
    );
    return vacancies > 0
      ? [{
          cityId: workplace.city_id,
          type: workplace.building_type,
          x: workplace.tile_x,
          y: workplace.tile_y,
          wage: workplace.wage,
          vacancies,
        }]
      : [];
  });
  const appealValues = calculateResidenceAppeals(
    residentialRows.map((row) => ({
      id: row.id,
      cityId: row.city_id,
      type: row.building_type,
      x: row.tile_x + RESIDENCES[row.building_type].width / 2,
      y: row.tile_y + RESIDENCES[row.building_type].height / 2,
      occupants: row.occupants,
      employed: employedByResidence.get(row.id) ?? 0,
      capacity: RESIDENCES[row.building_type].capacity,
      salaryAverage: averageIncomes.get(row.id) ?? 0,
      cityAverageSalary: cityAverageSalaries.get(row.city_id) ?? 0,
      constructionAppeal: RESIDENCES[row.building_type].localAppeal,
    })),
    employmentOffers,
  );
  const { rows: productCosts } = await client.query<{
    building_id: string;
    monthly_products_cost: number;
  }>(
    `WITH product_costs AS (
       SELECT building_id, product_id,
              SUM(quantity) FILTER (WHERE consumers IS NOT NULL)
                / NULLIF(SUM(consumers), 0) AS per_person_quantity,
              SUM(spent) FILTER (WHERE consumers IS NOT NULL)
                / NULLIF(SUM(quantity) FILTER (WHERE consumers IS NOT NULL), 0)
                AS average_price
       FROM residence_consumption
       WHERE day >= $1::date - 30 AND day < $1::date
       GROUP BY building_id, product_id
     )
     SELECT building_id,
            COALESCE(SUM(per_person_quantity * average_price), 0)::float8
              AS monthly_products_cost
     FROM product_costs
     GROUP BY building_id`,
    [day],
  );
  const productsCostByResidence = new Map(
    productCosts.map((row) => [row.building_id, row.monthly_products_cost]),
  );
  const candidates = residentialRows.map((row) => {
    const appeal = appealValues.get(row.id);
    if (!appeal) throw new Error(`Não foi possível calcular os apreços da residência ${row.id}.`);
    return {
      id: row.id,
      cityId: row.city_id,
      type: row.building_type,
      rent: row.rent,
      occupants: row.occupants,
      capacity: RESIDENCES[row.building_type].capacity,
      monthlyCost: row.rent + (productsCostByResidence.get(row.id) ?? 0),
      dailyIncome: averageIncomes.get(row.id) ?? 0,
      internalAppeal: appeal.internalAppeal,
    };
  });
  const relocations = planResidenceRelocations(candidates, sourceResidenceId);
  const occupantsByResidence = new Map(candidates.map((row) => [row.id, row.occupants]));
  const affectedResidenceIds = new Set<string>();
  for (const relocation of relocations) {
    occupantsByResidence.set(
      relocation.sourceId,
      (occupantsByResidence.get(relocation.sourceId) ?? 0) - relocation.quantity,
    );
    affectedResidenceIds.add(relocation.sourceId);
    occupantsByResidence.set(
      relocation.destinationId,
      (occupantsByResidence.get(relocation.destinationId) ?? 0) + relocation.quantity,
    );
    affectedResidenceIds.add(relocation.destinationId);
  }
  if (relocations.length > 0) {
    const updates = [...affectedResidenceIds].map((id) => ({
      id,
      occupants: occupantsByResidence.get(id) ?? 0,
    }));
    await client.query(
      `UPDATE all_buildings building
       SET occupants = changes.occupants
       FROM UNNEST($1::uuid[], $2::integer[]) AS changes(id, occupants)
       WHERE building.id = changes.id`,
      [updates.map(({ id }) => id), updates.map(({ occupants }) => occupants)],
    );
    await client.query(
      `INSERT INTO residence_relocation_log
         (day, source_residence_id, destination_residence_id, quantity,
          associated_source, associated_destination)
       SELECT $1::date, batch.source_id, batch.destination_id, batch.quantity,
              batch.associated_source, batch.associated_destination
       FROM UNNEST(
         $2::uuid[], $3::uuid[], $4::integer[],
         $5::double precision[], $6::double precision[]
       ) AS batch(source_id, destination_id, quantity, associated_source, associated_destination)`,
      [
        day,
        relocations.map((item) => item.sourceId),
        relocations.map((item) => item.destinationId),
        relocations.map((item) => item.quantity),
        relocations.map((item) => item.associatedSource),
        relocations.map((item) => item.associatedDestination),
      ],
    );
  }
  return relocations;
}

async function runMonthlyResidenceRelocation(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockStartedAt = performance.now();
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const lockWaitMs = performance.now() - lockStartedAt;
    const { rows: stateRows } = await client.query<{
      day: string;
      day_of_month: number;
      hour: number;
      last_day: string | null;
    }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              EXTRACT(DAY FROM world_time AT TIME ZONE 'UTC')::int AS day_of_month,
              EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour,
              to_char(last_residence_relocation_day, 'YYYY-MM-DD') AS last_day
       FROM world_state WHERE id = 1 FOR UPDATE`,
    );
    const state = stateRows[0];
    if (!state || state.day_of_month !== 7 || state.hour < 3 || state.last_day === state.day) {
      await client.query('ROLLBACK');
      return false;
    }

    const counts = emptyPerformanceCounts();
    return await measurePerformanceStage(
      'mudanças de residência',
      '03:00',
      state.day,
      randomUUID(),
      counts,
      async () => {
        const relocations = await applyResidenceRelocations(client, state.day, counts);
        await client.query(
          'UPDATE world_state SET last_residence_relocation_day = $1 WHERE id = 1',
          [state.day],
        );
        await client.query('COMMIT');
        return relocations.length > 0;
      },
      lockWaitMs,
      false,
      3,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter as mudanças mensais de residência:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function limitResidenceJobAssignments(
  client: PoolClient,
  residenceId: string,
  maximumWorkers: number,
): Promise<void> {
  const { rows } = await client.query<{ workplace_id: string; count: number }>(
    'SELECT workplace_id, count FROM job_assignments WHERE residence_id = $1 ORDER BY workplace_id',
    [residenceId],
  );
  let remaining = maximumWorkers;
  for (const assignment of rows) {
    const retained = Math.min(assignment.count, remaining);
    remaining -= retained;
    if (retained === assignment.count) continue;
    if (retained === 0) {
      await client.query(
        'DELETE FROM job_assignments WHERE workplace_id = $1 AND residence_id = $2',
        [assignment.workplace_id, residenceId],
      );
    } else {
      await client.query(
        'UPDATE job_assignments SET count = $3 WHERE workplace_id = $1 AND residence_id = $2',
        [assignment.workplace_id, residenceId, retained],
      );
    }
  }
}

async function runMonthlyPopulationChange(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockStartedAt = performance.now();
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const lockWaitMs = performance.now() - lockStartedAt;
    const { rows: stateRows } = await client.query<{
      day: string;
      day_of_month: number;
      hour: number;
      last_day: string | null;
    }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              EXTRACT(DAY FROM world_time AT TIME ZONE 'UTC')::int AS day_of_month,
              EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour,
              to_char(last_population_change_day, 'YYYY-MM-DD') AS last_day
       FROM world_state WHERE id = 1 FOR UPDATE`,
    );
    const state = stateRows[0];
    if (!state || state.day_of_month !== 7 || state.hour < 3 || state.last_day === state.day) {
      await client.query('ROLLBACK');
      return false;
    }

    const counts = emptyPerformanceCounts();
    return await measurePerformanceStage(
      'crescimento populacional',
      '03:00',
      state.day,
      randomUUID(),
      counts,
      async () => {
        const { rows: cityRows } = await client.query<{
          id: string;
          center_x: number;
          center_y: number;
        }>('SELECT id, center_x, center_y FROM city_assemblies');
        const { rows: residenceRows } = await client.query<{
          id: string;
          city_id: string;
          building_type: ResidenceType;
          status: ResidentialBuilding['status'];
          occupants: number;
          wellbeing: number;
          rent: number;
        }>(
          `SELECT id, city_id, building_type, status, occupants, wellbeing, rent::float8 AS rent
           FROM all_buildings
           WHERE building_type = ANY($1::text[])`,
          [CITY_RESIDENCE_TYPES],
        );
        const { rows: workplaceRows } = await client.query<{
          city_id: string;
          building_type: ResidenceType;
          status: ResidentialBuilding['status'];
          desired_workers: number;
          employed: number;
        }>(
          `SELECT building.city_id, building.building_type, building.status,
                  building.desired_workers,
                  COALESCE(SUM(assignment.count), 0)::int AS employed
           FROM all_buildings AS building
           LEFT JOIN job_assignments AS assignment ON assignment.workplace_id = building.id
           WHERE building.city_id IS NOT NULL
           GROUP BY building.id`,
        );
        Object.assign(counts, getPerformanceEntityCounts(workplaceRows));
        counts.residences = residenceRows.filter(
          (row) => row.status === 'completed' && RESIDENCES[row.building_type].kind === 'residence',
        ).length;

        const workplacesByCity = new Map<string, EmploymentSummaryWorkplace[]>();
        for (const row of workplaceRows) {
          const workplaces = workplacesByCity.get(row.city_id) ?? [];
          workplaces.push({
            type: row.building_type,
            status: row.status,
            wage: 0,
            desiredWorkers: row.desired_workers,
            employed: row.employed,
          });
          workplacesByCity.set(row.city_id, workplaces);
        }
        const cities: PopulationCity[] = cityRows.map((city) => {
          const employment = getEmploymentSummary(workplacesByCity.get(city.id) ?? []);
          return {
            id: city.id,
            centerX: city.center_x,
            centerY: city.center_y,
            employed: employment.employed,
            jobOffers: employment.jobOffers,
          };
        });
        const residences: PopulationResidence[] = residenceRows.map((residence) => ({
          id: residence.id,
          cityId: residence.city_id,
          type: residence.building_type,
          status: residence.status,
          occupants: residence.occupants,
          wellbeing: residence.wellbeing,
          rent: residence.rent,
        }));
        const previousOccupantsByResidence = new Map(
          residenceRows.map((residence) => [residence.id, residence.occupants]),
        );
        const plan = planMonthlyPopulationChange(cities, residences);
        let changed = false;

        if (plan.occupantsByResidence.size > 0) {
          const updates = [...plan.occupantsByResidence.entries()];
          await client.query(
            `UPDATE all_buildings AS building
             SET occupants = changes.occupants
             FROM UNNEST($1::uuid[], $2::integer[]) AS changes(id, occupants)
             WHERE building.id = changes.id`,
            [updates.map(([id]) => id), updates.map(([, occupants]) => occupants)],
          );
          for (const [residenceId, occupants] of updates) {
            if (occupants < (previousOccupantsByResidence.get(residenceId) ?? occupants)) {
              await limitResidenceJobAssignments(client, residenceId, occupants);
            }
          }
          changed = true;
        }

        const { rowCount: updatedCityCount } = await client.query(
          `UPDATE city_assemblies AS city
           SET population_change_last_month = changes.amount
           FROM UNNEST($1::uuid[], $2::integer[]) AS changes(id, amount)
           WHERE city.id = changes.id
             AND city.population_change_last_month IS DISTINCT FROM changes.amount`,
          [
            cityRows.map((city) => city.id),
            cityRows.map((city) => plan.populationChangeByCity.get(city.id) ?? 0),
          ],
        );
        if ((updatedCityCount ?? 0) > 0) changed = true;
        await client.query(
          'UPDATE world_state SET last_population_change_day = $1 WHERE id = 1',
          [state.day],
        );
        await client.query('COMMIT');
        return changed;
      },
      lockWaitMs,
      false,
      3,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a variação mensal da população:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function logWarehouseDemand(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  warehouseId: string,
  day: string,
  demand: number,
) {
  if (demand <= 0) return;
  await client.query(
    `INSERT INTO warehouse_demand (building_id, day, demand) VALUES ($1, $2, $3)
     ON CONFLICT (building_id, day) DO UPDATE SET demand = warehouse_demand.demand + $3`,
    [warehouseId, day, demand],
  );
}

async function logWarehouseDemandBatch(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  entries: { warehouseId: string; day: string; demand: number }[],
) {
  const positiveEntries = entries.filter((entry) => entry.demand > 0);
  if (positiveEntries.length === 0) return;
  await client.query(
    `INSERT INTO warehouse_demand (building_id, day, demand)
     SELECT batch.building_id, batch.day, batch.demand
     FROM UNNEST($1::uuid[], $2::date[], $3::double precision[])
       AS batch(building_id, day, demand)
     ON CONFLICT (building_id, day) DO UPDATE
     SET demand = warehouse_demand.demand + EXCLUDED.demand`,
    [
      positiveEntries.map((entry) => entry.warehouseId),
      positiveEntries.map((entry) => entry.day),
      positiveEntries.map((entry) => entry.demand),
    ],
  );
}

interface ManualWarehouseTransferQuote {
  maxQuantity: number;
  workPoints: number;
  destinationStock: number;
  destinationCapacity: number | null;
  sourceMinimumStock: number;
  destinationColumn:
    | 'stock'
    | 'tool_stock'
    | 'wood_stock'
    | 'iron_stock'
    | 'charcoal_stock'
    | 'sugarcane_stock'
    | 'input_stock'
    | null;
  destinationType: ResidenceType;
  day: string;
}

type ManualWarehouseTransferQuoteResult =
  | { error: string }
  | { quote: ManualWarehouseTransferQuote };

type ManualTransferFailureReason =
  | 'concurrent_change'
  | 'database_constraint'
  | 'database_unavailable'
  | 'unexpected_failure';

function getManualTransferFailureReason(error: unknown): ManualTransferFailureReason {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (['40001', '40P01', '55P03'].includes(code)) return 'concurrent_change';
  if (code.startsWith('23')) return 'database_constraint';
  if (code.startsWith('08') || ['57P01', '57P02', '57P03'].includes(code)) {
    return 'database_unavailable';
  }
  return 'unexpected_failure';
}

async function getManualWarehouseTransferQuote(
  client: PoolClient,
  userId: string,
  sourceId: string,
  destinationId: string,
  productId: string,
): Promise<ManualWarehouseTransferQuoteResult> {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (!product) return { error: 'invalid_product' };
  if (sourceId === destinationId) return { error: 'same_transfer_building' };

  const { rows: buildings } = await client.query<{
    id: string;
    building_type: ResidenceType;
    created_by: string;
    status: string;
    tile_x: number;
    tile_y: number;
    work_hours_per_day: number;
    stock: number;
    stock_levels: StockLevels;
    tool_stock: number;
    wood_stock: number;
    iron_stock: number;
    charcoal_stock: number;
    sugarcane_stock: number;
    selected_input_product_id: string | null;
  }>(
    `SELECT id, building_type, created_by, status, tile_x, tile_y, work_hours_per_day,
            stock, stock_levels, tool_stock, wood_stock, iron_stock, charcoal_stock, sugarcane_stock,
            selected_input_product_id
     FROM all_buildings
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [[sourceId, destinationId]],
  );
  const source = buildings.find((building) => building.id === sourceId);
  const destination = buildings.find((building) => building.id === destinationId);
  if (!source || !destination) return { error: 'transfer_building_not_found' };
  if (source.created_by !== userId || destination.created_by !== userId) {
    return { error: 'transfer_building_not_owned' };
  }
  if (!isStorageBuilding(source.building_type) || source.status !== 'completed') {
    return { error: 'transfer_source_not_warehouse' };
  }
  if (!canStoreProduct(source.building_type, productId)) {
    return { error: 'transfer_product_not_storable' };
  }
  if (destination.status !== 'completed') return { error: 'transfer_destination_not_completed' };
  if (
    !isWithinLinkRadius(
      { type: source.building_type, x: source.tile_x, y: source.tile_y },
      { type: destination.building_type, x: destination.tile_x, y: destination.tile_y },
    )
  ) {
    return { error: 'transfer_out_of_range' };
  }

  const { rows: [world] } = await client.query<{ day: string }>(
    `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
     FROM world_state WHERE id = 1`,
  );
  if (!world) return { error: 'world_unavailable' };
  const averageTechniques = await loadAverageWorkerTechniques(client, [sourceId]);
  const { rows: [workforce] } = await client.query<{ workers: number; demand: number }>(
    `SELECT
       COALESCE((SELECT SUM(count) FROM job_assignments WHERE workplace_id = $1), 0)::int AS workers,
       COALESCE((SELECT demand FROM warehouse_demand WHERE building_id = $1 AND day = $2::date), 0) AS demand`,
    [sourceId, world.day],
  );
  const availableWorkPoints = Math.max(
    0,
    (workforce?.workers ?? 0) *
      getDailyWorkPoints(
        source.work_hours_per_day,
        RESIDENCE_STATS.health,
        averageTechniques.get(sourceId) ?? 10,
      ) -
      (workforce?.demand ?? 0),
  );

  const { rows: sourceStockRows } = await client.query<{ quantity: number }>(
    `SELECT quantity FROM warehouse_stock
     WHERE building_id = $1 AND product_id = $2 FOR UPDATE`,
    [sourceId, productId],
  );
  const { rows: sourceSettings } = await client.query<{ minimum_stock: number }>(
    `SELECT minimum_stock FROM warehouse_product_settings
     WHERE building_id = $1 AND product_id = $2 FOR UPDATE`,
    [sourceId, productId],
  );
  const sourceStock = sourceStockRows[0]?.quantity ?? 0;
  const sourceMinimumStock = sourceSettings[0]?.minimum_stock ?? 0;
  let destinationStock = 0;
  let destinationCapacity: number | null = 0;
  let destinationFreeCapacity = 0;
  let destinationColumn: ManualWarehouseTransferQuote['destinationColumn'] = null;

  if (isStorageBuilding(destination.building_type)) {
    if (!canStoreProduct(destination.building_type, productId)) {
      return { error: 'transfer_product_not_storable' };
    }
    const { rows: destinationInventory } = await client.query<{ product_id: string; quantity: number }>(
      `SELECT product_id, quantity FROM warehouse_stock WHERE building_id = $1 FOR UPDATE`,
      [destinationId],
    );
    destinationStock =
      destinationInventory.find((item) => item.product_id === productId)?.quantity ?? 0;
    const destinationUsedM3 = destinationInventory.reduce((total, item) => {
      const definition = PRODUCTS.find((entry) => entry.id === item.product_id);
      return total + item.quantity * (definition?.volumeM3 ?? 0);
    }, 0);
    const { rows: [destinationSetting] } = await client.query<{ maximum_stock: number | null }>(
      `SELECT maximum_stock FROM warehouse_product_settings
       WHERE building_id = $1 AND product_id = $2 FOR UPDATE`,
      [destinationId, productId],
    );
    destinationCapacity = destinationSetting?.maximum_stock ?? null;
    const configuredSpace = destinationCapacity === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, destinationCapacity - destinationStock);
    const physicalSpace = Math.max(
      0,
      Math.floor(
        ((RESIDENCES[destination.building_type].storageCapacityM3 ?? 0) - destinationUsedM3) /
          product.volumeM3 +
          1e-9,
      ),
    );
    destinationFreeCapacity = Math.min(configuredSpace, physicalSpace);
  } else {
    const definition = getResidenceDefinition(destination.building_type);
    if (!definition) return { error: 'transfer_product_not_storable' };
    if (definition.stockProductId === productId && (definition.stockCapacity ?? 0) > 0) {
      destinationStock = destination.stock;
      destinationCapacity = getStockCapacity(definition, 'stock', destination.stock_levels);
      destinationColumn = 'stock';
    } else if (productId === 'tools' && (definition.toolCapacity ?? 0) > 0) {
      destinationStock = destination.tool_stock;
      destinationCapacity = getStockCapacity(definition, 'tools', destination.stock_levels);
      destinationColumn = 'tool_stock';
    } else if (productId === 'wood' && (definition.woodCapacity ?? 0) > 0) {
      destinationStock = destination.wood_stock;
      destinationCapacity = getStockCapacity(definition, 'wood', destination.stock_levels);
      destinationColumn = 'wood_stock';
    } else if (productId === 'iron' && (definition.ironCapacity ?? 0) > 0) {
      destinationStock = destination.iron_stock;
      destinationCapacity = getStockCapacity(definition, 'iron', destination.stock_levels);
      destinationColumn = 'iron_stock';
    } else if (productId === 'charcoal' && (definition.charcoalCapacity ?? 0) > 0) {
      destinationStock = destination.charcoal_stock;
      destinationCapacity = getStockCapacity(definition, 'charcoal', destination.stock_levels);
      destinationColumn = 'charcoal_stock';
    } else if (productId === 'sugarcane' && (definition.sugarcaneCapacity ?? 0) > 0) {
      destinationStock = destination.sugarcane_stock;
      destinationCapacity = getStockCapacity(definition, 'sugarcane', destination.stock_levels);
      destinationColumn = 'sugarcane_stock';
    } else if (
      definition.inputCapacities?.[productId] !== undefined &&
      (!definition.selectableInputProductIds ||
        destination.selected_input_product_id === productId)
    ) {
      const { rows: inputStocks } = await client.query<{ quantity: number }>(
        `SELECT quantity FROM building_input_stock
         WHERE building_id = $1 AND product_id = $2 FOR UPDATE`,
        [destinationId, productId],
      );
      destinationStock = inputStocks[0]?.quantity ?? 0;
      destinationCapacity = getStockCapacity(
        definition,
        `input:${productId}`,
        destination.stock_levels,
      );
      destinationColumn = 'input_stock';
    } else {
      return { error: 'transfer_product_not_storable' };
    }
    destinationFreeCapacity = Math.max(0, destinationCapacity - destinationStock);
  }

  return {
    quote: {
      maxQuantity: getMaxManualTransferQuantity({
        productId,
        sourceStock,
        sourceMinimumStock,
        destinationFreeCapacity,
        availableWorkPoints,
      }),
      workPoints: availableWorkPoints,
      destinationStock,
      destinationCapacity,
      sourceMinimumStock,
      destinationColumn,
      destinationType: destination.building_type,
      day: world.day,
    },
  };
}

interface WarehouseTradeBuildingRow {
  id: string;
  created_by: string;
  building_type: ResidenceType;
  tile_x: number;
  tile_y: number;
  work_hours_per_day: number;
  workers: number;
}

function mapAverageWorkerTechniques(
  rows: readonly { workplace_id: string; count: number; residence_wellbeing: number }[],
): Map<string, number> {
  const workersByWorkplace = new Map<string, { technique: number; count: number }[]>();
  for (const row of rows) {
    const workers = workersByWorkplace.get(row.workplace_id) ?? [];
    workers.push({ technique: getWorkerTechnique(row.residence_wellbeing), count: row.count });
    workersByWorkplace.set(row.workplace_id, workers);
  }
  return new Map(
    [...workersByWorkplace].flatMap(([workplaceId, workers]) => {
      const technique = getAverageWorkerTechnique(workers);
      return technique === null ? [] : [[workplaceId, technique] as const];
    }),
  );
}

async function loadAverageWorkerTechniques(
  client: PoolClient,
  workplaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (workplaceIds.length === 0) return new Map();
  const { rows } = await client.query<{
    workplace_id: string;
    count: number;
    residence_wellbeing: number;
  }>(
    `SELECT assignments.workplace_id, assignments.count,
            COALESCE(residence.wellbeing, 0)::float8 AS residence_wellbeing
     FROM job_assignments assignments
     JOIN all_buildings residence ON residence.id = assignments.residence_id
     WHERE assignments.workplace_id = ANY($1::uuid[])`,
    [workplaceIds],
  );
  return mapAverageWorkerTechniques(rows);
}

interface WarehouseTradeStockRow {
  building_id: string;
  product_id: string;
  quantity: number;
}

interface WarehouseTradeSettingRow {
  building_id: string;
  product_id: string;
  minimum_stock: number;
  maximum_stock: number | null;
  price: number;
  mode: 'sell' | 'buy';
}

function mapWarehouseTradeWarehouses(
  buildings: WarehouseTradeBuildingRow[],
  stockRows: WarehouseTradeStockRow[],
  settingRows: WarehouseTradeSettingRow[],
  averageTechniques: ReadonlyMap<string, number>,
): TradeWarehouse[] {
  const stockByBuilding = new Map<string, Map<string, number>>();
  const settingsByBuilding = new Map<
    string,
    Map<string, { minimumStock: number; maximumStock: number | null; price: number; mode: 'sell' | 'buy' }>
  >();

  for (const building of buildings) {
    stockByBuilding.set(building.id, new Map());
    settingsByBuilding.set(building.id, new Map());
  }
  for (const item of stockRows) {
    const stock = stockByBuilding.get(item.building_id);
    if (!stock) throw new Error('O estoque consultado pertence a um armazém desconhecido.');
    stock.set(item.product_id, item.quantity);
  }
  for (const item of settingRows) {
    const settings = settingsByBuilding.get(item.building_id);
    if (!settings) throw new Error('A configuração consultada pertence a um armazém desconhecido.');
    settings.set(item.product_id, {
      minimumStock: item.minimum_stock,
      maximumStock: item.maximum_stock,
      price: item.price,
      mode: item.mode,
    });
  }

  return buildings.map((building) => {
    const stock = stockByBuilding.get(building.id);
    const settings = settingsByBuilding.get(building.id);
    if (!stock || !settings) throw new Error('Não foi possível montar os dados do armazém.');
    return {
      id: building.id,
      ownerId: building.created_by,
      type: building.building_type,
      x: building.tile_x,
      y: building.tile_y,
      capacityM3: RESIDENCES[building.building_type].storageCapacityM3 ?? 0,
      workPoints:
        (building.workers *
          getDailyWorkPoints(
            building.work_hours_per_day,
            RESIDENCE_STATS.health,
            averageTechniques.get(building.id) ?? 10,
          )) /
        2,
      stock,
      settings,
    };
  });
}

async function applyWarehouseTrades(
  client: PoolClient,
  trades: WarehouseTrade[],
  ownerOf: Map<string, string>,
  day: string,
): Promise<void> {
  for (const trade of trades) {
    const buyer = ownerOf.get(trade.buyerId);
    const seller = ownerOf.get(trade.sellerId);
    if (!buyer || !seller) throw new Error('Uma troca de armazém não tem comprador ou vendedor válido.');

    const cost = roundCurrency(trade.quantity * trade.price);
    await client.query(
      `INSERT INTO warehouse_trade_history
         (day, buyer_id, seller_id, product_id, quantity, unit_price)
       VALUES ($1::date, $2, $3, $4, $5, $6)`,
      [day, trade.buyerId, trade.sellerId, trade.productId, trade.quantity, trade.price],
    );
    await client.query(
      'UPDATE warehouse_stock SET quantity = quantity - $3 WHERE building_id = $1 AND product_id = $2',
      [trade.sellerId, trade.productId, trade.quantity],
    );
    await client.query(
      `INSERT INTO warehouse_stock (building_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (building_id, product_id) DO UPDATE SET quantity = warehouse_stock.quantity + $3`,
      [trade.buyerId, trade.productId, trade.quantity],
    );
    for (const [userId, delta] of [
      [buyer, -cost],
      [seller, cost],
    ] as const) {
      await client.query(
        `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $3::numeric + $2::numeric)
         ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance + $2::numeric`,
        [userId, delta, STARTING_BALANCE],
      );
    }
    await logWarehouseDemand(
      client,
      trade.buyerId,
      day,
      getTransportDemand(trade.productId, trade.quantity),
    );
  }
}

async function limitJobAssignments(
  client: PoolClient,
  workplaceId: string,
  maximumWorkers: number,
): Promise<void> {
  const { rows } = await client.query<{ residence_id: string; count: number }>(
    'SELECT residence_id, count FROM job_assignments WHERE workplace_id = $1 ORDER BY residence_id',
    [workplaceId],
  );
  let remaining = maximumWorkers;
  for (const assignment of rows) {
    const retained = Math.min(assignment.count, remaining);
    remaining -= retained;
    if (retained === assignment.count) continue;
    if (retained === 0) {
      await client.query(
        'DELETE FROM job_assignments WHERE workplace_id = $1 AND residence_id = $2',
        [workplaceId, assignment.residence_id],
      );
    } else {
      await client.query(
        'UPDATE job_assignments SET count = $3 WHERE workplace_id = $1 AND residence_id = $2',
        [workplaceId, assignment.residence_id, retained],
      );
    }
  }
}

interface ProductionHistoryEntry {
  buildingId: string;
  workPoints?: number;
  produced?: number;
  transported?: number;
  efficiency?: number;
}

async function applyWalletBatch(
  client: PoolClient,
  amountsByUser: Map<string, number>,
  operation: 'credit' | 'debit',
): Promise<void> {
  if (amountsByUser.size === 0) return;
  const userIds = [...amountsByUser.keys()];
  const amounts = userIds.map((userId) => amountsByUser.get(userId) ?? 0);
  const balanceChange = operation === 'credit' ? '+' : '-';
  const conflictAmount = operation === 'credit'
    ? 'EXCLUDED.balance - $3::numeric'
    : '$3::numeric - EXCLUDED.balance';
  await client.query(
    `INSERT INTO player_wallets (user_id, balance)
     SELECT changes.user_id, $3::numeric ${balanceChange} changes.amount
     FROM UNNEST($1::text[], $2::numeric[]) AS changes(user_id, amount)
     WHERE TRUE
     ON CONFLICT (user_id) DO UPDATE
     SET balance = player_wallets.balance ${balanceChange} (${conflictAmount})`,
    [userIds, amounts, STARTING_BALANCE],
  );
}

async function removeCrossCityJobAssignments(
  client: PoolClient,
  buildingId: string | null = null,
): Promise<void> {
  await client.query(
    `DELETE FROM job_assignments assignment
     USING all_buildings workplace, all_buildings residence
     WHERE assignment.workplace_id = workplace.id
       AND assignment.residence_id = residence.id
       AND workplace.city_id <> residence.city_id
       AND ($1::uuid IS NULL OR workplace.id = $1 OR residence.id = $1)`,
    [buildingId],
  );
}

async function logProductionBatch(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  day: string,
  entries: ProductionHistoryEntry[],
) {
  if (entries.length === 0) return;
  await client.query('SAVEPOINT production_log', []);
  try {
    await client.query(
      `WITH batch AS MATERIALIZED (
         SELECT *
         FROM UNNEST(
           $2::uuid[], $3::double precision[], $4::double precision[],
           $5::double precision[], $6::double precision[]
         ) AS input_rows(building_id, work_points, produced, transported, efficiency)
       ), updated AS (
         UPDATE production_history history
         SET work_points = COALESCE(batch.work_points, history.work_points),
             produced = COALESCE(batch.produced, history.produced),
             transported = history.transported + COALESCE(batch.transported, 0),
             efficiency = COALESCE(batch.efficiency, history.efficiency)
         FROM batch
         WHERE history.building_id = batch.building_id AND history.day = $1::date
         RETURNING history.building_id
       )
       INSERT INTO production_history
         (building_id, day, work_points, produced, transported, efficiency)
       SELECT batch.building_id, $1::date,
              COALESCE(batch.work_points, 0), COALESCE(batch.produced, 0),
              COALESCE(batch.transported, 0), COALESCE(batch.efficiency, 100)
       FROM batch
       LEFT JOIN updated USING (building_id)
       WHERE updated.building_id IS NULL`,
      [
        day,
        entries.map((entry) => entry.buildingId),
        entries.map((entry) => entry.workPoints ?? null),
        entries.map((entry) => entry.produced ?? null),
        entries.map((entry) => entry.transported ?? null),
        entries.map((entry) => entry.efficiency ?? null),
      ],
    );
    await client.query('RELEASE SAVEPOINT production_log', []);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT production_log', []);
    await client.query('RELEASE SAVEPOINT production_log', []);
    console.error('Não foi possível gravar o histórico de produção:', error);
  }
}

function getProductionWorkPointsPerProductUnit(
  definition: (typeof RESIDENCES)[ResidenceType],
): number | null {
  if (definition.cropRule) {
    const rule = definition.cropRule;
    let total = 0;
    for (let month = 1; month <= 12; month += 1) {
      const plantedDay = `2024-${String(month).padStart(2, '0')}-15`;
      const growthDays =
        (Date.parse(`${getHarvestDay(plantedDay, rule.growthMonths)}T00:00:00.000Z`) -
          Date.parse(`${plantedDay}T00:00:00.000Z`)) /
        86_400_000;
      const plantingFactor = rule.plantingEfficiencyByQuarter[Math.floor((month - 1) / 3)];
      const expectedYield = rule.baseYield * plantingFactor;
      if (expectedYield <= 0) continue;
      total +=
        (rule.dailyWorkPoints * growthDays) / expectedYield +
        rule.harvestWorkPointsPerUnit;
    }
    return total / 12;
  }
  const rule = definition.production;
  return rule ? rule.workPointsPerUnit / (rule.batchSize ?? 1) : null;
}

function getConfiguredProductionInputsPerUnit(
  definition: (typeof RESIDENCES)[ResidenceType],
): { productId: string; quantity: number }[] {
  const rule = definition.production;
  if (!rule) return [];
  const batchSize = rule.batchSize ?? 1;
  const quantities = new Map<string, number>();
  const addInput = (productId: string | undefined, batchQuantity: number | undefined) => {
    if (productId && batchQuantity && batchQuantity > 0) {
      quantities.set(productId, (quantities.get(productId) ?? 0) + batchQuantity / batchSize);
    }
  };
  addInput('wood', rule.batchWood);
  addInput('iron', rule.batchIron);
  addInput('charcoal', rule.batchCharcoal);
  addInput('tools', rule.batchTools);
  addInput(rule.batchStockProductId, rule.batchStockAmount);
  for (const [productId, quantity] of Object.entries(rule.batchInputs ?? {})) {
    addInput(productId, quantity);
  }
  for (const [productId, quantity] of Object.entries(rule.batchInputRates ?? {})) {
    addInput(productId, quantity);
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
}

async function recordProductCostEstimates(client: PoolClient, day: string): Promise<void> {
  const [
    previousCostResult,
    producerHistoryResult,
    productionInputResult,
    importResult,
    ownerResult,
  ] = await Promise.all([
    client.query<{ user_id: string; product_id: string; unit_cost: string }>(
      `SELECT DISTINCT ON (user_id, product_id) user_id, product_id, unit_cost::text
       FROM product_cost_history
       WHERE day < $1::date
       ORDER BY user_id, product_id, day DESC`,
      [day],
    ),
    client.query<{
      id: string;
      user_id: string;
      building_type: ResidenceType;
      produced: number;
      work_points: number;
      employee_expense: number;
    }>(
      `SELECT building.id, building.created_by AS user_id, building.building_type,
              history.produced, history.work_points,
              COALESCE(payroll.employee_expense, 0)::float8 AS employee_expense
       FROM production_history history
       JOIN all_buildings building ON building.id = history.building_id
       LEFT JOIN building_payroll_history payroll
         ON payroll.building_id = building.id AND payroll.day = history.day
       WHERE history.day = $1::date
         AND building.building_type = ANY($2::text[])
         AND building.status = 'completed'`,
      [day, PRODUCT_PRODUCER_TYPES],
    ),
    client.query<{ building_id: string; product_id: string; quantity: number }>(
      `SELECT history.building_id, history.product_id, history.quantity
       FROM production_input_history history
       JOIN all_buildings building ON building.id = history.building_id
       WHERE history.day = $1::date
         AND building.building_type = ANY($2::text[])`,
      [day, PRODUCT_PRODUCER_TYPES],
    ),
    client.query<{
      user_id: string;
      product_id: string;
      quantity: string;
      expense: string;
    }>(
      `SELECT buyer.created_by AS user_id, history.product_id,
              SUM(history.quantity)::text AS quantity,
              SUM(history.quantity::numeric * history.unit_price)::text AS expense
       FROM warehouse_trade_history history
       JOIN all_buildings buyer ON buyer.id = history.buyer_id
       JOIN all_buildings seller ON seller.id = history.seller_id
       WHERE history.day = $1::date
         AND buyer.created_by <> seller.created_by
       GROUP BY buyer.created_by, history.product_id`,
      [day],
    ),
    client.query<{ user_id: string }>(
      'SELECT DISTINCT created_by AS user_id FROM all_buildings',
    ),
  ]);
  const previousCosts = new Map<string, number>(
    previousCostResult.rows.map((row) => [
      `${row.user_id}\u0000${row.product_id}`,
      Number(row.unit_cost),
    ]),
  );
  const inputsByBuilding = new Map<string, { productId: string; quantity: number }[]>();
  for (const row of productionInputResult.rows) {
    const inputs = inputsByBuilding.get(row.building_id) ?? [];
    inputs.push({ productId: row.product_id, quantity: row.quantity });
    inputsByBuilding.set(row.building_id, inputs);
  }
  const productionByProduct = new Map<
    string,
    { quantity: number; totalCost: number }
  >();
  for (const row of producerHistoryResult.rows) {
    const definition = RESIDENCES[row.building_type];
    const productId = definition.stockProductId;
    if (!productId || row.produced <= 0) continue;
    const key = `${row.user_id}\u0000${productId}`;
    const previousCost = previousCosts.get(key) ?? null;
    const costPerWorkPoint =
      row.work_points > 0 ? row.employee_expense / row.work_points : null;
    const workPointsPerUnit = getProductionWorkPointsPerProductUnit(definition);
    let productionUnitCost = previousCost;
    if (costPerWorkPoint !== null && workPointsPerUnit !== null) {
      const recordedInputs = inputsByBuilding.get(row.id);
      const inputsPerUnit = recordedInputs?.length
        ? recordedInputs.map((input) => ({
            quantity: input.quantity / row.produced,
            unitCost: previousCosts.get(`${row.user_id}\u0000${input.productId}`) ?? null,
          }))
        : getConfiguredProductionInputsPerUnit(definition).map((input) => ({
            quantity: input.quantity,
            unitCost: previousCosts.get(`${row.user_id}\u0000${input.productId}`) ?? null,
          }));
      productionUnitCost = estimateProductionUnitCost(
        workPointsPerUnit,
        costPerWorkPoint,
        inputsPerUnit,
      );
    }
    if (productionUnitCost === null) continue;
    const production = productionByProduct.get(key) ?? { quantity: 0, totalCost: 0 };
    production.quantity += row.produced;
    production.totalCost += row.produced * productionUnitCost;
    productionByProduct.set(key, production);
  }
  const importsByProduct = new Map<
    string,
    { quantity: number; expense: number }
  >();
  for (const row of importResult.rows) {
    importsByProduct.set(`${row.user_id}\u0000${row.product_id}`, {
      quantity: Number(row.quantity),
      expense: Number(row.expense),
    });
  }
  const owners = new Set(ownerResult.rows.map((row) => row.user_id));
  for (const row of importResult.rows) owners.add(row.user_id);
  const entries: { userId: string; productId: string; unitCost: number; sourceQuantity: number }[] =
    [];
  for (const userId of owners) {
    for (const product of PRODUCTS) {
      const key = `${userId}\u0000${product.id}`;
      const previousUnitCost = previousCosts.get(key) ?? null;
      const production = productionByProduct.get(key) ?? { quantity: 0, totalCost: 0 };
      const imported = importsByProduct.get(key) ?? { quantity: 0, expense: 0 };
      const estimate = estimateBlendedUnitCost({
        producedQuantity: production.quantity,
        productionUnitCost:
          production.quantity > 0 ? production.totalCost / production.quantity : null,
        importedQuantity: imported.quantity,
        importExpense: imported.expense,
        previousUnitCost,
      });
      if (estimate.unitCost === null) continue;
      entries.push({
        userId,
        productId: product.id,
        unitCost: estimate.unitCost,
        sourceQuantity: estimate.sourceQuantity,
      });
    }
  }
  if (entries.length === 0) return;
  await client.query(
    `INSERT INTO product_cost_history (user_id, product_id, day, unit_cost, source_quantity)
     SELECT batch.user_id, batch.product_id, $1::date, batch.unit_cost, batch.source_quantity
     FROM UNNEST($2::text[], $3::text[], $4::numeric[], $5::double precision[])
       AS batch(user_id, product_id, unit_cost, source_quantity)
     ON CONFLICT (user_id, product_id, day) DO UPDATE
     SET unit_cost = EXCLUDED.unit_cost,
         source_quantity = EXCLUDED.source_quantity`,
    [
      day,
      entries.map((entry) => entry.userId),
      entries.map((entry) => entry.productId),
      entries.map((entry) => entry.unitCost),
      entries.map((entry) => entry.sourceQuantity),
    ],
  );
  await client.query(
    `INSERT INTO player_product_costs (user_id, product_id, unit_cost, updated_day)
     SELECT batch.user_id, batch.product_id, batch.unit_cost, $4::date
     FROM UNNEST($1::text[], $2::text[], $3::numeric[])
       AS batch(user_id, product_id, unit_cost)
     ON CONFLICT (user_id, product_id) DO UPDATE
     SET unit_cost = EXCLUDED.unit_cost,
         updated_day = EXCLUDED.updated_day`,
    [
      entries.map((entry) => entry.userId),
      entries.map((entry) => entry.productId),
      entries.map((entry) => entry.unitCost),
      day,
    ],
  );
}

// Às 12:00 distribui os trabalhadores e às 00:00 cobra a folha de pagamento dos donos.
async function runDailyEmployment(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockStartedAt = performance.now();
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const lockWaitMs = performance.now() - lockStartedAt;
    const { rows: stateRows } = await client.query<{
      day: string;
      hour: number;
      last_alloc: string | null;
      last_payroll: string | null;
      last_trade: string | null;
      last_spoilage: string | null;
    }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour,
              to_char(last_job_allocation_day, 'YYYY-MM-DD') AS last_alloc,
              to_char(last_payroll_day, 'YYYY-MM-DD') AS last_payroll,
              last_warehouse_trade_slot AS last_trade,
              to_char(last_spoilage_day, 'YYYY-MM-DD') AS last_spoilage
       FROM world_state WHERE id = 1 FOR UPDATE`,
    );
    const state = stateRows[0];
    if (!state) {
      await client.query('ROLLBACK');
      return false;
    }

    let changed = false;
    let productCostUpdateDue = false;
    const performanceCycleId = randomUUID();
    if (state.last_payroll === null) {
      await client.query('UPDATE world_state SET last_payroll_day = $1 WHERE id = 1', [state.day]);
    } else if (state.last_payroll < state.day) {
      productCostUpdateDue = true;
      const payrollCounts = emptyPerformanceCounts();
      const { workplaces, workers, assignmentRows, averageTechniques } = await measurePerformanceStage(
        'folha e aluguel',
        '00:00',
        state.day,
        performanceCycleId,
        payrollCounts,
        async () => {
      const { rows: workplaces } = await client.query<{
        id: string;
        created_by: string;
        city_id: string;
        desired_workers: number;
        wage: number;
        status: string;
        building_type: ResidenceType;
        work_hours_per_day: number;
        work_points_done: number;
        tile_x: number;
        tile_y: number;
        price: number;
        stock: number;
        occupants: number;
        wellbeing: number;
        rent: number;
      }>(
        `SELECT id, created_by, city_id, desired_workers, wage, status, building_type, work_hours_per_day, work_points_done,
                tile_x, tile_y, price, stock, occupants, wellbeing, rent
         FROM all_buildings`,
      );
      Object.assign(payrollCounts, getPerformanceEntityCounts(workplaces));
      const { rows: assignmentRows } = await client.query<{
        workplace_id: string;
        residence_id: string;
        count: number;
        residence_wellbeing: number;
      }>(
        `SELECT assignments.workplace_id, assignments.residence_id, assignments.count,
                COALESCE(residence.wellbeing, 0)::float8 AS residence_wellbeing
         FROM job_assignments assignments
         JOIN all_buildings residence ON residence.id = assignments.residence_id
         ORDER BY assignments.workplace_id, assignments.residence_id`,
      );
      const averageTechniques = mapAverageWorkerTechniques(assignmentRows);
      const owed = getPayroll(
        workplaces.map((row) => ({ id: row.id, ownerId: row.created_by, wage: row.wage })),
        assignmentRows.map((row) => ({
          workplaceId: row.workplace_id,
          residenceId: row.residence_id,
          count: row.count,
        })),
      );
      await applyWalletBatch(client, owed, 'debit');
      // Work Points diários das obras: cada funcionário contribui conforme a carga horária.
      const workers = new Map<string, number>();
      for (const row of assignmentRows) {
        workers.set(row.workplace_id, (workers.get(row.workplace_id) ?? 0) + row.count);
      }
      const rentIncomeByOwner = new Map<string, number>();
      const rentEntries: { id: string; occupants: number; rent: number; revenue: number }[] = [];
      for (const residence of workplaces) {
        if (
          residence.status !== 'completed' ||
          getResidenceDefinition(residence.building_type)?.kind !== 'residence'
        ) continue;
        const revenue = calculateDailyRentRevenue(residence.occupants, residence.rent);
        rentEntries.push({
          id: residence.id,
          occupants: residence.occupants,
          rent: residence.rent,
          revenue,
        });
        if (revenue > 0) {
          rentIncomeByOwner.set(
            residence.created_by,
            roundCurrency((rentIncomeByOwner.get(residence.created_by) ?? 0) + revenue),
          );
        }
      }
      if (rentEntries.length > 0) {
        await client.query(
          `INSERT INTO residence_rent_history
             (building_id, day, occupants, rent_per_person, rent_revenue)
           SELECT batch.building_id, $1::date, batch.occupants, batch.rent, batch.revenue
           FROM UNNEST(
             $2::uuid[], $3::integer[], $4::numeric[], $5::numeric[]
           ) AS batch(building_id, occupants, rent, revenue)
           WHERE TRUE
           ON CONFLICT (building_id, day) DO UPDATE
           SET occupants = EXCLUDED.occupants,
               rent_per_person = EXCLUDED.rent_per_person,
               rent_revenue = EXCLUDED.rent_revenue`,
          [
            state.day,
            rentEntries.map((entry) => entry.id),
            rentEntries.map((entry) => entry.occupants),
            rentEntries.map((entry) => entry.rent),
            rentEntries.map((entry) => entry.revenue),
          ],
        );
      }
      await applyWalletBatch(client, rentIncomeByOwner, 'credit');
      if (rentIncomeByOwner.size > 0) {
        changed = true;
      }
      if (workplaces.length > 0) {
        await client.query(
          `INSERT INTO building_payroll_history (building_id, day, employee_expense)
           SELECT batch.building_id, $1::date, batch.employee_expense
           FROM UNNEST($2::uuid[], $3::numeric[])
             AS batch(building_id, employee_expense)
           WHERE TRUE
           ON CONFLICT (building_id, day)
           DO UPDATE SET employee_expense = EXCLUDED.employee_expense`,
          [
            state.day,
            workplaces.map((building) => building.id),
            workplaces.map((building) =>
              roundCurrency((workers.get(building.id) ?? 0) * building.wage),
            ),
          ],
        );
      }
      const warehousePayroll = workplaces.filter(
        (building) => getResidenceDefinition(building.building_type)?.kind === 'warehouse',
      );
      if (warehousePayroll.length > 0) {
        await client.query(
          `INSERT INTO warehouse_payroll_history (building_id, day, employee_expense)
           SELECT batch.building_id, $1::date, batch.employee_expense
           FROM UNNEST($2::uuid[], $3::numeric[])
             AS batch(building_id, employee_expense)
           WHERE TRUE
           ON CONFLICT (building_id, day)
           DO UPDATE SET employee_expense = EXCLUDED.employee_expense`,
          [
            state.day,
            warehousePayroll.map((warehouse) => warehouse.id),
            warehousePayroll.map((warehouse) =>
              roundCurrency((workers.get(warehouse.id) ?? 0) * warehouse.wage),
            ),
          ],
        );
      }
      const constructionUpdates: {
        id: string;
        done: number;
        completed: boolean;
        maximumWorkers: number;
      }[] = [];
      for (const site of workplaces) {
        const count = workers.get(site.id) ?? 0;
        if (site.status !== 'under_construction' || count === 0) continue;
        const needed = RESIDENCES[site.building_type].workPoints;
        const progress = advanceConstruction(
          site.work_points_done,
          needed,
          count,
          site.work_hours_per_day,
          RESIDENCE_STATS.health,
          averageTechniques.get(site.id) ?? 10,
        );
        constructionUpdates.push({
          id: site.id,
          done: progress.done,
          completed: progress.completed,
          maximumWorkers: RESIDENCES[site.building_type].maxWorkers,
        });
        changed = true;
      }
      if (constructionUpdates.length > 0) {
        await client.query(
          `UPDATE all_buildings building
           SET work_points_done = progress.work_points_done,
               status = CASE WHEN progress.completed THEN 'completed' ELSE building.status END,
               completed_at = CASE
                 WHEN progress.completed THEN clock_timestamp()
                 ELSE building.completed_at
               END,
               desired_workers = CASE
                 WHEN progress.completed THEN LEAST(building.desired_workers, progress.maximum_workers)
                 ELSE building.desired_workers
               END
           FROM UNNEST(
             $1::uuid[], $2::double precision[], $3::boolean[], $4::integer[]
           ) AS progress(id, work_points_done, completed, maximum_workers)
           WHERE building.id = progress.id`,
          [
            constructionUpdates.map((update) => update.id),
            constructionUpdates.map((update) => update.done),
            constructionUpdates.map((update) => update.completed),
            constructionUpdates.map((update) => update.maximumWorkers),
          ],
        );
      }
      const completedSites = constructionUpdates.filter((update) => update.completed);
      if (completedSites.length > 0) {
        const remainingByWorkplace = new Map(
          completedSites.map((update) => [update.id, update.maximumWorkers]),
        );
        const deletedAssignments: { workplaceId: string; residenceId: string }[] = [];
        const reducedAssignments: { workplaceId: string; residenceId: string; count: number }[] = [];
        for (const assignment of assignmentRows) {
          const remaining = remainingByWorkplace.get(assignment.workplace_id);
          if (remaining === undefined) continue;
          const retained = Math.min(assignment.count, remaining);
          remainingByWorkplace.set(assignment.workplace_id, remaining - retained);
          if (retained === assignment.count) continue;
          if (retained === 0) {
            deletedAssignments.push({
              workplaceId: assignment.workplace_id,
              residenceId: assignment.residence_id,
            });
          } else {
            reducedAssignments.push({
              workplaceId: assignment.workplace_id,
              residenceId: assignment.residence_id,
              count: retained,
            });
          }
        }
        if (deletedAssignments.length > 0) {
          await client.query(
            `DELETE FROM job_assignments assignment
             USING UNNEST($1::uuid[], $2::uuid[]) AS removed(workplace_id, residence_id)
             WHERE assignment.workplace_id = removed.workplace_id
               AND assignment.residence_id = removed.residence_id`,
            [
              deletedAssignments.map((assignment) => assignment.workplaceId),
              deletedAssignments.map((assignment) => assignment.residenceId),
            ],
          );
        }
        if (reducedAssignments.length > 0) {
          await client.query(
            `UPDATE job_assignments assignment
             SET count = reduced.count
             FROM UNNEST($1::uuid[], $2::uuid[], $3::integer[])
               AS reduced(workplace_id, residence_id, count)
             WHERE assignment.workplace_id = reduced.workplace_id
               AND assignment.residence_id = reduced.residence_id`,
            [
              reducedAssignments.map((assignment) => assignment.workplaceId),
              reducedAssignments.map((assignment) => assignment.residenceId),
              reducedAssignments.map((assignment) => assignment.count),
            ],
          );
        }
      }
      return { workplaces, workers, assignmentRows, averageTechniques };
        },
        lockWaitMs,
        false,
        3,
      );
      // Falhas na economia (vendas, produção, transporte) não devem desfazer folha e obras do dia.
      await client.query('SAVEPOINT daily_economy');
      // Cada etapa tem seu próprio savepoint: uma falha nas vendas ou no transporte não desfaz a produção.
      const runStage = async (name: string, stage: () => Promise<void>): Promise<boolean> =>
        measurePerformanceStage(name, '00:00', state.day, performanceCycleId, payrollCounts, async () => {
        await client.query('SAVEPOINT economy_stage');
        try {
          await stage();
          await client.query('RELEASE SAVEPOINT economy_stage');
          return true;
        } catch (stageError) {
          await client.query('ROLLBACK TO SAVEPOINT economy_stage');
          console.error(`Falha na economia diária (${name}):`, stageError);
          return false;
        }
      }, 0, true);
      try {
      await runStage('vendas', async () => {
      // Vendas da Cesta Básica: capacidade diária vem dos Work Points das lojas.
      const wageOf = new Map(workplaces.map((row) => [row.id, row.wage]));
      const employedResidents = new Map<string, number>();
      for (const assignment of assignmentRows) {
        employedResidents.set(
          assignment.residence_id,
          (employedResidents.get(assignment.residence_id) ?? 0) + assignment.count,
        );
      }
      const incomeByEmployedResident = getAverageIncomes(
        [...employedResidents.keys()].map((id) => ({ id })),
        wageOf,
        assignmentRows.map((row) => ({
          workplaceId: row.workplace_id,
          residenceId: row.residence_id,
          count: row.count,
        })),
      );
      const shopWorkplaces = workplaces.filter(
        (row) =>
          row.status === 'completed' &&
          getResidenceDefinition(row.building_type)?.kind === 'shop' &&
          getResidenceDefinition(row.building_type)?.stockProductId,
      );
      const shops = shopWorkplaces.map((row) => {
        const definition = getResidenceDefinition(row.building_type);
        if (!definition?.stockProductId) {
          throw new Error(`A loja ${row.id} não tem produto de venda configurado.`);
        }
        return {
          id: row.id,
          ownerId: row.created_by,
          cityId: row.city_id,
          productId: definition.stockProductId,
          type: row.building_type,
          x: row.tile_x,
          y: row.tile_y,
          price: row.price,
          stock: row.stock,
          wage: row.wage,
          workers: workers.get(row.id) ?? 0,
          capacity: getShopSalesCapacity(
            row.building_type,
            (workers.get(row.id) ?? 0) *
              getDailyWorkPoints(
                row.work_hours_per_day,
                RESIDENCE_STATS.health,
                averageTechniques.get(row.id) ?? 10,
              ),
            workers.get(row.id) ?? 0,
          ),
        };
      });
      const shopTypes = [...new Set(shopWorkplaces.map((shop) => shop.building_type))];
      const { rows: monthlySalesRows } = shopTypes.length
        ? await client.query<{
            city_id: string;
            building_type: ResidenceType;
            units_sold: number;
            sale_price: number;
          }>(
            `SELECT shop.city_id, shop.building_type, history.units_sold, history.sale_price
             FROM commerce_history history
             JOIN all_buildings shop ON shop.id = history.building_id
             WHERE history.day >= $1::date - $3::integer
               AND history.day < $1::date
               AND shop.status = 'completed'
               AND shop.building_type = ANY($2::text[])`,
            [state.day, shopTypes, GAME_RULES.consumption.averagePriceWindowDays],
          )
        : { rows: [] };
      const monthlySales: CityProductSale[] = monthlySalesRows.flatMap((row) => {
        const productId = getResidenceDefinition(row.building_type)?.stockProductId;
        return productId
          ? [{
              cityId: row.city_id,
              productId,
              unitsSold: row.units_sold,
              price: row.sale_price,
            }]
          : [];
      });
      const averagePrices = getCityProductAveragePrices(shops, monthlySales);
      const homes = workplaces
        .filter(
          (row) =>
            row.status === 'completed' &&
            getResidenceDefinition(row.building_type)?.kind === 'residence' &&
            row.occupants > 0,
        )
        .map((row) => ({
          id: row.id,
          cityId: row.city_id,
          type: row.building_type,
          x: row.tile_x,
          y: row.tile_y,
          consumers: employedResidents.get(row.id) ?? 0,
          averageIncome: incomeByEmployedResident.get(row.id) ?? 0,
          wellbeing: row.wellbeing,
        }));
      const populationByResidence = new Map(
        workplaces.map((building) => [building.id, building.occupants]),
      );
      const sold = new Map<string, number>();
      const bought = new Map<string, { quantity: number; spent: number }>();
      const shopPrice = new Map(shops.map((shop) => [shop.id, shop.price]));
      const salesPlan = planShopSalesDetailed(
        homes,
        shops,
        demandBasicByProduct,
        averagePrices,
        Math.random,
        monthlySales,
      );
      const desiredConsumptionByResidence = new Map(
        salesPlan.desiredConsumption.map((entry) => [
          `${entry.residenceId}\u0000${entry.productId}`,
          entry.quantity,
        ]),
      );
      for (const purchase of salesPlan.purchases) {
        sold.set(purchase.shopId, (sold.get(purchase.shopId) ?? 0) + purchase.quantity);
        const key = `${purchase.residenceId}\u0000${purchase.productId}`;
        const total = bought.get(key) ?? { quantity: 0, spent: 0 };
        total.quantity += purchase.quantity;
        total.spent = roundCurrency(
          total.spent + purchase.quantity * (shopPrice.get(purchase.shopId) ?? 0),
        );
        bought.set(key, total);
      }
      const consumptionEntries: {
        buildingId: string;
        productId: string;
        quantity: number;
        desiredQuantity: number;
        spent: number;
        occupants: number;
        consumers: number;
      }[] = [];
      for (const home of homes) {
        for (const productId of demandBasicByProduct.keys()) {
          const total = bought.get(`${home.id}\u0000${productId}`) ?? {
            quantity: 0,
            spent: 0,
          };
          consumptionEntries.push({
            buildingId: home.id,
            productId,
            quantity: total.quantity,
            desiredQuantity:
              desiredConsumptionByResidence.get(`${home.id}\u0000${productId}`) ?? 0,
            spent: total.spent,
            occupants: populationByResidence.get(home.id) ?? 0,
            consumers: home.consumers,
          });
        }
      }
      if (consumptionEntries.length > 0) {
        await client.query(
          `INSERT INTO residence_consumption
             (building_id, product_id, day, quantity, desired_quantity, spent, occupants, consumers)
           SELECT batch.building_id, batch.product_id, $1::date,
                  batch.quantity, batch.desired_quantity, batch.spent,
                  batch.occupants, batch.consumers
           FROM UNNEST(
             $2::uuid[], $3::text[], $4::double precision[],
             $5::double precision[], $6::numeric[], $7::integer[], $8::integer[]
           ) AS batch(
             building_id, product_id, quantity, desired_quantity, spent, occupants, consumers
           )
           WHERE TRUE
           ON CONFLICT (building_id, product_id, day) DO UPDATE
           SET quantity = residence_consumption.quantity + EXCLUDED.quantity,
               desired_quantity = COALESCE(residence_consumption.desired_quantity, 0)
                 + EXCLUDED.desired_quantity,
               spent = residence_consumption.spent + EXCLUDED.spent,
               occupants = EXCLUDED.occupants,
               consumers = EXCLUDED.consumers`,
          [
            state.day,
            consumptionEntries.map((entry) => entry.buildingId),
            consumptionEntries.map((entry) => entry.productId),
            consumptionEntries.map((entry) => entry.quantity),
            consumptionEntries.map((entry) => entry.desiredQuantity),
            consumptionEntries.map((entry) => entry.spent),
            consumptionEntries.map((entry) => entry.occupants),
            consumptionEntries.map((entry) => entry.consumers),
          ],
        );
      }
      const completedResidences = workplaces.filter(
        (building) =>
          building.status === 'completed' &&
          getResidenceDefinition(building.building_type)?.kind === 'residence',
      );
      if (completedResidences.length > 0) {
        const { rows: consumptionRows } = await client.query<{
          building_id: string;
          product_id: string;
          quantity: number;
          consumer_days: number;
        }>(
          `SELECT building_id, product_id,
                  COALESCE(SUM(quantity) FILTER (WHERE consumers IS NOT NULL), 0)::float8 AS quantity,
                  COALESCE(SUM(consumers), 0)::float8 AS consumer_days
           FROM residence_consumption
           WHERE building_id = ANY($2::uuid[])
             AND day >= $1::date - 29 AND day <= $1::date
           GROUP BY building_id, product_id`,
          [state.day, completedResidences.map((building) => building.id)],
        );
        const consumptionByResidence = new Map<string, ResidenceProductConsumption[]>();
        for (const row of consumptionRows) {
          const records = consumptionByResidence.get(row.building_id) ?? [];
          records.push({
            productId: row.product_id,
            quantity: row.quantity,
            consumerDays: row.consumer_days,
          });
          consumptionByResidence.set(row.building_id, records);
        }
        const wellbeingUpdates = completedResidences.map((building) => ({
          id: building.id,
          wellbeing: calculateResidenceWellbeing(
            consumptionByResidence.get(building.id) ?? [],
            demandBasicByProduct,
          ),
        }));
        const { rowCount } = await client.query(
          `UPDATE all_buildings AS building
           SET wellbeing = changes.wellbeing
           FROM UNNEST($1::uuid[], $2::double precision[])
             AS changes(id, wellbeing)
           WHERE building.id = changes.id
             AND building.wellbeing IS DISTINCT FROM changes.wellbeing`,
          [
            wellbeingUpdates.map((entry) => entry.id),
            wellbeingUpdates.map((entry) => entry.wellbeing),
          ],
        );
        if (rowCount !== null && rowCount > 0) changed = true;
      }
      const stockSales = shops
        .map((shop) => ({ id: shop.id, quantity: sold.get(shop.id) ?? 0 }))
        .filter((sale) => sale.quantity > 0);
      if (stockSales.length > 0) {
        await client.query(
          `UPDATE all_buildings building
           SET stock = building.stock - sales.quantity
           FROM UNNEST($1::uuid[], $2::integer[]) AS sales(id, quantity)
           WHERE building.id = sales.id`,
          [stockSales.map((sale) => sale.id), stockSales.map((sale) => sale.quantity)],
        );
        changed = true;
      }
      const shopRevenueByOwner = new Map<string, number>();
      const { rows: warehouseAveragePriceRows } = shops.length > 0
        ? await client.query<{
            city_id: string;
            product_id: string;
            average_unit_cost: number;
          }>(
            `SELECT seller.city_id, setting.product_id,
                    SUM(setting.price::numeric * available.quantity)
                      / NULLIF(SUM(available.quantity), 0) AS average_unit_cost
             FROM all_buildings seller
             JOIN warehouse_product_settings setting
               ON setting.building_id = seller.id
             JOIN warehouse_stock stock
               ON stock.building_id = seller.id
              AND stock.product_id = setting.product_id
             CROSS JOIN LATERAL (
               SELECT GREATEST(stock.quantity - setting.minimum_stock, 0)::numeric AS quantity
             ) available
             WHERE seller.city_id = ANY($1::uuid[])
               AND seller.building_type IN ('warehouse', 'silo')
               AND seller.status = 'completed'
               AND setting.mode = 'sell'
               AND available.quantity > 0
             GROUP BY seller.city_id, setting.product_id`,
            [[...new Set(shops.map((shop) => shop.cityId))]],
          )
        : { rows: [] };
      const warehouseAveragePrices = new Map(
        warehouseAveragePriceRows.map((row) => [
          `${row.city_id}\u0000${row.product_id}`,
          Number(row.average_unit_cost),
        ]),
      );
      const commerceHistoryEntries = shops.map((shop) => {
        const quantity = sold.get(shop.id) ?? 0;
        const productId = getResidenceDefinition(shop.type)?.stockProductId;
        if (!productId) {
          throw new Error(`O comércio ${shop.id} não tem produto de estoque configurado.`);
        }
        if (quantity > 0 && shop.ownerId) {
          const revenue = roundCurrency(quantity * shop.price);
          shopRevenueByOwner.set(
            shop.ownerId,
            roundCurrency((shopRevenueByOwner.get(shop.ownerId) ?? 0) + revenue),
          );
        }
        return {
          id: shop.id,
          averageUnitCost: warehouseAveragePrices.get(`${shop.cityId}\u0000${productId}`) ?? null,
          diagnostics: salesPlan.transactionsByShop.get(shop.id) ?? [],
          ...getShopDailyFinancials(shop.wage, shop.workers, quantity, shop.price),
        };
      });
      await applyWalletBatch(client, shopRevenueByOwner, 'credit');
      if (commerceHistoryEntries.length > 0) {
        await client.query(
          `INSERT INTO commerce_history
             (building_id, day, employee_expense, product_expense, units_sold,
              average_unit_cost, sale_price, diagnostics)
           SELECT batch.building_id, $1::date, batch.employee_expense,
                  batch.product_expense, batch.units_sold,
                  batch.average_unit_cost, batch.sale_price, batch.diagnostics
           FROM UNNEST(
             $2::uuid[], $3::numeric[], $4::numeric[],
             $5::integer[], $6::numeric[], $7::numeric[], $8::jsonb[]
           ) AS batch(
             building_id, employee_expense, product_expense, units_sold,
             average_unit_cost, sale_price, diagnostics
           )
           WHERE TRUE
           ON CONFLICT (building_id, day) DO UPDATE
           SET employee_expense = EXCLUDED.employee_expense,
               product_expense = EXCLUDED.product_expense,
               units_sold = EXCLUDED.units_sold,
               average_unit_cost = EXCLUDED.average_unit_cost,
               sale_price = EXCLUDED.sale_price,
               diagnostics = EXCLUDED.diagnostics`,
          [
            state.day,
            commerceHistoryEntries.map((entry) => entry.id),
            commerceHistoryEntries.map((entry) => entry.employeeExpense),
            commerceHistoryEntries.map((entry) => entry.productExpense),
            commerceHistoryEntries.map((entry) => entry.unitsSold),
            commerceHistoryEntries.map((entry) => entry.averageUnitCost),
            commerceHistoryEntries.map((entry) => entry.salePrice),
            commerceHistoryEntries.map((entry) => JSON.stringify(entry.diagnostics)),
          ],
        );
      }
      await client.query(
        'DELETE FROM commerce_history WHERE day < $1::date - $2::integer',
        [state.day, Math.max(LEADERBOARD_HISTORY_DAYS - 1, GAME_RULES.consumption.averagePriceWindowDays)],
      );
      });
      await runStage('produção', async () => {
      // Construções produtivas: demanda de Ferramentas, penalidade de eficiência e produção diária.
      const productiveSites = workplaces.filter((site) => {
        const definition = getResidenceDefinition(site.building_type);
        return Boolean(definition?.production && site.status === 'completed');
      });
      const { rows: productionStates } = productiveSites.length > 0
        ? await client.query<{
            id: string;
            stock: number;
          stock_levels: StockLevels;
          tool_stock: number;
            wood_stock: number;
            iron_stock: number;
            charcoal_stock: number;
            sugarcane_stock: number;
            selected_input_product_id: string | null;
            efficiency_penalty: number;
            production_progress: number;
          }>(
            `SELECT id, stock, stock_levels, tool_stock, wood_stock, iron_stock, charcoal_stock, sugarcane_stock,
                    selected_input_product_id,
                    efficiency_penalty, production_progress
             FROM all_buildings
             WHERE id = ANY($1::uuid[])`,
            [productiveSites.map((site) => site.id)],
          )
        : { rows: [] };
      const productionStateById = new Map(productionStates.map((row) => [row.id, row]));
      const { rows: productionInputStocks } = productiveSites.length > 0
        ? await client.query<{ building_id: string; product_id: string; quantity: number }>(
            `SELECT building_id, product_id, quantity
             FROM building_input_stock
             WHERE building_id = ANY($1::uuid[])`,
            [productiveSites.map((site) => site.id)],
          )
        : { rows: [] };
      const inputStocksByBuilding = new Map<string, Map<string, number>>();
      for (const stock of productionInputStocks) {
        const stocks = inputStocksByBuilding.get(stock.building_id) ?? new Map<string, number>();
        stocks.set(stock.product_id, stock.quantity);
        inputStocksByBuilding.set(stock.building_id, stocks);
      }
      const productionUpdates: {
        id: string;
        units: number;
        progress: number;
        toolDemand: number;
        woodUsed: number;
        ironUsed: number;
        charcoalUsed: number;
        sugarcaneUsed: number;
        inputStocksUsed: Record<string, number>;
        penalty: number;
      }[] = [];
      const productionHistory: ProductionHistoryEntry[] = [];
      for (const site of productiveSites) {
        const definition = getResidenceDefinition(site.building_type);
        if (!definition?.production) continue;
        const count = workers.get(site.id) ?? 0;
        const current = productionStateById.get(site.id);
        if (!current) continue;
        const usesTools =
          Boolean(definition.toolCapacity) && definition.production.batchInputs?.tools === undefined;
        const demand = usesTools ? rollToolDemand(count, Math.random, definition.toolDemandPerWorker) : 0;
        const demandMet = current.tool_stock >= demand;
        const penalty = usesTools
          ? nextEfficiencyPenalty(current.efficiency_penalty, demandMet)
          : current.efficiency_penalty;
        const generatedPoints =
          count *
          getDailyWorkPoints(
            site.work_hours_per_day,
            RESIDENCE_STATS.health,
            averageTechniques.get(site.id) ?? 10,
          );
        const month = Number(state.day.slice(5, 7));
        const seasonalEfficiency =
          site.building_type === 'farm_dairy' ? getDairyFarmEfficiency(month) : 1;
        const batchProductId = definition.selectableInputProductIds
          ? current.selected_input_product_id
          : definition.production.batchStockProductId;
        const batchStock = batchProductId === 'sugarcane'
          ? current.sugarcane_stock
          : inputStocksByBuilding.get(site.id)?.get(batchProductId ?? '') ?? 0;
        const inputStocks = Object.fromEntries(inputStocksByBuilding.get(site.id) ?? []);
        for (const productId of Object.keys(definition.inputCapacities ?? {})) {
          inputStocks[productId] ??= 0;
        }
        const result = planProduction(definition.production, {
          progress: current.production_progress,
          workPoints: generatedPoints * seasonalEfficiency,
          penalty,
          freeSpace: getStockCapacity(definition, 'stock', current.stock_levels) - current.stock,
          wood: current.wood_stock,
          iron: current.iron_stock,
          charcoal: current.charcoal_stock,
          batchStock,
          tools: current.tool_stock,
          inputStocks,
        });
        const usesGenericInput = Boolean(batchProductId && definition.inputCapacities?.[batchProductId]);
        const inputStocksUsed = { ...result.inputStocksUsed };
        if (usesGenericInput && result.batchStockUsed > 0) {
          inputStocksUsed[batchProductId!] =
            (inputStocksUsed[batchProductId!] ?? 0) + result.batchStockUsed;
        }
        const stockUsage = routeProductionStockUsage(
          definition,
          { ...result, inputStocksUsed },
        );
        productionUpdates.push({
          id: site.id,
          units: result.units,
          progress: result.progress,
          toolDemand: usesTools && demandMet ? demand + result.toolsUsed : result.toolsUsed,
          woodUsed: stockUsage.woodUsed,
          ironUsed: stockUsage.ironUsed,
          charcoalUsed: stockUsage.charcoalUsed,
          sugarcaneUsed: batchProductId === 'sugarcane' ? result.batchStockUsed : 0,
          inputStocksUsed: stockUsage.inputStocksUsed,
          penalty,
        });
        productionHistory.push({
          buildingId: site.id,
          workPoints: generatedPoints * seasonalEfficiency,
          produced: result.units,
          efficiency: (100 - penalty) * seasonalEfficiency,
        });
      }
      if (productionUpdates.length > 0) {
        await client.query(
          `UPDATE all_buildings building
           SET stock = building.stock + production.units,
               production_progress = production.progress,
               tool_stock = building.tool_stock - production.tool_demand,
               wood_stock = building.wood_stock - production.wood_used,
               iron_stock = building.iron_stock - production.iron_used,
               charcoal_stock = building.charcoal_stock - production.charcoal_used,
               sugarcane_stock = building.sugarcane_stock - production.sugarcane_used,
               efficiency_penalty = production.penalty
           FROM UNNEST(
             $1::uuid[], $2::integer[], $3::double precision[], $4::integer[],
             $5::integer[], $6::integer[], $7::integer[], $8::integer[], $9::double precision[]
           ) AS production(
             id, units, progress, tool_demand, wood_used, iron_used, charcoal_used, sugarcane_used, penalty
           )
           WHERE building.id = production.id`,
          [
            productionUpdates.map((update) => update.id),
            productionUpdates.map((update) => update.units),
            productionUpdates.map((update) => update.progress),
            productionUpdates.map((update) => update.toolDemand),
            productionUpdates.map((update) => update.woodUsed),
            productionUpdates.map((update) => update.ironUsed),
            productionUpdates.map((update) => update.charcoalUsed),
            productionUpdates.map((update) => update.sugarcaneUsed),
            productionUpdates.map((update) => update.penalty),
          ],
        );
        const inputConsumptions = productionUpdates.filter(
          (update) => Object.values(update.inputStocksUsed).some((quantity) => quantity > 0),
        ).flatMap((update) =>
          Object.entries(update.inputStocksUsed)
            .filter(([, quantity]) => quantity > 0)
            .map(([productId, quantity]) => ({ id: update.id, productId, quantity })),
        );
        const productionInputsToLog = new Map<string, number>();
        const addProductionInput = (buildingId: string, productId: string, quantity: number) => {
          if (quantity <= 0) return;
          const key = `${buildingId}\u0000${productId}`;
          productionInputsToLog.set(key, (productionInputsToLog.get(key) ?? 0) + quantity);
        };
        for (const update of productionUpdates) {
          addProductionInput(update.id, 'tools', update.toolDemand);
          addProductionInput(update.id, 'wood', update.woodUsed);
          addProductionInput(update.id, 'iron', update.ironUsed);
          addProductionInput(update.id, 'charcoal', update.charcoalUsed);
          addProductionInput(update.id, 'sugarcane', update.sugarcaneUsed);
          for (const [productId, quantity] of Object.entries(update.inputStocksUsed)) {
            addProductionInput(update.id, productId, quantity);
          }
        }
        if (productionInputsToLog.size > 0) {
          const entries = [...productionInputsToLog].map(([key, quantity]) => {
            const [buildingId, productId] = key.split('\u0000');
            return { buildingId, productId, quantity };
          });
          await client.query(
            `INSERT INTO production_input_history (building_id, product_id, day, quantity)
             SELECT batch.building_id, batch.product_id, $1::date, batch.quantity
             FROM UNNEST($2::uuid[], $3::text[], $4::double precision[])
               AS batch(building_id, product_id, quantity)
             ON CONFLICT (building_id, product_id, day) DO UPDATE
             SET quantity = production_input_history.quantity + EXCLUDED.quantity`,
            [
              state.day,
              entries.map((entry) => entry.buildingId),
              entries.map((entry) => entry.productId),
              entries.map((entry) => entry.quantity),
            ],
          );
        }
        if (inputConsumptions.length > 0) {
          const { rowCount } = await client.query(
            `UPDATE building_input_stock stock
             SET quantity = stock.quantity - consumption.quantity
             FROM UNNEST($1::uuid[], $2::text[], $3::integer[])
               AS consumption(building_id, product_id, quantity)
             WHERE stock.building_id = consumption.building_id
               AND stock.product_id = consumption.product_id
               AND stock.quantity >= consumption.quantity`,
            [
              inputConsumptions.map((update) => update.id),
              inputConsumptions.map((update) => update.productId),
              inputConsumptions.map((update) => update.quantity),
            ],
          );
          if (rowCount !== inputConsumptions.length) {
            throw new Error('O estoque de insumos mudou durante a produção diária.');
          }
        }
        changed = true;
      }
      await logProductionBatch(client, state.day, productionHistory);
      });
      await runStage('fazendas', async () => {
      // Crescimento e colheita/corte das fazendas agrícolas.
      const { rows: farmRows } = await client.query<{
        id: string;
        building_type: FarmCropType;
        work_hours_per_day: number;
        stock: number;
        stock_levels: StockLevels;
        crop_phase: Crop['phase'];
        crop_planted_day: string;
        crop_ratio_sum: number;
        crop_days: number;
        crop_yield: number;
        crop_harvested: number;
      }>(
        `SELECT id, building_type, work_hours_per_day, stock, stock_levels, crop_phase,
                to_char(crop_planted_day, 'YYYY-MM-DD') AS crop_planted_day,
                crop_ratio_sum, crop_days, crop_yield, crop_harvested
         FROM all_buildings
         WHERE building_type = ANY($1::text[]) AND status = 'completed' AND crop_phase IS NOT NULL`,
        [FARM_CROP_TYPES],
      );
      const farmUpdates: {
        id: string;
        stockDelta: number;
        phase: Crop['phase'] | null;
        plantedDay: string | null;
        ratioSum: number;
        days: number;
        yieldUnits: number;
        harvested: number;
      }[] = [];
      const farmHistory: ProductionHistoryEntry[] = [];
      for (const farm of farmRows) {
        const cropRule = RESIDENCES[farm.building_type].cropRule;
        if (!cropRule) {
          throw new Error(`A fazenda ${farm.id} não tem regras de cultivo configuradas.`);
        }
        const farmPoints =
          (workers.get(farm.id) ?? 0) *
          getDailyWorkPoints(
            farm.work_hours_per_day,
            RESIDENCE_STATS.health,
            averageTechniques.get(farm.id) ?? 10,
          );
        const crop: Crop = {
          phase: farm.crop_phase,
          plantedDay: farm.crop_planted_day,
          ratioSum: farm.crop_ratio_sum,
          days: farm.crop_days,
          yieldUnits: farm.crop_yield,
          harvested: farm.crop_harvested,
        };
        let farmProduced = 0;
        if (crop.phase === 'growing') {
          const next = advanceGrowth(crop, state.day, farmPoints, cropRule);
          farmUpdates.push({
            id: farm.id,
            stockDelta: 0,
            phase: next.phase,
            plantedDay: next.plantedDay,
            ratioSum: next.ratioSum,
            days: next.days,
            yieldUnits: next.yieldUnits,
            harvested: next.harvested,
          });
        } else {
          const capacity = getStockCapacity(
            RESIDENCES[farm.building_type],
            'stock',
            farm.stock_levels,
          );
          const { units, done } = planHarvest(
            crop,
            farmPoints,
            Math.max(0, capacity - farm.stock),
            cropRule,
          );
          farmProduced = units;
          farmUpdates.push({
            id: farm.id,
            stockDelta: units,
            phase: done ? null : crop.phase,
            plantedDay: done ? null : crop.plantedDay,
            ratioSum: done ? 0 : crop.ratioSum,
            days: done ? 0 : crop.days,
            yieldUnits: done ? 0 : crop.yieldUnits,
            harvested: done ? 0 : crop.harvested + units,
          });
        }
        farmHistory.push({
          buildingId: farm.id,
          workPoints: farmPoints,
          produced: farmProduced,
          efficiency: getDailyWorkRatio(farmPoints, cropRule.dailyWorkPoints) * 100,
        });
        changed = true;
      }
      if (farmUpdates.length > 0) {
        await client.query(
          `UPDATE all_buildings building
           SET stock = building.stock + farm.stock_delta,
               crop_phase = farm.phase,
               crop_planted_day = farm.planted_day,
               crop_ratio_sum = farm.ratio_sum,
               crop_days = farm.days,
               crop_yield = farm.yield_units,
               crop_harvested = farm.harvested
           FROM UNNEST(
             $1::uuid[], $2::integer[], $3::text[], $4::date[],
             $5::double precision[], $6::integer[], $7::integer[], $8::integer[]
           ) AS farm(
             id, stock_delta, phase, planted_day, ratio_sum, days, yield_units, harvested
           )
           WHERE building.id = farm.id`,
          [
            farmUpdates.map((update) => update.id),
            farmUpdates.map((update) => update.stockDelta),
            farmUpdates.map((update) => update.phase),
            farmUpdates.map((update) => update.plantedDay),
            farmUpdates.map((update) => update.ratioSum),
            farmUpdates.map((update) => update.days),
            farmUpdates.map((update) => update.yieldUnits),
            farmUpdates.map((update) => update.harvested),
          ],
        );
      }
      await logProductionBatch(client, state.day, farmHistory);
      });
      await runStage('transporte', async () => {
      // Transporte entre armazéns e construções ligadas; consome Work Points do armazém.
      const { rows: warehouseRows } = await client.query<{
        id: string;
        tile_x: number;
        tile_y: number;
        building_type: ResidenceType;
      }>(
        `SELECT id, tile_x, tile_y, building_type FROM all_buildings
         WHERE building_type IN ('warehouse', 'silo') AND status = 'completed'
         ORDER BY tile_x, tile_y, id`,
      );
      const workplaceById = new Map(workplaces.map((workplace) => [workplace.id, workplace]));
      type LinkedBuildingRow = {
        id: string;
        warehouse_id: string;
        building_type: ResidenceType;
        stock: number;
        stock_levels: StockLevels;
        tool_stock: number;
        wood_stock: number;
        iron_stock: number;
        charcoal_stock: number;
        sugarcane_stock: number;
        selected_input_product_id: string | null;
        input_stocks: Record<string, number>;
      };
      type WarehouseInventoryRow = {
        warehouse_id: string;
        product_id: string;
        quantity: number;
        minimum_stock: number;
        maximum_stock: number | null;
        has_stock_row: boolean;
      };
      const warehouseIds = warehouseRows.map((warehouse) => warehouse.id);
      const { rows: linked } = warehouseIds.length > 0
        ? await client.query<LinkedBuildingRow>(
            `SELECT building.id, link.warehouse_id, building.building_type, building.stock,
                    building.stock_levels,
                    building.tool_stock, building.wood_stock, building.iron_stock,
                    building.charcoal_stock, building.sugarcane_stock,
                    building.selected_input_product_id
             FROM all_buildings building
             JOIN building_warehouse_links link ON link.building_id = building.id
             WHERE link.warehouse_id = ANY($1::uuid[]) AND building.status = 'completed'
             ORDER BY link.warehouse_id, building.id`,
            [warehouseIds],
          )
        : { rows: [] as LinkedBuildingRow[] };
      const linkedIds = linked.map((building) => building.id);
      const { rows: linkedInputStocks } = linkedIds.length > 0
        ? await client.query<{ building_id: string; product_id: string; quantity: number }>(
            `SELECT building_id, product_id, quantity
             FROM building_input_stock
             WHERE building_id = ANY($1::uuid[])`,
            [linkedIds],
          )
        : { rows: [] as { building_id: string; product_id: string; quantity: number }[] };
      const { rows: inventoryRows } = warehouseIds.length > 0
        ? await client.query<WarehouseInventoryRow>(
            `SELECT COALESCE(stock.building_id, settings.building_id) AS warehouse_id,
                    COALESCE(stock.product_id, settings.product_id) AS product_id,
                    COALESCE(stock.quantity, 0) AS quantity,
                    COALESCE(settings.minimum_stock, 0) AS minimum_stock,
                    settings.maximum_stock,
                    stock.building_id IS NOT NULL AS has_stock_row
             FROM warehouse_stock stock
             FULL OUTER JOIN warehouse_product_settings settings
               ON settings.building_id = stock.building_id
              AND settings.product_id = stock.product_id
             WHERE COALESCE(stock.building_id, settings.building_id) = ANY($1::uuid[])`,
            [warehouseIds],
          )
        : { rows: [] as WarehouseInventoryRow[] };

      const linkedByWarehouse = new Map<string, LinkedBuildingRow[]>();
      const linkedById = new Map(linked.map((building) => [building.id, building]));
      type LinkedBuildingState = LinkedBuildingRow & {
        buildingId: string;
        type: ResidenceType;
        toolStock: number;
        woodStock: number;
        ironStock: number;
        charcoalStock: number;
        sugarcaneStock: number;
        inputStocks: Record<string, number>;
        selectedInputProductId: string | null;
        stockLevels: StockLevels;
      };
      const linkedStateById = new Map<string, LinkedBuildingState>();
      for (const building of linked) {
        if (!linkedStateById.has(building.id)) {
          linkedStateById.set(building.id, {
            ...building,
            buildingId: building.id,
            type: building.building_type,
            toolStock: building.tool_stock,
            woodStock: building.wood_stock,
            ironStock: building.iron_stock,
            charcoalStock: building.charcoal_stock,
            sugarcaneStock: building.sugarcane_stock,
            inputStocks: {},
            selectedInputProductId: building.selected_input_product_id,
            stockLevels: building.stock_levels,
            input_stocks: {},
          });
        }
      }
      for (const building of linked) {
        const buildings = linkedByWarehouse.get(building.warehouse_id) ?? [];
        buildings.push(building);
        linkedByWarehouse.set(building.warehouse_id, buildings);
      }
      const inputStocksByBuilding = new Map<string, Record<string, number>>();
      for (const stock of linkedInputStocks) {
        const buildingStocks = inputStocksByBuilding.get(stock.building_id) ?? {};
        buildingStocks[stock.product_id] = stock.quantity;
        inputStocksByBuilding.set(stock.building_id, buildingStocks);
      }
      for (const [buildingId, stocks] of inputStocksByBuilding) {
        const linkedState = linkedStateById.get(buildingId);
        if (linkedState) {
          linkedState.input_stocks = stocks;
          linkedState.inputStocks = stocks;
        }
      }
      const inventoryByWarehouse = new Map<string, {
        stock: Map<string, number>;
        minimumStock: Map<string, number>;
        maximumStock: Map<string, number | null>;
        existingStockProducts: Set<string>;
      }>();
      for (const warehouse of warehouseRows) {
        inventoryByWarehouse.set(warehouse.id, {
          stock: new Map(),
          minimumStock: new Map(),
          maximumStock: new Map(),
          existingStockProducts: new Set(),
        });
      }
      for (const row of inventoryRows) {
        const inventory = inventoryByWarehouse.get(row.warehouse_id);
        if (!inventory) continue;
        inventory.stock.set(row.product_id, row.quantity);
        inventory.minimumStock.set(row.product_id, row.minimum_stock);
        inventory.maximumStock.set(row.product_id, row.maximum_stock);
        if (row.has_stock_row) inventory.existingStockProducts.add(row.product_id);
      }

      const transportLogRows: {
        warehouseId: string;
        buildingId: string;
        buildingType: string;
        productId: string;
        direction: 'in' | 'out';
        wanted: number;
        moved: number;
        reason: string | null;
        errorDetail: string | null;
      }[] = [];
      const transportDemandByWarehouse = new Map<string, number>();
      const warehouseStockDeltas = new Map<string, Map<string, number>>();
      const buildingChanges = new Map<string, {
        stock: number;
        tools: number;
        wood: number;
        iron: number;
        charcoal: number;
        sugarcane: number;
        inputStocks: Map<string, number>;
      }>();
      const transportedByBuilding = new Map<string, number>();
      const productionByBuilding = new Map<string, ProductionHistoryEntry>();
      for (const warehouse of warehouseRows) {
        const warehouseSite = workplaceById.get(warehouse.id);
        productionByBuilding.set(warehouse.id, {
          buildingId: warehouse.id,
          workPoints:
            (workers.get(warehouse.id) ?? 0) *
            getDailyWorkPoints(
              warehouseSite?.work_hours_per_day ?? 8,
              RESIDENCE_STATS.health,
              averageTechniques.get(warehouse.id) ?? 10,
            ),
        });
      }

      for (const warehouse of warehouseRows) {
        const linkedBuildings = (linkedByWarehouse.get(warehouse.id) ?? [])
          .map((building) => linkedStateById.get(building.id))
          .filter((building): building is LinkedBuildingState => building !== undefined);
        if (linkedBuildings.length === 0) continue;
        const warehouseSite = workplaceById.get(warehouse.id);
        const workPoints =
          (workers.get(warehouse.id) ?? 0) *
          getDailyWorkPoints(
            warehouseSite?.work_hours_per_day ?? 8,
            RESIDENCE_STATS.health,
            averageTechniques.get(warehouse.id) ?? 10,
          );
        const inventory = inventoryByWarehouse.get(warehouse.id);
        if (!inventory) {
          throw new Error(`Não foi possível carregar o estoque do armazém ${warehouse.id}.`);
        }
        try {
          const { transfers, attempts } = planTransfersDetailed(
            {
              stock: inventory.stock,
              minimumStock: inventory.minimumStock,
              maximumStock: inventory.maximumStock,
              capacityM3: RESIDENCES[warehouse.building_type].storageCapacityM3 ?? 0,
              workPoints,
              allowedProductIds: RESIDENCES[warehouse.building_type].allowedStorageProductIds,
            },
            linkedBuildings.map((building) => ({
              buildingId: building.id,
              type: building.building_type,
              stock: building.stock,
              toolStock: linkedStateById.get(building.id)?.toolStock ?? building.tool_stock,
              woodStock: linkedStateById.get(building.id)?.woodStock ?? building.wood_stock,
              ironStock: linkedStateById.get(building.id)?.ironStock ?? building.iron_stock,
              charcoalStock:
                linkedStateById.get(building.id)?.charcoalStock ?? building.charcoal_stock,
              sugarcaneStock:
                linkedStateById.get(building.id)?.sugarcaneStock ?? building.sugarcane_stock,
              inputStocks: linkedStateById.get(building.id)?.inputStocks ?? {},
              selectedInputProductId:
                linkedStateById.get(building.id)?.selectedInputProductId ??
                building.selected_input_product_id,
              stockLevels: linkedStateById.get(building.id)?.stockLevels ?? building.stock_levels,
            })),
          );
          const types = new Map(
            linkedBuildings.map((building) => [building.id, building.building_type]),
          );
          for (const attempt of attempts) {
            transportLogRows.push({
              warehouseId: warehouse.id,
              buildingId: attempt.buildingId,
              buildingType: types.get(attempt.buildingId) ?? '',
              productId: attempt.productId,
              direction: attempt.direction,
              wanted: attempt.wanted,
              moved: attempt.moved,
              reason: attempt.reason,
              errorDetail: null,
            });
          }
          const stockDeltas = warehouseStockDeltas.get(warehouse.id) ?? new Map<string, number>();
          for (const transfer of transfers) {
            const warehouseDelta =
              transfer.direction === 'out' ? transfer.quantity : -transfer.quantity;
            stockDeltas.set(
              transfer.productId,
              (stockDeltas.get(transfer.productId) ?? 0) + warehouseDelta,
            );
            transportDemandByWarehouse.set(
              warehouse.id,
              (transportDemandByWarehouse.get(warehouse.id) ?? 0) +
                getTransportDemand(transfer.productId, transfer.quantity),
            );
            if (transfer.direction === 'out') {
              transportedByBuilding.set(
                transfer.buildingId,
                (transportedByBuilding.get(transfer.buildingId) ?? 0) + transfer.quantity,
              );
            }

            const definition = getResidenceDefinition(
              linkedById.get(transfer.buildingId)?.building_type ?? '',
            );
            const genericInput =
              transfer.direction === 'in' &&
              definition?.inputCapacities?.[transfer.productId] !== undefined &&
              (!definition.selectableInputProductIds ||
                linkedById.get(transfer.buildingId)?.selected_input_product_id ===
                  transfer.productId);
            const kind = definition?.kind;
            const column = genericInput
              ? 'input_stock'
              : transfer.direction === 'out' || kind === 'shop'
                ? 'stock'
                : ({
                    tools: 'tool_stock',
                    wood: 'wood_stock',
                    iron: 'iron_stock',
                    charcoal: 'charcoal_stock',
                    sugarcane: 'sugarcane_stock',
                  } as Record<string, string>)[transfer.productId];
            if (!column) continue;
            const changes = buildingChanges.get(transfer.buildingId) ?? {
              stock: 0,
              tools: 0,
              wood: 0,
              iron: 0,
              charcoal: 0,
              sugarcane: 0,
              inputStocks: new Map<string, number>(),
            };
            const buildingDelta =
              transfer.direction === 'out' ? -transfer.quantity : transfer.quantity;
            if (column === 'stock') changes.stock += buildingDelta;
            else if (column === 'tool_stock') changes.tools += buildingDelta;
            else if (column === 'wood_stock') changes.wood += buildingDelta;
            else if (column === 'iron_stock') changes.iron += buildingDelta;
            else if (column === 'charcoal_stock') changes.charcoal += buildingDelta;
            else if (column === 'sugarcane_stock') changes.sugarcane += buildingDelta;
            else if (column === 'input_stock') {
              changes.inputStocks.set(
                transfer.productId,
                (changes.inputStocks.get(transfer.productId) ?? 0) + buildingDelta,
              );
            }
            buildingChanges.set(transfer.buildingId, changes);
            const linkedState = linkedStateById.get(transfer.buildingId);
            if (linkedState) applyTransferToLinkedBuilding(linkedState, transfer);
          }
          warehouseStockDeltas.set(warehouse.id, stockDeltas);
        } catch (transportError) {
          const errorInfo =
            transportError && typeof transportError === 'object'
              ? (transportError as Record<string, unknown>)
              : {};
          const errorMessage =
            typeof errorInfo.message === 'string' ? errorInfo.message : String(transportError);
          const errorMetadata = [
            typeof errorInfo.code === 'string' ? `SQLSTATE ${errorInfo.code}` : null,
            typeof errorInfo.constraint === 'string' ? `constraint=${errorInfo.constraint}` : null,
            typeof errorInfo.column === 'string' ? `column=${errorInfo.column}` : null,
            typeof errorInfo.detail === 'string' ? errorInfo.detail : null,
          ].filter((value): value is string => value !== null);
          const errorDetail =
            `planning_transfers: ${errorMessage}${errorMetadata.length ? ` (${errorMetadata.join('; ')})` : ''}`.slice(
              0,
              1000,
            );
          console.error(`Falha no transporte do armazém ${warehouse.id} (planning_transfers):`, transportError);
          transportLogRows.push({
            warehouseId: warehouse.id,
            buildingId: warehouse.id,
            buildingType: 'system',
            productId: '',
            direction: 'out',
            wanted: 0,
            moved: 0,
            reason: 'error',
            errorDetail,
          });
        }
      }

      const stockDeltaRows = [...warehouseStockDeltas].flatMap(([warehouseId, deltas]) =>
        [...deltas]
          .filter(([, quantity]) => quantity !== 0)
          .map(([productId, quantity]) => ({ warehouseId, productId, quantity })),
      );
      for (const change of stockDeltaRows) {
        const currentStock =
          inventoryByWarehouse.get(change.warehouseId)?.stock.get(change.productId) ?? 0;
        if (currentStock + change.quantity < 0) {
          throw new Error(
            `Estoque insuficiente no armazém ${change.warehouseId} para ${change.productId}.`,
          );
        }
      }
      const stockWrites = planWarehouseStockWrites(
        stockDeltaRows,
        new Map(
          [...inventoryByWarehouse].map(([warehouseId, inventory]) => [
            warehouseId,
            inventory.existingStockProducts,
          ]),
        ),
      );

      if (warehouseIds.length > 0) {
        await client.query(
          `DELETE FROM warehouse_transport_log
           WHERE warehouse_id = ANY($1::uuid[]) AND day < $2::date - 30`,
          [warehouseIds, state.day],
        );
      }
      if (transportLogRows.length > 0) {
        await client.query(
          `INSERT INTO warehouse_transport_log
             (warehouse_id, day, linked_id, linked_type, product_id, direction, wanted, moved, reason, error_detail)
           SELECT batch.warehouse_id, $1::date, batch.building_id, batch.building_type,
                  batch.product_id, batch.direction, batch.wanted, batch.moved,
                  batch.reason, batch.error_detail
           FROM UNNEST(
             $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[],
             $7::integer[], $8::integer[], $9::text[], $10::text[]
           ) AS batch(
             warehouse_id, building_id, building_type, product_id, direction,
             wanted, moved, reason, error_detail
           )`,
          [
            state.day,
            transportLogRows.map((row) => row.warehouseId),
            transportLogRows.map((row) => row.buildingId),
            transportLogRows.map((row) => row.buildingType),
            transportLogRows.map((row) => row.productId),
            transportLogRows.map((row) => row.direction),
            transportLogRows.map((row) => row.wanted),
            transportLogRows.map((row) => row.moved),
            transportLogRows.map((row) => row.reason),
            transportLogRows.map((row) => row.errorDetail),
          ],
        );
      }
      if (stockWrites.updates.length > 0) {
        const { rowCount } = await client.query(
          `UPDATE warehouse_stock AS current
           SET quantity = current.quantity + changes.quantity
           FROM UNNEST($1::uuid[], $2::text[], $3::integer[])
             AS changes(warehouse_id, product_id, quantity)
           WHERE current.building_id = changes.warehouse_id
             AND current.product_id = changes.product_id
             AND current.quantity + changes.quantity >= 0`,
          [
            stockWrites.updates.map((row) => row.warehouseId),
            stockWrites.updates.map((row) => row.productId),
            stockWrites.updates.map((row) => row.quantity),
          ],
        );
        if (rowCount !== stockWrites.updates.length) {
          throw new Error('O estoque de um armazém mudou durante o transporte diário.');
        }
      }
      if (stockWrites.inserts.length > 0) {
        const { rowCount } = await client.query(
          `INSERT INTO warehouse_stock (building_id, product_id, quantity)
           SELECT changes.warehouse_id, changes.product_id, changes.quantity
           FROM UNNEST($1::uuid[], $2::text[], $3::integer[])
             AS changes(warehouse_id, product_id, quantity)
           ON CONFLICT (building_id, product_id) DO UPDATE
           SET quantity = warehouse_stock.quantity + EXCLUDED.quantity`,
          [
            stockWrites.inserts.map((row) => row.warehouseId),
            stockWrites.inserts.map((row) => row.productId),
            stockWrites.inserts.map((row) => row.quantity),
          ],
        );
        if (rowCount !== stockWrites.inserts.length) {
          throw new Error('Não foi possível gravar o estoque recebido pelos armazéns.');
        }
      }

      if (buildingChanges.size > 0) {
        const buildingIds = [...buildingChanges.keys()];
        const { rowCount } = await client.query(
          `UPDATE all_buildings building
           SET stock = building.stock + changes.stock,
               tool_stock = building.tool_stock + changes.tools,
               wood_stock = building.wood_stock + changes.wood,
               iron_stock = building.iron_stock + changes.iron,
               charcoal_stock = building.charcoal_stock + changes.charcoal,
               sugarcane_stock = building.sugarcane_stock + changes.sugarcane
           FROM UNNEST(
             $1::uuid[], $2::integer[], $3::integer[],
             $4::integer[], $5::integer[], $6::integer[], $7::integer[]
           ) AS changes(id, stock, tools, wood, iron, charcoal, sugarcane)
           WHERE building.id = changes.id`,
          [
            buildingIds,
            buildingIds.map((id) => buildingChanges.get(id)?.stock ?? 0),
            buildingIds.map((id) => buildingChanges.get(id)?.tools ?? 0),
            buildingIds.map((id) => buildingChanges.get(id)?.wood ?? 0),
            buildingIds.map((id) => buildingChanges.get(id)?.iron ?? 0),
            buildingIds.map((id) => buildingChanges.get(id)?.charcoal ?? 0),
            buildingIds.map((id) => buildingChanges.get(id)?.sugarcane ?? 0),
          ],
        );
        if (rowCount !== buildingIds.length) {
          throw new Error('Uma construção ligada mudou durante o transporte diário.');
        }
        const inputChanges = [...buildingChanges].flatMap(([buildingId, changes]) =>
          [...changes.inputStocks]
            .filter(([, quantity]) => quantity > 0)
            .map(([productId, quantity]) => ({ buildingId, productId, quantity })),
        );
        if (inputChanges.length > 0) {
          await client.query(
            `INSERT INTO building_input_stock (building_id, product_id, quantity)
             SELECT batch.building_id, batch.product_id, batch.quantity
             FROM UNNEST($1::uuid[], $2::text[], $3::integer[])
               AS batch(building_id, product_id, quantity)
             ON CONFLICT (building_id, product_id) DO UPDATE
             SET quantity = building_input_stock.quantity + EXCLUDED.quantity`,
            [
              inputChanges.map((change) => change.buildingId),
              inputChanges.map((change) => change.productId),
              inputChanges.map((change) => change.quantity),
            ],
          );
        }
        changed = true;
      }

      for (const [buildingId, transported] of transportedByBuilding) {
        const entry = productionByBuilding.get(buildingId) ?? { buildingId };
        entry.transported = transported;
        productionByBuilding.set(buildingId, entry);
      }
      await logProductionBatch(client, state.day, [...productionByBuilding.values()]);
      await logWarehouseDemandBatch(
        client,
        [...transportDemandByWarehouse].map(([warehouseId, demand]) => ({
          warehouseId,
          day: state.day,
          demand,
        })),
      );
      });
      } catch (economyError) {
        await client.query('ROLLBACK TO SAVEPOINT daily_economy');
        console.error('Falha na economia diária (folha e obras foram preservadas):', economyError);
      }
      await client.query('UPDATE world_state SET last_payroll_day = $1 WHERE id = 1', [state.day]);
      await client.query(
        `DELETE FROM warehouse_payroll_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM building_payroll_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM residence_rent_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM warehouse_trade_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM production_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM player_investment_history
         WHERE day < $1::date - $2::integer`,
        [state.day, LEADERBOARD_HISTORY_DAYS - 1],
      );
      await client.query(
        `DELETE FROM production_input_history
         WHERE day < $1::date - 34`,
        [state.day],
      );
      await client.query(
        `DELETE FROM product_cost_history
         WHERE day < $1::date - 34`,
        [state.day],
      );
    }

    if (state.hour >= 18 && (state.last_spoilage === null || state.last_spoilage < state.day)) {
      await client.query('SAVEPOINT inventory_spoilage');
      try {
        const spoiled = await applyDailySpoilage(client, state.day);
        await client.query('UPDATE world_state SET last_spoilage_day = $1::date WHERE id = 1', [state.day]);
        await client.query('RELEASE SAVEPOINT inventory_spoilage');
        if (spoiled) changed = true;
      } catch (spoilageError) {
        await client.query('ROLLBACK TO SAVEPOINT inventory_spoilage');
        console.error(`Falha na deterioração diária do estoque (${state.day}):`, spoilageError);
      }
    }

    if (state.hour >= 12 && (state.last_alloc === null || state.last_alloc < state.day)) {
      const allocationCounts = emptyPerformanceCounts();
      await measurePerformanceStage(
        'alocação de empregos',
        '12:00',
        state.day,
        performanceCycleId,
        allocationCounts,
        async () => {
      const currentMonth = Number(state.day.slice(5, 7));
      const { rows: automationCandidates } = await client.query<{
        id: string;
        phase: Crop['phase'] | null;
        enabled: boolean;
        months: number[];
        plantingWorkers: number;
        harvestWorkers: number;
      }>(
        `SELECT id, crop_phase AS phase,
                farm_auto_planting_enabled AS enabled,
                farm_auto_planting_months AS months,
                farm_planting_workers AS "plantingWorkers",
                farm_harvest_workers AS "harvestWorkers"
         FROM all_buildings
         WHERE building_type = ANY($1::text[]) AND status = 'completed' AND crop_phase IS NULL
           AND farm_auto_planting_enabled = true`,
        [AUTOMATABLE_FARM_TYPES],
      );
      const farmsToPlant = automationCandidates
        .filter((farm) =>
          shouldStartAutomatedCrop(
            {
              enabled: farm.enabled,
              plantingMonths: farm.months,
              plantingWorkers: farm.plantingWorkers,
              harvestWorkers: farm.harvestWorkers,
            },
            farm.phase,
            currentMonth,
          ),
        )
        .map((farm) => farm.id);
      if (farmsToPlant.length > 0) {
        await client.query(
          `UPDATE all_buildings
           SET crop_phase = 'growing', crop_planted_day = $2::date,
               crop_ratio_sum = 0, crop_days = 0, crop_yield = 0, crop_harvested = 0
           WHERE id = ANY($1::uuid[]) AND crop_phase IS NULL`,
          [farmsToPlant, state.day],
        );
        changed = true;
      }
      const { rows } = await client.query<ResidentialBuildingRow>(
        `SELECT ${ALL_BUILDING_COLUMNS} FROM all_buildings`,
      );
      Object.assign(allocationCounts, getPerformanceEntityCounts(rows));
      const buildings = rows.map(mapResidentialBuilding);
      const completedResidences = buildings.filter(
        (building) =>
          building.status === 'completed' &&
          getResidenceDefinition(building.type)?.kind === 'residence',
      );
      const employmentOffers: ResidenceEmploymentOffer[] = buildings.flatMap((building) => {
        if (
          getResidenceDefinition(building.type)?.kind === 'residence' &&
          building.status !== 'under_construction'
        ) {
          return [];
        }
        const desiredWorkers = Math.min(
          building.desiredWorkers,
          getMaxDesiredWorkers(building.type, building.status),
        );
        const vacancies = Math.max(0, desiredWorkers - building.employed);
        return vacancies > 0
          ? [{
              cityId: building.cityId,
              type: building.type,
              x: building.x,
              y: building.y,
              wage: building.wage,
              vacancies,
            }]
          : [];
      });
      const residenceAppeals = calculateResidenceAppealsFromIncome(
        completedResidences.map((building) => {
          const definition = RESIDENCES[building.type];
          return {
            id: building.id,
            cityId: building.cityId,
            type: building.type,
            x: building.x + definition.width / 2,
            y: building.y + definition.height / 2,
            salaryAverage: building.averageIncome,
            employed: building.employed,
            occupants: building.occupants,
            capacity: definition.capacity,
            constructionAppeal: definition.localAppeal,
          };
        }),
        employmentOffers,
      );
      const residences = completedResidences
        .filter((building) => building.occupants > 0)
        .map((building) => {
          const appeal = residenceAppeals.get(building.id);
          if (!appeal) {
            throw new Error(`Não foi possível calcular o apreço interno da residência ${building.id}.`);
          }
          return {
            id: building.id,
            cityId: building.cityId,
            type: building.type,
            x: building.x,
            y: building.y,
            occupants: building.occupants,
            internalAppeal: appeal.internalAppeal,
            technique: getWorkerTechnique(building.wellbeing),
          };
        });
      const workplaces = buildings.filter(
        (building) =>
          building.desiredWorkers > 0 &&
          (getResidenceDefinition(building.type)?.kind !== 'residence' ||
            building.status === 'under_construction'),
      );
      const assignments: JobAssignment[] = allocateWorkers(residences, workplaces);
      await client.query('DELETE FROM job_assignments');
      if (assignments.length > 0) {
        await client.query(
          `INSERT INTO job_assignments (workplace_id, residence_id, count)
           SELECT batch.workplace_id, batch.residence_id, batch.count
           FROM UNNEST($1::uuid[], $2::uuid[], $3::integer[])
             AS batch(workplace_id, residence_id, count)`,
          [
            assignments.map((assignment) => assignment.workplaceId),
            assignments.map((assignment) => assignment.residenceId),
            assignments.map((assignment) => assignment.count),
          ],
        );
      }
      await client.query('UPDATE world_state SET last_job_allocation_day = $1 WHERE id = 1', [state.day]);
      changed = true;
        },
        lockWaitMs,
        false,
        3,
      );
    }

    // Às 03:00 e 15:00 os armazéns compram de armazéns de outros donos em até 60 tiles.
    const tradeSlot = state.hour >= 15 ? `${state.day}T15` : state.hour >= 3 ? `${state.day}T03` : null;
    if (tradeSlot && (state.last_trade === null || state.last_trade < tradeSlot)) {
      const { rows: warehouseRows } = await client.query<WarehouseTradeBuildingRow>(
        `SELECT b.id, b.created_by, b.building_type, b.tile_x, b.tile_y, b.work_hours_per_day,
                COALESCE((SELECT SUM(count) FROM job_assignments j WHERE j.workplace_id = b.id), 0)::int AS workers
         FROM all_buildings b
         WHERE b.building_type IN ('warehouse', 'silo') AND b.status = 'completed'`,
      );
      const averageTechniques = await loadAverageWorkerTechniques(
        client,
        warehouseRows.map((row) => row.id),
      );
      const { rows: stockRows } = await client.query<WarehouseTradeStockRow>(
        'SELECT building_id, product_id, quantity FROM warehouse_stock',
      );
      const { rows: settingRows } = await client.query<WarehouseTradeSettingRow>(
        'SELECT building_id, product_id, minimum_stock, maximum_stock, price, mode FROM warehouse_product_settings',
      );
      const tradeWarehouses = mapWarehouseTradeWarehouses(
        warehouseRows,
        stockRows,
        settingRows,
        averageTechniques,
      );
      const ownerOf = new Map(warehouseRows.map((row) => [row.id, row.created_by]));
      const trades = planWarehouseTrades(tradeWarehouses);
      await applyWarehouseTrades(client, trades, ownerOf, state.day);
      if (trades.length > 0) changed = true;
      await client.query('UPDATE world_state SET last_warehouse_trade_slot = $1 WHERE id = 1', [tradeSlot]);
      productCostUpdateDue = true;
    }

    if (productCostUpdateDue) {
      await client.query('SAVEPOINT product_cost_estimates');
      try {
        await recordProductCostEstimates(client, state.day);
        await client.query('RELEASE SAVEPOINT product_cost_estimates');
      } catch (costError) {
        await client.query('ROLLBACK TO SAVEPOINT product_cost_estimates');
        await client.query('RELEASE SAVEPOINT product_cost_estimates');
        console.error(`Falha ao atualizar custos estimados dos produtos (${state.day}):`, costError);
      }
    }

    await client.query('COMMIT');
    return changed;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter o emprego diário:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function advanceClock() {
  const { rows: clockRows } = await pool.query<{ day: string; hour: number }>(
    `UPDATE world_state
     SET world_time = world_time
           + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - last_real_at)))
             * time_scale * INTERVAL '1 second',
         last_real_at = clock_timestamp()
     WHERE id = 1
     RETURNING to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour`,
  );
  const clock = clockRows[0];
  if (!clock) throw new Error('O relógio global ainda não foi inicializado.');
  const employmentChanged = await runDailyEmployment();
  const immigrationChanged = await runDailyImmigration();
  const residenceRelocationChanged = await runMonthlyResidenceRelocation();
  const populationChanged = await runMonthlyPopulationChange();
  if (immigrationChanged || employmentChanged || residenceRelocationChanged || populationChanged) {
    const publicationCounts = emptyPerformanceCounts();
    await measurePerformanceStage(
      'publicação de cidades e snapshot',
      clock.hour >= 12 ? '12:00' : '00:00',
      clock.day,
      randomUUID(),
      publicationCounts,
      async () => {
        let succeeded = true;
        const counts = await publishCities().catch((error: unknown) => {
          console.error('A atualização diária foi aplicada, mas a atualização do mundo falhou:', error);
          succeeded = false;
          return null;
        });
        if (counts) Object.assign(publicationCounts, counts);
        await publishDailyFullWorldStateIfDue().catch((error: unknown) => {
          console.error('Não foi possível forçar a sincronização diária do mundo:', error);
          succeeded = false;
        });
        await publishSnapshot();
        return succeeded;
      },
      0,
      true,
    );
  } else {
    await publishDailyFullWorldStateIfDue().catch((error: unknown) => {
      console.error('Não foi possível forçar a sincronização diária do mundo:', error);
    });
    await publishSnapshot();
  }
}

function getAuthConfig(): AuthConfig {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!baseUrl || !jwksUrl) {
    throw new Error('NEON_AUTH_BASE_URL e NEON_AUTH_JWKS_URL são obrigatórias.');
  }

  return {
    jwks: createRemoteJWKSet(new URL(jwksUrl)),
    issuer: new URL(baseUrl).origin,
  };
}

async function verifyAccessToken(token: string, auth: AuthConfig): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, auth.jwks, { issuer: auth.issuer });
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch (error) {
    if (
      error instanceof joseErrors.JWTClaimValidationFailed ||
      error instanceof joseErrors.JWTExpired ||
      error instanceof joseErrors.JWTInvalid ||
      error instanceof joseErrors.JWSInvalid ||
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWKSNoMatchingKey ||
      error instanceof joseErrors.JOSEAlgNotAllowed
    ) {
      return null;
    }
    throw error;
  }
}

function requireAuthentication(auth: AuthConfig): RequestHandler {
  return (request, response, next) => {
    const token = request.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void verifyAccessToken(token, auth)
      .then((userId) => {
        if (!userId) {
          response.status(401).json({ error: 'unauthorized' });
          return;
        }
        authenticatedUserIds.set(request, userId);
        next();
      })
      .catch((error: unknown) => {
        console.error('Não foi possível validar a sessão Neon Auth:', error);
        response.status(503).json({ error: 'auth_unavailable' });
      });
  };
}

async function isMasterUser(userId: string): Promise<boolean> {
  const masterEmail = process.env.MASTER_EMAIL?.trim().toLowerCase();
  if (!masterEmail) throw new Error('MASTER_EMAIL não foi configurada.');

  const { rows } = await pool.query<{ is_master: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM neon_auth."user"
       WHERE id = $1 AND lower(email) = $2
     ) AS is_master`,
    [userId, masterEmail],
  );
  return rows[0]?.is_master === true;
}

function requireMaster(): RequestHandler {
  return (request, response, next) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void isMasterUser(userId)
      .then((isMaster) => {
        if (!isMaster) {
          response.status(403).json({ error: 'master_required' });
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        console.error('Não foi possível verificar a conta master:', error);
        response.status(503).json({ error: 'authorization_unavailable' });
      });
  };
}

function parseCityInput(body: unknown): { name: string; centerX: number; centerY: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const centerX = record.centerX;
  const centerY = record.centerY;
  if (
    name.length === 0 ||
    name.length > 80 ||
    typeof centerX !== 'number' ||
    !Number.isInteger(centerX) ||
    typeof centerY !== 'number' ||
    !Number.isInteger(centerY) ||
    centerX < 0 ||
    centerY < 0 ||
    centerX >= MAP.width ||
    centerY >= MAP.height
  ) {
    return null;
  }
  return { name, centerX, centerY };
}

function parseCityZones(body: unknown): CityZoneInput[] | null {
  if (typeof body !== 'object' || body === null || !('zones' in body) || !Array.isArray(body.zones)) {
    return null;
  }
  if (body.zones.length > MAX_CITY_ZONES) return null;

  const zones: CityZoneInput[] = [];
  for (const value of body.zones) {
    if (typeof value !== 'object' || value === null) return null;
    const zone = value as Record<string, unknown>;
    if (
      (zone.type !== 'urban' && zone.type !== 'rural') ||
      typeof zone.minX !== 'number' ||
      typeof zone.minY !== 'number' ||
      typeof zone.maxX !== 'number' ||
      typeof zone.maxY !== 'number' ||
      !Number.isInteger(zone.minX) ||
      !Number.isInteger(zone.minY) ||
      !Number.isInteger(zone.maxX) ||
      !Number.isInteger(zone.maxY)
    ) {
      return null;
    }
    zones.push({
      type: zone.type,
      minX: zone.minX,
      minY: zone.minY,
      maxX: zone.maxX,
      maxY: zone.maxY,
    });
  }
  return zones;
}

function parseRoadPath(
  body: unknown,
):
  | { path: RoadPosition[]; error: null }
  | { path: null; error: 'invalid_road' | 'path_too_long' } {
  if (typeof body !== 'object' || body === null || !('path' in body) || !Array.isArray(body.path)) {
    return { path: null, error: 'invalid_road' };
  }
  if (body.path.length === 0) return { path: null, error: 'invalid_road' };
  if (body.path.length > MAX_ROAD_PATH_TILES) {
    return { path: null, error: 'path_too_long' };
  }

  const path: RoadPosition[] = [];
  for (const point of body.path) {
    if (
      typeof point !== 'object' ||
      point === null ||
      !('x' in point) ||
      !('y' in point) ||
      typeof point.x !== 'number' ||
      !Number.isInteger(point.x) ||
      typeof point.y !== 'number' ||
      !Number.isInteger(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= MAP.width ||
      point.y >= MAP.height
    ) {
      return { path: null, error: 'invalid_road' };
    }

    const previous = path[path.length - 1];
    if (
      previous &&
      Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) !== 1
    ) {
      return { path: null, error: 'invalid_road' };
    }
    path.push({ x: point.x, y: point.y });
  }

  return { path, error: null };
}

async function createRoadPath(
  path: RoadPosition[],
  userId: string,
): Promise<{ roads: RoadTile[] | null; error: RoadPlacementError | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const { rows: cityRows } = await client.query<{
      id: string;
      center_x: number;
      center_y: number;
    }>(`SELECT id, center_x, center_y FROM city_assemblies`);
    const cities = cityRows.map((city) => ({
      id: city.id,
      centerX: city.center_x,
      centerY: city.center_y,
    }));
    const { rows: residentialRows } = await client.query<ResidentialBuildingRow>(
      `SELECT ${ALL_BUILDING_COLUMNS}
       FROM all_buildings`,
    );
    const residentialBuildings = residentialRows.map(mapResidentialBuilding);

    for (const position of path) {
      const placementError = getRoadPlacementError(
        position,
        cities,
        (x, y) => landTileIds.has(mapGenerator.getTileAt(x, y).tileId),
        residentialBuildings,
      );
      if (placementError) {
        await client.query('ROLLBACK');
        return { roads: null, error: placementError };
      }

      const city = cities.find(
        (candidate) =>
          Math.abs(candidate.centerX - position.x) <= MUNICIPAL_AREA_RADIUS &&
          Math.abs(candidate.centerY - position.y) <= MUNICIPAL_AREA_RADIUS,
      );
      if (!city) {
        await client.query('ROLLBACK');
        return { roads: null, error: 'outside_municipality' };
      }
      await client.query(
        `INSERT INTO road_tiles (tile_x, tile_y, city_id, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tile_x, tile_y) DO NOTHING`,
        [position.x, position.y, city.id, userId],
      );
    }

    const { rows: roadRows } = await client.query<{
      tile_x: number;
      tile_y: number;
      city_id: string;
    }>(`SELECT tile_x, tile_y, city_id FROM road_tiles ORDER BY tile_y, tile_x`);
    await client.query('COMMIT');
    return {
      roads: roadRows.map((road) => ({
        x: road.tile_x,
        y: road.tile_y,
        cityId: road.city_id,
      })),
      error: null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a construção da estrada:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function createCityAssembly(
  city: { name: string; centerX: number; centerY: number },
  userId: string,
): Promise<{ city: CityAssembly | null; error: CityPlacementError | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const existingCities = await client.query<{ center_x: number; center_y: number }>(
      `SELECT center_x, center_y FROM city_assemblies`,
    );
    const existingRoads = await client.query<{ tile_x: number; tile_y: number }>(
      `SELECT tile_x, tile_y FROM road_tiles`,
    );
    const placementError = getCityPlacementError(
      { x: city.centerX, y: city.centerY },
      existingCities.rows.map((row) => ({ centerX: row.center_x, centerY: row.center_y })),
      (x, y) => landTileIds.has(mapGenerator.getTileAt(x, y).tileId),
      WORLD_CONFIG,
      existingRoads.rows.map((row) => ({ x: row.tile_x, y: row.tile_y })),
    );
    if (placementError) {
      await client.query('ROLLBACK');
      return { city: null, error: placementError };
    }

    const { rows } = await client.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      minimum_wage: number;
      population: number;
      population_change_last_month: number;
      wellbeing: number;
      economy: number;
    }>(
      `INSERT INTO city_assemblies (id, name, center_x, center_y, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, center_x, center_y, population, population_change_last_month,
                 wellbeing, economy, minimum_wage`,
      [randomUUID(), city.name, city.centerX, city.centerY, userId],
    );
    await client.query('COMMIT');
    const row = rows[0];
    return {
      city: {
        id: row.id,
        name: row.name,
        centerX: row.center_x,
        centerY: row.center_y,
        minimumWage: row.minimum_wage,
        population: row.population,
        populationChangeLastMonth: row.population_change_last_month,
        wellbeing: row.wellbeing,
        economy: row.economy,
        zones: [],
      },
      error: null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a criação da assembleia:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function replaceCityZones(
  cityId: string,
  zones: CityZoneInput[],
): Promise<{ city: CityAssembly | null; error: string | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const { rows } = await client.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      minimum_wage: number;
      population: number;
      population_change_last_month: number;
      economy: number;
    }>(
      `SELECT id, name, center_x, center_y,
              COALESCE((
                SELECT SUM(home.occupants)::integer
                FROM all_buildings AS home
                WHERE home.city_id = city_assemblies.id
              ), 0) AS population,
              population_change_last_month, economy, minimum_wage
       FROM city_assemblies WHERE id = $1 FOR UPDATE`,
      [cityId],
    );
    const cityRow = rows[0];
    if (!cityRow) {
      await client.query('ROLLBACK');
      return { city: null, error: 'city_not_found' };
    }
    const { rows: residenceRows } = await client.query<{
      occupants: number;
      wellbeing: number;
    }>(
      `SELECT occupants, wellbeing FROM all_buildings
       WHERE city_id = $1 AND building_type = ANY($2::text[]) AND status = 'completed'`,
      [cityId, CITY_RESIDENCE_TYPES],
    );
    const cityWellbeing = getAverageWellbeing(residenceRows);

    const normalizedZones: CityZone[] = [];
    for (const zone of zones) {
      const placementError = getCityZonePlacementError(
        zone,
        zone.type,
        { centerX: cityRow.center_x, centerY: cityRow.center_y },
        normalizedZones,
      );
      if (placementError) {
        await client.query('ROLLBACK');
        return { city: null, error: placementError };
      }
      normalizedZones.push({ ...zone, id: randomUUID(), cityId });
    }

    await client.query('DELETE FROM city_zones WHERE city_id = $1', [cityId]);
    for (const zone of normalizedZones) {
      await client.query(
        `INSERT INTO city_zones (id, city_id, zone_type, min_x, min_y, max_x, max_y)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [zone.id, cityId, zone.type, zone.minX, zone.minY, zone.maxX, zone.maxY],
      );
    }
    await client.query('COMMIT');
    return {
      city: {
        id: cityRow.id,
        name: cityRow.name,
        centerX: cityRow.center_x,
        centerY: cityRow.center_y,
        minimumWage: cityRow.minimum_wage,
        population: cityRow.population,
        populationChangeLastMonth: cityRow.population_change_last_month,
        wellbeing: cityWellbeing,
        economy: cityRow.economy,
        zones: normalizedZones,
      },
      error: null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a atualização das regiões:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function createResidentialBuilding(
  type: ResidenceType,
  position: RoadPosition,
  userId: string,
  isMaster: boolean,
): Promise<{
  building: ResidentialBuilding | null;
  error: ResidencePlacementError | 'insufficient_materials' | null;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    let isFirstWarehouse = false;
    if (type === 'warehouse') {
      const { rows: warehouseRows } = await client.query<{ has_warehouse: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM player_warehouse_claims WHERE user_id = $1
         ) OR EXISTS (
           SELECT 1 FROM all_buildings WHERE building_type = 'warehouse' AND created_by = $1
         ) AS has_warehouse`,
        [userId],
      );
      isFirstWarehouse = !warehouseRows[0]?.has_warehouse;
    }

    const { rows: cityRows } = await client.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      minimum_wage: number;
      population: number;
      economy: number;
      zones: CityZone[];
    }>(
      `SELECT city.id, city.name, city.center_x, city.center_y, city.minimum_wage,
              city.population, city.economy,
              COALESCE(
                json_agg(json_build_object(
                  'id', zone.id,
                  'cityId', zone.city_id,
                  'type', zone.zone_type,
                  'minX', zone.min_x,
                  'minY', zone.min_y,
                  'maxX', zone.max_x,
                  'maxY', zone.max_y
                ) ORDER BY zone.min_y, zone.min_x)
                  FILTER (WHERE zone.id IS NOT NULL),
                '[]'::json
              ) AS zones
       FROM city_assemblies AS city
       LEFT JOIN city_zones AS zone ON zone.city_id = city.id
       GROUP BY city.id`,
    );
    const { rows: buildingRows } = await client.query<ResidentialBuildingRow>(
      `SELECT ${ALL_BUILDING_COLUMNS}
       FROM all_buildings`,
    );
    const buildings = buildingRows.map(mapResidentialBuilding);
    const wellbeingByCity = getCityWellbeingById(buildingRows);
    const cities: CityAssembly[] = cityRows.map((city) => ({
      id: city.id,
      name: city.name,
      centerX: city.center_x,
      centerY: city.center_y,
      minimumWage: city.minimum_wage,
      population: city.population,
      wellbeing: wellbeingByCity.get(city.id) ?? 0,
      economy: city.economy,
      zones: city.zones,
    }));
    const { rows: roadRows } = await client.query<{ tile_x: number; tile_y: number }>(
      'SELECT tile_x, tile_y FROM road_tiles',
    );
    const roads = roadRows.map((road) => ({ x: road.tile_x, y: road.tile_y }));
    const placementError = getResidencePlacementError(
      type,
      position,
      cities,
      buildings,
      roads,
      (x, y) => landTileIds.has(mapGenerator.getTileAt(x, y).tileId),
      WORLD_CONFIG,
    );
    if (placementError) {
      await client.query('ROLLBACK');
      return { building: null, error: placementError };
    }

    const definition = RESIDENCES[type];
    const city = cities.find(
      (candidate) =>
        position.x >= candidate.centerX - MUNICIPAL_AREA_RADIUS &&
        position.y >= candidate.centerY - MUNICIPAL_AREA_RADIUS &&
        position.x + definition.width - 1 <= candidate.centerX + MUNICIPAL_AREA_RADIUS &&
        position.y + definition.height - 1 <= candidate.centerY + MUNICIPAL_AREA_RADIUS,
    );
    if (!city) {
      await client.query('ROLLBACK');
      return { building: null, error: 'outside_municipality' };
    }

    let constructionInvestment = 0;
    let constructionMaterialsWithdrawn = false;
    if (!isFirstWarehouse && !isMaster) {
      const constructionCenterX = position.x + definition.width / 2;
      const constructionCenterY = position.y + definition.height / 2;
      const { rows: materialRows } = await client.query<{
        building_id: string;
        product_id: 'wood' | 'stone' | 'iron' | 'steel';
        quantity: number;
      }>(
        `SELECT warehouse.id AS building_id, stock.product_id, stock.quantity
         FROM all_buildings AS warehouse
         JOIN warehouse_stock AS stock ON stock.building_id = warehouse.id
         WHERE warehouse.building_type = 'warehouse'
           AND warehouse.status = 'completed'
           AND warehouse.created_by = $1
           AND stock.product_id IN ('wood', 'stone', 'iron', 'steel')
           AND POWER(warehouse.tile_x + $4 - $2, 2)
             + POWER(warehouse.tile_y + $4 - $3, 2) <= $5
         ORDER BY POWER(warehouse.tile_x + $4 - $2, 2)
             + POWER(warehouse.tile_y + $4 - $3, 2), warehouse.id`,
        [
          userId,
          constructionCenterX,
          constructionCenterY,
          RESIDENCES.warehouse.width / 2,
          LINK_RADIUS * LINK_RADIUS,
        ],
      );
      const withdrawals = planConstructionMaterialWithdrawals(
        materialRows.map((row) => ({
          buildingId: row.building_id,
          productId: row.product_id,
          quantity: row.quantity,
        })),
        definition.cost,
      );
      if (!withdrawals) {
        await client.query('ROLLBACK');
        return { building: null, error: 'insufficient_materials' };
      }
      constructionMaterialsWithdrawn = withdrawals.length > 0;
      const { rows: productCostRows } = await client.query<{
        product_id: string;
        unit_cost: string;
      }>(
        `SELECT product_id, unit_cost::text
         FROM player_product_costs
         WHERE user_id = $1 AND product_id = ANY($2::text[])`,
        [userId, ['wood', 'stone', 'iron', 'steel']],
      );
      const { rows: marketPriceRows } = await client.query<{
        product_id: string;
        average_price: string;
      }>(
        `SELECT product_id, AVG(price)::text AS average_price
         FROM warehouse_product_settings
         WHERE mode = 'sell' AND price > 0
           AND product_id = ANY($1::text[])
         GROUP BY product_id`,
        [['wood', 'stone', 'iron', 'steel']],
      );
      const productCosts = new Map(
        productCostRows.map((row) => [row.product_id, Number(row.unit_cost)]),
      );
      const marketPrices = new Map(
        marketPriceRows.map((row) => [row.product_id, Number(row.average_price)]),
      );
      constructionInvestment = roundCurrency(
        withdrawals.reduce(
          (total, withdrawal) =>
            total +
            withdrawal.quantity *
              (productCosts.get(withdrawal.productId) ??
                marketPrices.get(withdrawal.productId) ??
                0),
          0,
        ),
      );
      for (const withdrawal of withdrawals) {
        const { rowCount } = await client.query(
          `UPDATE warehouse_stock
           SET quantity = quantity - $3
           WHERE building_id = $1 AND product_id = $2 AND quantity >= $3`,
          [withdrawal.buildingId, withdrawal.productId, withdrawal.quantity],
        );
        if (rowCount !== 1) {
          throw new Error('O estoque de materiais mudou durante o início da construção.');
        }
      }
    }

    if (type === 'warehouse') {
      await client.query(
        'INSERT INTO player_warehouse_claims (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId],
      );
    }

    const { rows: numberRows } = await client.query<{ last_number: number }>(
      `INSERT INTO player_building_counters (user_id, building_type, last_number)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, building_type)
       DO UPDATE SET last_number = player_building_counters.last_number + 1
       RETURNING last_number`,
      [userId, type],
    );
    const buildingNumber = numberRows[0]?.last_number;
    if (!buildingNumber) throw new Error('Não foi possível atribuir o número da construção.');

    const { rows } = await client.query<ResidentialBuildingRow>(
      `INSERT INTO all_buildings
         (id, building_type, building_number, tile_x, tile_y, city_id, status, completed_at, created_by,
          selected_input_product_id, wage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'completed' THEN clock_timestamp() ELSE NULL END, $8, $9, GREATEST(10, $10))
       RETURNING ${ALL_BUILDING_COLUMNS}`,
      [
        randomUUID(),
        type,
        buildingNumber,
        position.x,
        position.y,
        city.id,
        isFirstWarehouse ? 'completed' : 'under_construction',
        userId,
        definition.defaultInputProductId ?? null,
        city.minimumWage,
      ],
    );
    if (constructionMaterialsWithdrawn) {
      const { rows: dayRows } = await client.query<{ day: string }>(
        `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
         FROM world_state WHERE id = 1`,
      );
      if (!dayRows[0]) throw new Error('O relógio do mundo não está disponível para registrar o investimento.');
      await client.query(
        `INSERT INTO player_investment_history (user_id, day, amount, category)
         VALUES ($1, $2::date, $3, 'construction')`,
        [userId, dayRows[0].day, constructionInvestment],
      );
    }
    await client.query('COMMIT');
    return { building: mapResidentialBuilding(rows[0]), error: null };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter o início da construção residencial:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function completeResidentialBuilding(
  id: string,
): Promise<{ building: ResidentialBuilding | null; error: 'building_not_found' | 'building_already_complete' | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const { rows: existingRows } = await client.query<{
      building_type: string;
      status: ResidentialBuilding['status'];
      city_id: string;
      created_by: string;
    }>(
      'SELECT building_type, status, city_id, created_by FROM all_buildings WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!existingRows[0]) {
      await client.query('COMMIT');
      return { building: null, error: 'building_not_found' };
    }
    if (existingRows[0].status !== 'under_construction') {
      await client.query('COMMIT');
      return { building: null, error: 'building_already_complete' };
    }
    const definition = getResidenceDefinition(existingRows[0].building_type);
    if (!definition) throw new Error(`Tipo de construção inválido: ${existingRows[0].building_type}`);
    let initialShopPrice: number | null = null;
    if (definition.kind === 'shop') {
      const { rows: priceRows } = await client.query<{
        owner_average: number | null;
        city_average: number | null;
      }>(
        `SELECT
           (SELECT AVG(price)::float8
            FROM all_buildings
            WHERE created_by = $1
              AND building_type = $2
              AND status = 'completed') AS owner_average,
           (SELECT AVG(price)::float8
            FROM all_buildings
            WHERE city_id = $3
              AND building_type = $2
              AND status = 'completed') AS city_average`,
        [
          existingRows[0].created_by,
          existingRows[0].building_type,
          existingRows[0].city_id,
        ],
      );
      const reference = priceRows[0];
      initialShopPrice = getInitialShopPrice(
        reference?.owner_average ?? null,
        reference?.city_average ?? null,
      );
    }
    const { rows } = await client.query<ResidentialBuildingRow>(
      `UPDATE all_buildings
       SET status = 'completed',
           completed_at = clock_timestamp(),
           desired_workers = LEAST(desired_workers, $2),
           price = COALESCE($3, price)
       WHERE id = $1 AND status = 'under_construction'
       RETURNING ${ALL_BUILDING_COLUMNS}`,
      [id, definition.maxWorkers, initialShopPrice],
    );
    if (!rows[0]) throw new Error(`A obra ${id} mudou durante a conclusão.`);
    await limitJobAssignments(client, id, definition.maxWorkers);
    await client.query('COMMIT');
    return { building: mapResidentialBuilding(rows[0]), error: null };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a conclusão da residência:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

function rejectWebSocketUpgrade(socket: Duplex, status: 401 | 404 | 503) {
  if (socket.destroyed) return;
  const statusText = status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Service Unavailable';
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function synchronizeBuildingFootprintMetrics(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE all_buildings IN SHARE ROW EXCLUSIVE MODE');
    const footprintEntries = Object.values(RESIDENCES).map((definition) => ({
      type: definition.type,
      tileCount: definition.width * definition.height,
    }));
    await client.query(
      `INSERT INTO building_footprint_catalog (building_type, tile_count)
       SELECT footprint.building_type, footprint.tile_count
       FROM UNNEST($1::text[], $2::smallint[]) AS footprint(building_type, tile_count)
       ON CONFLICT (building_type) DO UPDATE
       SET tile_count = EXCLUDED.tile_count`,
      [
        footprintEntries.map((entry) => entry.type),
        footprintEntries.map((entry) => entry.tileCount),
      ],
    );
    const { rows: unknownTypes } = await client.query<{ building_type: string }>(
      `SELECT DISTINCT building.building_type
       FROM all_buildings building
       LEFT JOIN building_footprint_catalog footprint
         ON footprint.building_type = building.building_type
       WHERE footprint.building_type IS NULL`,
    );
    if (unknownTypes.length > 0) {
      throw new Error(
        `Não há área cadastrada para as construções: ${unknownTypes.map((row) => row.building_type).join(', ')}.`,
      );
    }
    await client.query('DELETE FROM player_rank_metrics');
    await client.query(
      `INSERT INTO player_rank_metrics (user_id, building_tiles)
       SELECT building.created_by, SUM(footprint.tile_count)::integer
       FROM all_buildings building
       JOIN building_footprint_catalog footprint
         ON footprint.building_type = building.building_type
       GROUP BY building.created_by`,
    );
    const { rows: triggerRows } = await client.query<{ installed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgname = 'all_buildings_rank_tiles_trigger'
           AND tgrelid = 'all_buildings'::regclass
           AND NOT tgisinternal
       ) AS installed`,
    );
    if (!triggerRows[0]?.installed) {
      await client.query(
        `CREATE TRIGGER all_buildings_rank_tiles_trigger
         AFTER INSERT OR DELETE ON all_buildings
         FOR EACH ROW EXECUTE FUNCTION update_player_building_tiles()`,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a sincronização das áreas das construções:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

async function start() {
  const auth = getAuthConfig();
  const requireAuth = requireAuthentication(auth);
  const requireMasterAuth = requireMaster();
  await Promise.all([redis.connect(), subscriber.connect()]);
  const schema = await readFile(
    fileURLToPath(new URL('../database/schema.sql', import.meta.url)),
    'utf8',
  );
  await pool.query(schema);
  const capacityClient = await pool.connect();
  try {
    await capacityClient.query('BEGIN');
    await capacityClient.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    await removeCrossCityJobAssignments(capacityClient);
    const { rows: limitedBuildings } = await capacityClient.query<{
      id: string;
      building_type: ResidenceType;
    }>(
      `UPDATE all_buildings AS building
       SET desired_workers = limits.maximum_workers
       FROM UNNEST($1::text[], $2::integer[]) AS limits(building_type, maximum_workers)
       WHERE building.building_type = limits.building_type
         AND building.status = 'completed'
         AND building.desired_workers > limits.maximum_workers
       RETURNING building.id, building.building_type`,
      [
        Object.keys(RESIDENCES),
        Object.values(RESIDENCES).map((definition) => definition.maxWorkers),
      ],
    );
    for (const building of limitedBuildings) {
      await limitJobAssignments(
        capacityClient,
        building.id,
        RESIDENCES[building.building_type].maxWorkers,
      );
    }
    await capacityClient.query('COMMIT');
  } catch (error) {
    await capacityClient.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter o ajuste de funcionários às capacidades atuais:', rollbackError);
    });
    throw error;
  } finally {
    capacityClient.release();
  }
  const demandConfig = await readFile(
    fileURLToPath(new URL('../config/demanda_basica.txt', import.meta.url)),
    'utf8',
  );
  demandBasicByProduct = parseBasicDemandConfig(demandConfig);
  await pool.query(
    `INSERT INTO world_state (id, world_time, last_real_at)
     VALUES (1, TIMESTAMPTZ '1100-01-01 06:00:00+00', clock_timestamp())
     ON CONFLICT (id) DO NOTHING`,
  );
  await synchronizeBuildingFootprintMetrics();
  await pool.query(
    `INSERT INTO leaderboard_history_metadata (id, investment_tracking_from_day)
     SELECT 1, (world_time AT TIME ZONE 'UTC')::date
     FROM world_state WHERE id = 1
     ON CONFLICT (id) DO NOTHING`,
  );
  await Promise.all([
    subscriber.subscribe(SNAPSHOT_CHANNEL, (message) => broadcast(message)),
    subscriber.subscribe(CITIES_CHANNEL, deliverCities),
  ]);

  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_request, response) => {
    void Promise.all([pool.query('SELECT 1'), redis.ping()])
      .then(() => response.json({ status: 'ok' }))
      .catch((error: unknown) => {
        console.error('Verificação de saúde do mundo falhou:', error);
        response.status(503).json({ status: 'unavailable' });
      });
  });
  app.get('/api/me', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void isMasterUser(userId)
      .then((isMaster) => response.json({ isMaster }))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar a permissão da conta:', error);
        response.status(503).json({ error: 'authorization_unavailable' });
      });
  });
  app.get('/api/wallet', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Cria a carteira com o saldo inicial no primeiro acesso, de forma idempotente.
    void pool
      .query(
        `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, STARTING_BALANCE],
      )
      .then(() =>
        pool.query<{ balance: number }>(
          'SELECT balance FROM player_wallets WHERE user_id = $1',
          [userId],
        ),
      )
      .then(({ rows }) => response.json({ balance: rows[0].balance }))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar a carteira:', error);
        response.status(503).json({ error: 'wallet_unavailable' });
      });
  });
  app.get('/api/rankings', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    const periodDays =
      request.query.days === undefined
        ? 30
        : request.query.days === '30'
          ? 30
          : request.query.days === '365'
            ? LEADERBOARD_HISTORY_DAYS
            : null;
    if (periodDays === null) {
      response.status(400).json({ error: 'invalid_ranking_period' });
      return;
    }
    void (async () => {
      const { rows: clockRows } = await pool.query<{ day: string }>(
        `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
         FROM world_state WHERE id = 1`,
      );
      const worldDay = clockRows[0]?.day;
      if (!worldDay) {
        response.status(503).json({ error: 'world_unavailable' });
        return;
      }

      const [
        playerResult,
        marketPriceResult,
        buildingResult,
        buildingTilesResult,
        activityResult,
        profitResult,
        investmentResult,
        trackingResult,
      ] = await Promise.all([
        pool.query<{ id: string; name: string | null }>(
          `SELECT id, name
           FROM neon_auth."user"
           ORDER BY name, id`,
        ),
        pool.query<{ product_id: string; average_price: string }>(
          `SELECT product_id, AVG(price)::text AS average_price
           FROM warehouse_product_settings
           WHERE mode = 'sell' AND price > 0
           GROUP BY product_id`,
        ),
        pool.query<{ player_id: string; building_type: string }>(
          `SELECT created_by AS player_id, building_type
           FROM all_buildings`,
        ),
        pool.query<{ player_id: string; building_tiles: string }>(
          `SELECT user_id AS player_id, building_tiles::text
           FROM player_rank_metrics`,
        ),
        pool.query<{
          player_id: string;
          building_type: string;
          product_id: string | null;
          activity: 'shop_sales' | 'trade_sales' | 'production';
          quantity: string;
        }>(
          `SELECT building.created_by AS player_id,
                  building.building_type,
                  NULL::text AS product_id,
                  'shop_sales'::text AS activity,
                  SUM(history.units_sold)::text AS quantity
           FROM commerce_history history
           JOIN all_buildings building ON building.id = history.building_id
           WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
           GROUP BY building.created_by, building.building_type
           UNION ALL
           SELECT seller.created_by AS player_id,
                  seller.building_type,
                  history.product_id,
                  'trade_sales'::text AS activity,
                  SUM(history.quantity)::text AS quantity
           FROM warehouse_trade_history history
           JOIN all_buildings seller ON seller.id = history.seller_id
           WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
           GROUP BY seller.created_by, seller.building_type, history.product_id
           UNION ALL
           SELECT building.created_by AS player_id,
                  building.building_type,
                  NULL::text AS product_id,
                  'production'::text AS activity,
                  SUM(history.produced)::text AS quantity
           FROM production_history history
           JOIN all_buildings building ON building.id = history.building_id
           WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
           GROUP BY building.created_by, building.building_type`,
          [worldDay, periodDays],
        ),
        pool.query<{ player_id: string; income: string; expenses: string }>(
          `WITH financial_flows AS (
             SELECT building.created_by AS player_id,
                    COALESCE(SUM(history.units_sold::bigint * history.sale_price), 0) AS income,
                    COALESCE(SUM(history.product_expense), 0) AS expenses
             FROM commerce_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
             GROUP BY building.created_by
             UNION ALL
             SELECT building.created_by, COALESCE(SUM(history.rent_revenue), 0), 0::numeric
             FROM residence_rent_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
             GROUP BY building.created_by
             UNION ALL
             SELECT seller.created_by,
                    COALESCE(SUM(history.quantity::bigint * history.unit_price), 0),
                    0::numeric
             FROM warehouse_trade_history history
             JOIN all_buildings seller ON seller.id = history.seller_id
             WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
             GROUP BY seller.created_by
             UNION ALL
             SELECT buyer.created_by, 0::numeric,
                    COALESCE(SUM(history.quantity::bigint * history.unit_price), 0)
             FROM warehouse_trade_history history
             JOIN all_buildings buyer ON buyer.id = history.buyer_id
             WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
             GROUP BY buyer.created_by
             UNION ALL
             SELECT building.created_by, 0::numeric,
                    COALESCE(SUM(history.employee_expense), 0)
             FROM building_payroll_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE history.day BETWEEN $1::date - ($2::integer - 1) AND $1::date
             GROUP BY building.created_by
           )
           SELECT player_id,
                  SUM(income)::text AS income,
                  SUM(expenses)::text AS expenses
           FROM financial_flows
           GROUP BY player_id`,
          [worldDay, periodDays],
        ),
        pool.query<{ player_id: string; amount: string }>(
          `SELECT user_id AS player_id, SUM(amount)::text AS amount
           FROM player_investment_history
           WHERE day BETWEEN $1::date - ($2::integer - 1) AND $1::date
           GROUP BY user_id`,
          [worldDay, periodDays],
        ),
        pool.query<{
          sales_since: string;
          production_since: string;
          profit_since: string;
          investment_since: string;
        }>(
          `SELECT
             to_char(
               GREATEST(
                 $1::date - ($2::integer - 1),
                 COALESCE(
                   GREATEST(
                     (SELECT MIN(day) FROM commerce_history),
                     (SELECT MIN(day) FROM warehouse_trade_history)
                   ),
                   $1::date
                 )
               ),
               'YYYY-MM-DD'
             ) AS sales_since,
             to_char(
               GREATEST(
                 $1::date - ($2::integer - 1),
                 COALESCE((SELECT MIN(day) FROM production_history), $1::date)
               ),
               'YYYY-MM-DD'
             ) AS production_since,
             to_char(
               GREATEST(
                 $1::date - ($2::integer - 1),
                 COALESCE(
                   GREATEST(
                     (SELECT MIN(day) FROM commerce_history),
                     (SELECT MIN(day) FROM residence_rent_history),
                     (SELECT MIN(day) FROM warehouse_trade_history),
                     (SELECT MIN(day) FROM building_payroll_history)
                   ),
                   $1::date
                 )
               ),
               'YYYY-MM-DD'
             ) AS profit_since,
             to_char(
               GREATEST(
                 $1::date - ($2::integer - 1),
                 COALESCE(metadata.investment_tracking_from_day, $1::date)
               ),
               'YYYY-MM-DD'
             ) AS investment_since
           FROM (SELECT 1) singleton
           LEFT JOIN leaderboard_history_metadata metadata ON metadata.id = 1`,
          [worldDay, LEADERBOARD_HISTORY_DAYS],
        ),
      ]);

      const players = playerResult.rows.map((row) => ({
        playerId: row.id,
        playerName: row.name?.trim() || `Jogador ${row.id.slice(0, 8)}`,
      }));
      const marketPrices = new Map(
        marketPriceResult.rows.map((row) => [row.product_id, Number(row.average_price)]),
      );
      const companyValueByPlayer = new Map<string, number>();
      for (const row of buildingResult.rows) {
        const definition = getResidenceDefinition(row.building_type);
        if (!definition) {
          throw new Error(`Tipo de construção inválido no ranking: ${row.building_type}`);
        }
        const constructionCost = definition.cost;
        const value =
          constructionCost.wood * (marketPrices.get('wood') ?? 0) +
          constructionCost.stone * (marketPrices.get('stone') ?? 0) +
          (constructionCost.iron ?? 0) * (marketPrices.get('iron') ?? 0) +
          (constructionCost.steel ?? 0) * (marketPrices.get('steel') ?? 0);
        companyValueByPlayer.set(
          row.player_id,
          (companyValueByPlayer.get(row.player_id) ?? 0) + value,
        );
      }
      for (const [playerId, value] of companyValueByPlayer) {
        companyValueByPlayer.set(playerId, roundCurrency(value));
      }
      const buildingTilesByPlayer = new Map(
        buildingTilesResult.rows.map((row) => [row.player_id, Number(row.building_tiles)]),
      );
      const salesByPlayerAndProduct = new Map<string, Map<string, number>>();
      const productionByPlayerAndProduct = new Map<string, Map<string, number>>();
      const addProductActivity = (
        target: Map<string, Map<string, number>>,
        playerId: string,
        productId: string,
        quantity: number,
      ): void => {
        const productQuantities = target.get(playerId) ?? new Map<string, number>();
        productQuantities.set(productId, (productQuantities.get(productId) ?? 0) + quantity);
        target.set(playerId, productQuantities);
      };
      for (const row of activityResult.rows) {
        const quantity = Number(row.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) {
          throw new Error('O histórico de atividade contém uma quantidade inválida.');
        }
        const productId = row.product_id ??
          getResidenceDefinition(row.building_type)?.stockProductId;
        if (!productId) {
          throw new Error(`Não há produto associado à atividade de ${row.building_type}.`);
        }
        addProductActivity(
          row.activity === 'production' ? productionByPlayerAndProduct : salesByPlayerAndProduct,
          row.player_id,
          productId,
          quantity,
        );
      }
      const profitByPlayer = new Map(
        profitResult.rows.map((row) => [
          row.player_id,
          roundCurrency(Number(row.income) - Number(row.expenses)),
        ]),
      );
      const investmentByPlayer = new Map(
        investmentResult.rows.map((row) => [row.player_id, roundCurrency(Number(row.amount))]),
      );
      const rank = (scores: Map<string, number>) =>
        rankPlayers(
          players.map((player) => ({
            ...player,
            score: scores.get(player.playerId) ?? 0,
          })),
          userId,
        );
      const productRankings = PRODUCTS.map((product) => ({
        productId: product.id,
        sales: rank(
          new Map(
            players.map((player) => [
              player.playerId,
              salesByPlayerAndProduct.get(player.playerId)?.get(product.id) ?? 0,
            ]),
          ),
        ),
        production: rank(
          new Map(
            players.map((player) => [
              player.playerId,
              productionByPlayerAndProduct.get(player.playerId)?.get(product.id) ?? 0,
            ]),
          ),
        ),
      }));
      response.json({
        periodDays,
        worldDay,
        historyAvailableSince: trackingResult.rows[0] ?? null,
        companyValue: rank(companyValueByPlayer),
        buildingTiles: rank(buildingTilesByPlayer),
        products: productRankings,
        profit: rank(profitByPlayer),
        investment: rank(investmentByPlayer),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível calcular os rankings do mundo:', error);
      response.status(503).json({ error: 'rankings_unavailable' });
    });
  });
  app.get('/api/accounting', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    const periodDays =
      request.query.days === undefined ? 30 : parseAccountingPeriodDays(request.query.days);
    if (periodDays === null) {
      response.status(400).json({ error: 'invalid_accounting_period' });
      return;
    }
    void (async () => {
      const { rows: clockRows } = await pool.query<{ day: string }>(
        `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
         FROM world_state WHERE id = 1`,
      );
      const day = clockRows[0]?.day;
      if (!day) {
        response.status(503).json({ error: 'world_unavailable' });
        return;
      }
      const weekOffset =
        request.query.week === undefined ? 0 : parseAccountingWeekOffset(request.query.week);
      if (weekOffset === null) {
        response.status(400).json({ error: 'invalid_accounting_week' });
        return;
      }
      const weekRange = getAccountingWeekRange(day, weekOffset);

      const [
        shopResult,
        payrollResult,
        warehouseBuildingsResult,
        productResult,
        productFlowResult,
        productCostResult,
        residenceResult,
        productionResult,
        weeklyFinanceResult,
        employeeCountResult,
        assetBuildingsResult,
        inventoryWarehouseResult,
        inventoryInputResult,
        marketPriceResult,
      ] = await Promise.all([
        pool.query<{
          id: string;
          building_type: ResidenceType;
          building_number: number;
          tile_x: number;
          tile_y: number;
          employee_expense: string;
          revenue: string;
          units_sold: string;
          units_lost: string;
        }>(
          `SELECT building.id, building.building_type, building.building_number,
                  building.tile_x, building.tile_y,
                  COALESCE(SUM(history.employee_expense), 0)::text AS employee_expense,
                  COALESCE(SUM(history.units_sold::bigint * history.sale_price), 0)::text AS revenue,
                  COALESCE(SUM(history.units_sold), 0)::text AS units_sold,
                  COALESCE(SUM(history.units_lost), 0)::text AS units_lost
           FROM all_buildings building
           LEFT JOIN commerce_history history
             ON history.building_id = building.id
            AND history.day BETWEEN $2::date - ($4::integer - 1) AND $2::date
           WHERE building.created_by = $1
             AND building.building_type = ANY($3::text[])
           GROUP BY building.id, building.building_type, building.building_number,
                    building.tile_x, building.tile_y
           ORDER BY building.building_type, building.building_number`,
          [userId, day, SHOP_TYPES, periodDays],
        ),
        pool.query<{ employee_expense: string }>(
          `SELECT COALESCE(SUM(history.employee_expense), 0)::text AS employee_expense
           FROM building_payroll_history history
           JOIN all_buildings building ON building.id = history.building_id
           WHERE building.created_by = $1
             AND building.building_type IN ('warehouse', 'silo')
             AND history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date`,
          [userId, day, periodDays],
        ),
        pool.query<{
          id: string;
          building_number: number;
          tile_x: number;
          tile_y: number;
        }>(
          `SELECT id, building_number, tile_x, tile_y
           FROM all_buildings
           WHERE created_by = $1 AND building_type IN ('warehouse', 'silo')
           ORDER BY building_number`,
          [userId],
        ),
        pool.query<{
          product_id: string;
          bought_quantity: string;
          purchase_expense: string;
          sold_quantity: string;
          sales_revenue: string;
        }>(
          `SELECT history.product_id,
                  SUM(CASE WHEN buyer.id IS NOT NULL THEN history.quantity ELSE 0 END)::text AS bought_quantity,
                  SUM(CASE WHEN buyer.id IS NOT NULL THEN history.quantity::bigint * history.unit_price ELSE 0 END)::text
                    AS purchase_expense,
                  SUM(CASE WHEN seller.id IS NOT NULL THEN history.quantity ELSE 0 END)::text AS sold_quantity,
                  SUM(CASE WHEN seller.id IS NOT NULL THEN history.quantity::bigint * history.unit_price ELSE 0 END)::text
                    AS sales_revenue
           FROM warehouse_trade_history history
           LEFT JOIN all_buildings buyer
             ON buyer.id = history.buyer_id AND buyer.created_by = $1
           LEFT JOIN all_buildings seller
             ON seller.id = history.seller_id AND seller.created_by = $1
           WHERE history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date
             AND (buyer.id IS NOT NULL OR seller.id IS NOT NULL)
           GROUP BY history.product_id
           ORDER BY history.product_id`,
          [userId, day, periodDays],
        ),
        pool.query<{
          product_id: string;
          produced_quantity: string;
          imported_quantity: string;
          exported_quantity: string;
          residential_consumption: string;
          production_input_consumption: string;
        }>(
          `WITH product_ids AS (
             SELECT UNNEST($6::text[]) AS product_id
           ), production AS (
             SELECT definition.stock_product_id AS product_id,
                    SUM(history.produced)::text AS quantity
             FROM production_history history
             JOIN all_buildings building ON building.id = history.building_id
             JOIN UNNEST($4::text[], $5::text[])
               AS definition(building_type, stock_product_id)
               ON definition.building_type = building.building_type
             WHERE building.created_by = $1
               AND history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date
             GROUP BY definition.stock_product_id
           ), trades AS (
             SELECT history.product_id,
                    SUM(history.quantity) FILTER (
                      WHERE buyer.created_by = $1 AND seller.created_by <> $1
                    )::text AS imported,
                    SUM(history.quantity) FILTER (
                      WHERE seller.created_by = $1 AND buyer.created_by <> $1
                    )::text AS exported
             FROM warehouse_trade_history history
             JOIN all_buildings buyer ON buyer.id = history.buyer_id
             JOIN all_buildings seller ON seller.id = history.seller_id
             WHERE history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date
               AND (buyer.created_by = $1 OR seller.created_by = $1)
             GROUP BY history.product_id
           ), residential AS (
             SELECT history.product_id, SUM(history.quantity)::text AS quantity
             FROM residence_consumption history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE building.created_by = $1
               AND history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date
             GROUP BY history.product_id
           ), production_inputs AS (
             SELECT history.product_id, SUM(history.quantity)::text AS quantity
             FROM production_input_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE building.created_by = $1
               AND history.day BETWEEN $2::date - ($3::integer - 1) AND $2::date
             GROUP BY history.product_id
           )
           SELECT product_ids.product_id,
                  COALESCE(production.quantity, '0') AS produced_quantity,
                  COALESCE(trades.imported, '0') AS imported_quantity,
                  COALESCE(trades.exported, '0') AS exported_quantity,
                  COALESCE(residential.quantity, '0') AS residential_consumption,
                  COALESCE(production_inputs.quantity, '0') AS production_input_consumption
           FROM product_ids
           LEFT JOIN production USING (product_id)
           LEFT JOIN trades USING (product_id)
           LEFT JOIN residential USING (product_id)
           LEFT JOIN production_inputs USING (product_id)`,
          [
            userId,
            day,
            periodDays,
            PRODUCT_PRODUCER_DEFINITIONS.map((definition) => definition.type),
            PRODUCT_PRODUCER_DEFINITIONS.map((definition) => definition.stockProductId ?? ''),
            PRODUCTS.map((product) => product.id),
          ],
        ),
        pool.query<{ product_id: string; unit_cost: string }>(
          `SELECT product_id, unit_cost::text
           FROM player_product_costs
           WHERE user_id = $1`,
          [userId],
        ),
        pool.query<{
          id: string;
          building_type: ResidenceType;
          building_number: number;
          tile_x: number;
          tile_y: number;
          occupants: number;
          rent_revenue: string;
        }>(
          `SELECT building.id, building.building_type, building.building_number,
                  building.tile_x, building.tile_y, building.occupants,
                  COALESCE(SUM(history.rent_revenue), 0)::text AS rent_revenue
           FROM all_buildings building
           LEFT JOIN residence_rent_history history
             ON history.building_id = building.id
            AND history.day BETWEEN $2::date - ($4::integer - 1) AND $2::date
           WHERE building.created_by = $1
             AND building.building_type = ANY($3::text[])
           GROUP BY building.id
           ORDER BY building.building_type, building.building_number`,
          [userId, day, RESIDENCE_BUILDING_TYPES, periodDays],
        ),
        pool.query<{
          id: string;
          building_type: ResidenceType;
          building_number: number;
          tile_x: number;
          tile_y: number;
          employee_expense: string;
          produced: string;
        }>(
          `SELECT building.id, building.building_type, building.building_number,
                  building.tile_x, building.tile_y,
                  COALESCE(payroll.employee_expense, 0)::text AS employee_expense,
                  COALESCE(production.produced, 0)::text AS produced
           FROM all_buildings building
           LEFT JOIN (
             SELECT building_id, SUM(employee_expense) AS employee_expense
             FROM building_payroll_history
             WHERE day BETWEEN $2::date - ($4::integer - 1) AND $2::date
             GROUP BY building_id
           ) payroll ON payroll.building_id = building.id
           LEFT JOIN (
             SELECT building_id, SUM(produced) AS produced
             FROM production_history
             WHERE day BETWEEN $2::date - ($4::integer - 1) AND $2::date
             GROUP BY building_id
           ) production ON production.building_id = building.id
           WHERE building.created_by = $1
             AND building.building_type = ANY($3::text[])
           ORDER BY building.building_type, building.building_number`,
          [userId, day, PRODUCTION_BUILDING_TYPES, periodDays],
        ),
        pool.query<{ revenue: string; expenses: string }>(
          `SELECT COALESCE(SUM(parts.revenue), 0)::text AS revenue,
                  COALESCE(SUM(parts.expenses), 0)::text AS expenses
           FROM (
             SELECT COALESCE(SUM(history.units_sold::bigint * history.sale_price), 0) AS revenue,
                    COALESCE(SUM(history.product_expense), 0) AS expenses
             FROM commerce_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE building.created_by = $1 AND history.day BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT COALESCE(SUM(history.rent_revenue), 0), 0
             FROM residence_rent_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE building.created_by = $1 AND history.day BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT COALESCE(SUM(history.quantity::bigint * history.unit_price)
                       FILTER (WHERE seller.id IS NOT NULL), 0),
                    COALESCE(SUM(history.quantity::bigint * history.unit_price)
                       FILTER (WHERE buyer.id IS NOT NULL), 0)
             FROM warehouse_trade_history history
             LEFT JOIN all_buildings buyer
               ON buyer.id = history.buyer_id AND buyer.created_by = $1
             LEFT JOIN all_buildings seller
               ON seller.id = history.seller_id AND seller.created_by = $1
             WHERE history.day BETWEEN $2::date AND $3::date
               AND (buyer.id IS NOT NULL OR seller.id IS NOT NULL)
             UNION ALL
             SELECT 0, COALESCE(SUM(history.employee_expense), 0)
             FROM building_payroll_history history
             JOIN all_buildings building ON building.id = history.building_id
             WHERE building.created_by = $1 AND history.day BETWEEN $2::date AND $3::date
           ) AS parts`,
          [userId, weekRange.startDay, weekRange.endDay],
        ),
        pool.query<{ employees: string }>(
          `SELECT COALESCE(SUM(assignment.count), 0)::text AS employees
           FROM job_assignments assignment
           JOIN all_buildings workplace ON workplace.id = assignment.workplace_id
           WHERE workplace.created_by = $1`,
          [userId],
        ),
        pool.query<{
          building_type: ResidenceType;
          stock: number;
          tool_stock: number;
          wood_stock: number;
          iron_stock: number;
          charcoal_stock: number;
          sugarcane_stock: number;
        }>(
          `SELECT building_type, stock, tool_stock, wood_stock, iron_stock,
                  charcoal_stock, sugarcane_stock
           FROM all_buildings
           WHERE created_by = $1`,
          [userId],
        ),
        pool.query<{ product_id: string; quantity: string }>(
          `SELECT stock.product_id, SUM(stock.quantity)::text AS quantity
           FROM warehouse_stock stock
           JOIN all_buildings building ON building.id = stock.building_id
           WHERE building.created_by = $1
           GROUP BY stock.product_id`,
          [userId],
        ),
        pool.query<{ product_id: string; quantity: string }>(
          `SELECT stock.product_id, SUM(stock.quantity)::text AS quantity
           FROM building_input_stock stock
           JOIN all_buildings building ON building.id = stock.building_id
           WHERE building.created_by = $1
           GROUP BY stock.product_id`,
          [userId],
        ),
        pool.query<{ product_id: string; average_price: string }>(
          `SELECT product_id, AVG(price)::text AS average_price
           FROM warehouse_product_settings
           WHERE mode = 'sell' AND price > 0
           GROUP BY product_id`,
        ),
      ]);

      const marketPrices = new Map(
        marketPriceResult.rows.map((row) => [row.product_id, Number(row.average_price)]),
      );
      const inventoryQuantities = new Map<string, number>();
      const addInventory = (productId: string | undefined, quantity: number): void => {
        if (!productId || quantity <= 0) return;
        inventoryQuantities.set(productId, (inventoryQuantities.get(productId) ?? 0) + quantity);
      };
      for (const row of inventoryWarehouseResult.rows) {
        addInventory(row.product_id, Number(row.quantity));
      }
      for (const row of inventoryInputResult.rows) {
        addInventory(row.product_id, Number(row.quantity));
      }
      for (const row of assetBuildingsResult.rows) {
        const definition = getResidenceDefinition(row.building_type);
        addInventory(definition?.stockProductId, row.stock);
        addInventory('tools', row.tool_stock);
        addInventory('wood', row.wood_stock);
        addInventory('iron', row.iron_stock);
        addInventory('charcoal', row.charcoal_stock);
        addInventory('sugarcane', row.sugarcane_stock);
      }
      const companyValue = roundCurrency(
        assetBuildingsResult.rows.reduce((total, row) => {
          const cost = RESIDENCES[row.building_type].cost;
          return total +
            cost.wood * (marketPrices.get('wood') ?? 0) +
            cost.stone * (marketPrices.get('stone') ?? 0) +
            (cost.iron ?? 0) * (marketPrices.get('iron') ?? 0) +
            (cost.steel ?? 0) * (marketPrices.get('steel') ?? 0);
        }, 0),
      );
      const inventoryValue = roundCurrency(
        [...inventoryQuantities].reduce(
          (total, [productId, quantity]) => total + quantity * (marketPrices.get(productId) ?? 0),
          0,
        ),
      );
      const weeklyRevenue = Number(weeklyFinanceResult.rows[0]?.revenue ?? 0);
      const weeklyExpenses = Number(weeklyFinanceResult.rows[0]?.expenses ?? 0);
      const productFlows = new Map(
        productFlowResult.rows.map((row) => [row.product_id, row]),
      );
      const productCosts = new Map(
        productCostResult.rows.map((row) => [row.product_id, Number(row.unit_cost)]),
      );
      const shopSalesAndLoss = getShopSalesAndLossByProduct(
        shopResult.rows.map((row) => ({
          type: row.building_type,
          unitsSold: Number(row.units_sold),
          unitsLost: Number(row.units_lost),
        })),
      );
      const productSummaries = PRODUCTS.map((product) => {
        const flow = productFlows.get(product.id);
        const shopFlow = shopSalesAndLoss.get(product.id);
        const residentialConsumption = Number(flow?.residential_consumption ?? 0);
        const productionInputConsumption = Number(flow?.production_input_consumption ?? 0);
        return {
          productId: product.id,
          stockQuantity: inventoryQuantities.get(product.id) ?? 0,
          producedQuantity: Number(flow?.produced_quantity ?? 0),
          importedQuantity: Number(flow?.imported_quantity ?? 0),
          exportedQuantity: Number(flow?.exported_quantity ?? 0),
          shopSalesQuantity: shopFlow?.soldQuantity ?? 0,
          shopStockLossQuantity: shopFlow?.lostQuantity ?? 0,
          consumedQuantity: residentialConsumption + productionInputConsumption,
          residentialConsumption,
          productionInputConsumption,
          unitCostEstimate: productCosts.get(product.id) ?? null,
        };
      });
      const products = productResult.rows.map((row) => {
        const purchaseExpense = Number(row.purchase_expense);
        const salesRevenue = Number(row.sales_revenue);
        return {
          productId: row.product_id,
          boughtQuantity: Number(row.bought_quantity),
          purchaseExpense,
          soldQuantity: Number(row.sold_quantity),
          salesRevenue,
          profitLoss: roundCurrency(salesRevenue - purchaseExpense),
        };
      });
      response.json({
        periodDays,
        weekOffset,
        weeklySummary: {
          ...weekRange,
          revenue: roundCurrency(weeklyRevenue),
          expenses: roundCurrency(weeklyExpenses),
          profitLoss: roundCurrency(weeklyRevenue - weeklyExpenses),
          employees: Number(employeeCountResult.rows[0]?.employees ?? 0),
          companyValue,
          inventoryValue,
        },
        shops: shopResult.rows.map((row) => ({
          id: row.id,
          type: row.building_type,
          buildingNumber: row.building_number,
          x: row.tile_x,
          y: row.tile_y,
          employeeExpense: Number(row.employee_expense),
          revenue: Number(row.revenue),
          unitsSold: Number(row.units_sold),
          unitsLost: Number(row.units_lost),
          estimatedNetRevenue: calculateEstimatedShopNetRevenue(
            Number(row.revenue),
            Number(row.units_sold),
            Number(row.units_lost),
            getShopProductUnitCostEstimate(row.building_type, productCosts),
            Number(row.employee_expense),
          ),
        })),
        residences: residenceResult.rows.map((row) => ({
          id: row.id,
          type: row.building_type,
          buildingNumber: row.building_number,
          x: row.tile_x,
          y: row.tile_y,
          occupants: row.occupants,
          capacity: RESIDENCES[row.building_type].capacity,
          rentRevenue: Number(row.rent_revenue),
        })),
        production: productionResult.rows.map((row) => ({
          id: row.id,
          type: row.building_type,
          buildingNumber: row.building_number,
          x: row.tile_x,
          y: row.tile_y,
          employeeExpense: Number(row.employee_expense),
          produced: Number(row.produced),
          stockProductId: getResidenceDefinition(row.building_type)?.stockProductId ?? null,
        })).sort((first, second) =>
          RESIDENCES[first.type].name.localeCompare(RESIDENCES[second.type].name, 'pt-BR') ||
          first.buildingNumber - second.buildingNumber,
        ),
        products: productSummaries,
        warehouse: {
          employeeExpense: Number(payrollResult.rows[0]?.employee_expense ?? 0),
          buildings: warehouseBuildingsResult.rows.map((row) => ({
            id: row.id,
            buildingNumber: row.building_number,
            x: row.tile_x,
            y: row.tile_y,
          })),
          products,
        },
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar os dados contábeis:', error);
      response.status(503).json({ error: 'accounting_unavailable' });
    });
  });
  app.get('/api/performance-logs', requireAuth, (request, response) => {
    if (!authenticatedUserIds.get(request)) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void Promise.all([
      redis.lRange(PERFORMANCE_LOGS_KEY, 0, PERFORMANCE_LOG_LIMIT - 1),
      getWebSocketTrafficSnapshot(),
    ])
      .then(([entries, websocketTraffic]) => {
        const logs = entries.map((entry) => JSON.parse(entry) as PerformanceLogRecord);
        response.json({ logs, websocketTraffic });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar logs e métricas WebSocket:', error);
        response.status(503).json({ error: 'performance_logs_unavailable' });
      });
  });
  app.get('/api/player/resources', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const x = Number(request.query.x);
    const y = Number(request.query.y);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (
      !Number.isInteger(x) ||
      x < 0 ||
      x >= WORLD_CONFIG.width ||
      !Number.isInteger(y) ||
      y < 0 ||
      y >= WORLD_CONFIG.height
    ) {
      response.status(400).json({ error: 'invalid_area' });
      return;
    }
    void pool
      .query<{ wood: number; stone: number; iron: number; steel: number }>(
        `SELECT
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'wood'), 0)::int AS wood,
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'stone'), 0)::int AS stone,
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'iron'), 0)::int AS iron,
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'steel'), 0)::int AS steel
         FROM all_buildings AS warehouse
         LEFT JOIN warehouse_stock AS stock ON stock.building_id = warehouse.id
         WHERE warehouse.building_type = 'warehouse'
           AND warehouse.status = 'completed'
           AND warehouse.created_by = $1
           AND POWER(warehouse.tile_x + $4 - $2, 2)
             + POWER(warehouse.tile_y + $4 - $3, 2) <= 3600`,
        [userId, x, y, RESIDENCES.warehouse.width / 2],
      )
      .then(({ rows }) => response.json(rows[0]))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar os recursos próximos do jogador:', error);
        response.status(503).json({ error: 'resources_unavailable' });
      });
  });
  app.get('/api/cities', requireAuth, (_request, response) => {
    void getCities()
      .then((cities) => response.json(cities))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar as cidades:', error);
        response.status(503).json({ error: 'cities_unavailable' });
      });
  });
  app.get('/api/cities/:id/consumption', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_city' });
      return;
    }

    void (async () => {
      const { rows: cityRows } = await pool.query<{ id: string }>(
        'SELECT id FROM city_assemblies WHERE id = $1',
        [request.params.id],
      );
      if (!cityRows[0]) {
        response.status(404).json({ error: 'city_not_found' });
        return;
      }

      const { rows } = await pool.query<{
        product_id: string;
        last_quantity: number;
        last_consumer_quantity: number;
        last_desired_quantity: number;
        last_desired_consumers: number;
        last_desired_records: number;
        last_spent: number;
        last_consumers: number;
        month_quantity: number;
        month_consumer_quantity: number;
        month_desired_quantity: number;
        month_desired_consumers: number;
        month_desired_records: number;
        month_spent: number;
        month_consumers: number;
      }>(
        `WITH today AS (
           SELECT (world_time AT TIME ZONE 'UTC')::date AS day
           FROM world_state WHERE id = 1
         )
         SELECT consumption.product_id,
                COALESCE(SUM(consumption.quantity)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_quantity,
                COALESCE(SUM(consumption.quantity)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)
                    AND consumption.consumers IS NOT NULL), 0)::float8 AS last_consumer_quantity,
                COALESCE(SUM(consumption.desired_quantity)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_desired_quantity,
                COALESCE(SUM(consumption.consumers)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)
                    AND consumption.desired_quantity IS NOT NULL), 0)::float8 AS last_desired_consumers,
                COUNT(consumption.desired_quantity)
                  FILTER (WHERE consumption.day = (SELECT day FROM today))::int AS last_desired_records,
                COALESCE(SUM(consumption.spent)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_spent,
                COALESCE(SUM(consumption.consumers)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_consumers,
                COALESCE(SUM(consumption.quantity), 0)::float8 AS month_quantity,
                COALESCE(SUM(consumption.quantity)
                  FILTER (WHERE consumption.consumers IS NOT NULL), 0)::float8 AS month_consumer_quantity,
                COALESCE(SUM(consumption.desired_quantity), 0)::float8 AS month_desired_quantity,
                COALESCE(SUM(consumption.consumers)
                  FILTER (WHERE consumption.desired_quantity IS NOT NULL), 0)::float8 AS month_desired_consumers,
                COUNT(consumption.desired_quantity)::int AS month_desired_records,
                COALESCE(SUM(consumption.spent), 0)::float8 AS month_spent,
                COALESCE(SUM(consumption.consumers), 0)::float8 AS month_consumers
         FROM residence_consumption consumption
         JOIN all_buildings building ON building.id = consumption.building_id
         WHERE building.city_id = $1
           AND consumption.day > (SELECT day FROM today) - 30
         GROUP BY consumption.product_id`,
        [request.params.id],
      );
      response.json({
        products: rows.map((row) => ({
          productId: row.product_id,
          lastDayPerPerson: row.last_consumers > 0
            ? row.last_consumer_quantity / row.last_consumers
            : 0,
          lastDayDesiredPerPerson: row.last_desired_records > 0
            ? row.last_desired_consumers > 0
              ? row.last_desired_quantity / row.last_desired_consumers
              : 0
            : null,
          monthPerPerson: row.month_consumers > 0
            ? row.month_consumer_quantity / row.month_consumers
            : 0,
          monthDesiredPerPerson: row.month_desired_records > 0
            ? row.month_desired_consumers > 0
              ? row.month_desired_quantity / row.month_desired_consumers
              : 0
            : null,
          lastDayAveragePrice: row.last_quantity > 0 ? row.last_spent / row.last_quantity : null,
          monthAveragePrice: row.month_quantity > 0 ? row.month_spent / row.month_quantity : null,
        })),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar o consumo da cidade:', error);
      response.status(503).json({ error: 'city_unavailable' });
    });
  });
  app.get('/api/residential-buildings/:id/residence-benefit', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    void (async () => {
      const { rows } = await pool.query<{
        city_id: string;
        building_type: ResidenceType;
        tile_x: number;
        tile_y: number;
        rent: number;
        occupants: number;
        daily_income: number;
        monthly_products_cost: number;
        product_contributions: { productId: string; contribution: number }[];
      }>(
        `WITH selected AS (
           SELECT building.id, building.city_id, building.tile_x, building.tile_y,
                  building.building_type, building.rent, building.occupants,
                  COALESCE(SUM(assignments.count * workplace.wage), 0)::float8
                    / GREATEST(building.occupants, 1) AS daily_income,
                  COALESCE(product_totals.monthly_products_cost, 0)::float8 AS monthly_products_cost,
                  COALESCE(product_totals.product_contributions, '[]'::jsonb) AS product_contributions
           FROM all_buildings building
           LEFT JOIN job_assignments assignments ON assignments.residence_id = building.id
           LEFT JOIN all_buildings workplace ON workplace.id = assignments.workplace_id
           LEFT JOIN LATERAL (
             WITH product_costs AS (
               SELECT product_id,
                      (SUM(quantity) FILTER (WHERE consumers IS NOT NULL)
                        / NULLIF(SUM(consumers), 0))
                        * (SUM(spent) FILTER (WHERE consumers IS NOT NULL)
                          / NULLIF(SUM(quantity) FILTER (WHERE consumers IS NOT NULL), 0))
                        AS contribution
               FROM residence_consumption
               WHERE building_id = building.id
                 AND day >= (SELECT world_time::date FROM world_state WHERE id = 1) - 30
                 AND day < (SELECT world_time::date FROM world_state WHERE id = 1)
               GROUP BY product_id
             )
             SELECT SUM(contribution)::float8 AS monthly_products_cost,
                    jsonb_agg(jsonb_build_object(
                      'productId', product_id,
                      'contribution', contribution
                    ) ORDER BY product_id) AS product_contributions
             FROM product_costs
           ) product_totals ON TRUE
           WHERE building.id = $1
           GROUP BY building.id, product_totals.monthly_products_cost, product_totals.product_contributions
         )
         SELECT selected.city_id, selected.building_type, selected.tile_x, selected.tile_y,
                selected.rent, selected.occupants,
                selected.daily_income, selected.monthly_products_cost,
                selected.product_contributions
         FROM selected`,
        [request.params.id],
      );
      const row = rows[0];
      if (!row || getResidenceDefinition(row.building_type)?.kind !== 'residence') {
        response.status(row ? 400 : 404).json({ error: row ? 'not_a_residence' : 'residence_not_found' });
        return;
      }
      const residenceTypes = Object.values(RESIDENCES)
        .filter((definition) => definition.kind === 'residence')
        .map((definition) => definition.type);
      const { rows: cityResidences } = await pool.query<{
        id: string;
        building_type: ResidenceType;
        tile_x: number;
        tile_y: number;
        occupants: number;
        employed: number;
        payroll: number;
      }>(
        `SELECT home.id, home.building_type, home.tile_x, home.tile_y, home.occupants,
                COALESCE(SUM(assignments.count), 0)::int AS employed,
                COALESCE(SUM(assignments.count * workplace.wage), 0)::float8 AS payroll
         FROM all_buildings home
         LEFT JOIN job_assignments assignments ON assignments.residence_id = home.id
         LEFT JOIN all_buildings workplace ON workplace.id = assignments.workplace_id
         WHERE home.city_id = $1
           AND home.status = 'completed'
           AND home.building_type = ANY($2::text[])
         GROUP BY home.id`,
        [row.city_id, residenceTypes],
      );
      const cityEmployees = cityResidences.reduce((total, home) => total + home.employed, 0);
      const cityAverageSalary = cityEmployees > 0
        ? cityResidences.reduce((total, home) => total + home.payroll, 0) / cityEmployees
        : 0;
      const { rows: workplaceRows } = await pool.query<{
        building_type: ResidenceType;
        tile_x: number;
        tile_y: number;
        wage: number;
        desired_workers: number;
        status: ResidentialBuilding['status'];
        employed: number;
      }>(
        `SELECT workplace.building_type, workplace.tile_x, workplace.tile_y,
                workplace.wage, workplace.desired_workers, workplace.status,
                COALESCE(SUM(assignment.count), 0)::int AS employed
         FROM all_buildings workplace
         LEFT JOIN job_assignments assignment ON assignment.workplace_id = workplace.id
         WHERE workplace.city_id = $1
           AND (
             workplace.building_type <> ALL($2::text[])
             OR workplace.status = 'under_construction'
           )
         GROUP BY workplace.id`,
        [row.city_id, residenceTypes],
      );
      const employmentOffers: ResidenceEmploymentOffer[] = workplaceRows.flatMap((workplace) => {
        const desiredWorkers = Math.min(
          workplace.desired_workers,
          getMaxDesiredWorkers(workplace.building_type, workplace.status),
        );
        const vacancies = Math.max(0, desiredWorkers - workplace.employed);
        return vacancies > 0
          ? [{
              cityId: row.city_id,
              type: workplace.building_type,
              x: workplace.tile_x,
              y: workplace.tile_y,
              wage: workplace.wage,
              vacancies,
            }]
          : [];
      });
      const appealValues = calculateResidenceAppeals(
        cityResidences.map((home) => ({
          id: home.id,
          cityId: row.city_id,
          type: home.building_type,
          x: home.tile_x + RESIDENCES[home.building_type].width / 2,
          y: home.tile_y + RESIDENCES[home.building_type].height / 2,
          occupants: home.occupants,
          employed: home.employed,
          capacity: RESIDENCES[home.building_type].capacity,
          salaryAverage: home.employed > 0 ? home.payroll / home.employed : 0,
          cityAverageSalary,
          constructionAppeal: RESIDENCES[home.building_type].localAppeal,
        })),
        employmentOffers,
      ).get(request.params.id);
      if (!appealValues) {
        throw new Error(`Não foi possível calcular os apreços da residência ${request.params.id}.`);
      }
      const calculation = calculateResidenceBenefit({
        rent: row.rent,
        monthlyCost: row.rent + row.monthly_products_cost,
        dailyIncome: getResidenceBenefitIncome(
          row.occupants,
          row.daily_income,
          cityAverageSalary,
        ),
        ...appealValues,
      });
      response.json({ ...calculation, productContributions: row.product_contributions });
    })().catch((error: unknown) => {
      console.error('Não foi possível calcular o benefício da residência:', error);
      response.status(503).json({ error: 'residence_benefit_unavailable' });
    });
  });
  app.patch('/api/residential-buildings/:id/position', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const { x, y } = request.body ?? {};
    if (
      !residenceIdPattern.test(request.params.id) ||
      typeof x !== 'number' ||
      !Number.isInteger(x) ||
      typeof y !== 'number' ||
      !Number.isInteger(y)
    ) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      if (!(await isMasterUser(userId))) {
        response.status(403).json({ error: 'master_required' });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: selectedRows } = await client.query<{
          id: string;
          building_type: ResidenceType;
          city_id: string;
        }>(
          `SELECT id, building_type, city_id
           FROM all_buildings
           WHERE id = $1
           FOR UPDATE`,
          [request.params.id],
        );
        const selected = selectedRows[0];
        if (!selected) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }

        const { rows: cityRows } = await client.query<{
          id: string;
          name: string;
          center_x: number;
          center_y: number;
          minimum_wage: number;
          population: number;
          economy: number;
          zones: CityZone[];
        }>(
          `SELECT city.id, city.name, city.center_x, city.center_y, city.minimum_wage,
                  city.population, city.economy,
                  COALESCE(
                    json_agg(json_build_object(
                      'id', zone.id, 'cityId', zone.city_id, 'type', zone.zone_type,
                      'minX', zone.min_x, 'minY', zone.min_y, 'maxX', zone.max_x, 'maxY', zone.max_y
                    ) ORDER BY zone.min_y, zone.min_x) FILTER (WHERE zone.id IS NOT NULL),
                    '[]'::json
                  ) AS zones
           FROM city_assemblies city
           LEFT JOIN city_zones zone ON zone.city_id = city.id
           GROUP BY city.id`,
        );
        const { rows: buildingRows } = await client.query<ResidentialBuildingRow>(
          `SELECT ${ALL_BUILDING_COLUMNS} FROM all_buildings`,
        );
        const buildings = buildingRows.map(mapResidentialBuilding);
        const wellbeingByCity = getCityWellbeingById(buildingRows);
        const cities: CityAssembly[] = cityRows.map((city) => ({
          id: city.id,
          name: city.name,
          centerX: city.center_x,
          centerY: city.center_y,
          minimumWage: city.minimum_wage,
          population: city.population,
          wellbeing: wellbeingByCity.get(city.id) ?? 0,
          economy: city.economy,
          zones: city.zones,
        }));
        const movingBuilding = buildings.find((building) => building.id === selected.id);
        if (!movingBuilding) throw new Error(`A construção ${selected.id} não pôde ser carregada.`);
        const definition = RESIDENCES[selected.building_type];
        const position = { x, y };
        const { rows: roadRows } = await client.query<{ tile_x: number; tile_y: number }>(
          'SELECT tile_x, tile_y FROM road_tiles',
        );
        const roads = roadRows.map((road) => ({ x: road.tile_x, y: road.tile_y }));
        const placementError = getResidencePlacementError(
          selected.building_type,
          position,
          cities,
          buildings.filter((building) => building.id !== selected.id),
          roads,
          (tileX, tileY) => landTileIds.has(mapGenerator.getTileAt(tileX, tileY).tileId),
          WORLD_CONFIG,
        );
        if (placementError) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: placementError });
          return;
        }

        const destinationCity = cities.find(
          (city) =>
            x >= city.centerX - MUNICIPAL_AREA_RADIUS &&
            y >= city.centerY - MUNICIPAL_AREA_RADIUS &&
            x + definition.width - 1 <= city.centerX + MUNICIPAL_AREA_RADIUS &&
            y + definition.height - 1 <= city.centerY + MUNICIPAL_AREA_RADIUS,
        );
        if (!destinationCity) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'outside_municipality' });
          return;
        }
        const { rows: links } = await client.query<{
          building_type: ResidenceType;
          tile_x: number;
          tile_y: number;
        }>(
          `SELECT other.building_type, other.tile_x, other.tile_y
           FROM building_warehouse_links link
           JOIN all_buildings other
             ON other.id = CASE WHEN link.building_id = $1 THEN link.warehouse_id ELSE link.building_id END
           WHERE link.building_id = $1 OR link.warehouse_id = $1`,
          [selected.id],
        );
        if (links.some((linked) =>
          !isWithinLinkRadius(
            { type: selected.building_type, ...position },
            { type: linked.building_type, x: linked.tile_x, y: linked.tile_y },
          ),
        )) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'warehouse_out_of_range' });
          return;
        }

        const { rows: updatedRows } = await client.query<ResidentialBuildingRow>(
          `UPDATE all_buildings
           SET tile_x = $2, tile_y = $3, city_id = $4
           WHERE id = $1
           RETURNING ${ALL_BUILDING_COLUMNS}`,
          [selected.id, x, y, destinationCity.id],
        );
        await removeCrossCityJobAssignments(client, selected.id);
        await client.query('COMMIT');
        response.json(mapResidentialBuilding(updatedRows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('A construção foi movida, mas a atualização do mundo falhou:', error);
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a movimentação da construção:', rollbackError);
        });
        console.error('Não foi possível movimentar a construção:', error);
        response.status(503).json({ error: 'residence_move_unavailable' });
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível autorizar a movimentação da construção:', error);
      response.status(503).json({ error: 'residence_move_unavailable' });
    });
  });
  app.post('/api/residential-buildings', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    const type = request.body?.type;
    const x = request.body?.x;
    const y = request.body?.y;
    if (
      !isPlayerBuildableConstructionType(type) ||
      typeof x !== 'number' ||
      !Number.isInteger(x) ||
      typeof y !== 'number' ||
      !Number.isInteger(y)
    ) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }

    const definition = RESIDENCES[type];
    void isMasterUser(userId)
      .then((isMaster) => {
        void createResidentialBuilding(definition.type, { x, y }, userId, isMaster)
          .then(({ building, error }) => {
            if (!building) {
              response.status(409).json({ error });
              return;
            }
            response.status(201).json(building);
            void publishCities().catch((publishError: unknown) => {
              console.error('A residência foi iniciada, mas a atualização do mundo falhou:', publishError);
            });
          })
          .catch((error: unknown) => {
            console.error('Não foi possível iniciar a construção residencial:', error);
            response.status(503).json({ error: 'residence_creation_unavailable' });
          });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível verificar as permissões do jogador:', error);
        response.status(503).json({ error: 'authorization_unavailable' });
      });
  });
  app.post(
    '/api/residential-buildings/:id/complete',
    requireAuth,
    requireMasterAuth,
    (request, response) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          request.params.id,
        )
      ) {
        response.status(400).json({ error: 'invalid_residence' });
        return;
      }

      void completeResidentialBuilding(request.params.id)
        .then(({ building, error }) => {
          if (!building) {
            response.status(error === 'building_not_found' ? 404 : 409).json({ error });
            return;
          }
          response.json(building);
          void publishCities().catch((publishError: unknown) => {
            console.error('A residência foi concluída, mas a atualização do mundo falhou:', publishError);
          });
        })
        .catch((error: unknown) => {
          console.error('Não foi possível concluir a residência:', error);
          response.status(503).json({ error: 'residence_completion_unavailable' });
        });
    },
  );
  const residenceIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  app.get('/api/residential-buildings/:id/ownership', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool
      .query<{ created_by: string }>(
        'SELECT created_by FROM all_buildings WHERE id = $1',
        [request.params.id],
      )
      .then(({ rows }) => {
        if (!rows[0]) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        response.json({ isOwner: rows[0].created_by === userId });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o dono da construção:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.get('/api/residential-buildings/:id/warehouse-log', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void (async () => {
      const { rows: owners } = await pool.query<{ created_by: string }>(
        'SELECT created_by FROM all_buildings WHERE id = $1 AND building_type = $2',
        [request.params.id, 'warehouse'],
      );
      if (!owners[0]) {
        response.status(404).json({ error: 'warehouse_not_found' });
        return;
      }
      if (owners[0].created_by !== userId) {
        response.status(403).json({ error: 'forbidden' });
        return;
      }
      const { rows: events } = await pool.query<{
        day: string;
        linked_type: string;
        product_id: string;
        direction: string;
        wanted: number;
        moved: number;
        reason: string | null;
        error_detail: string | null;
      }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, linked_type, product_id, direction, wanted, moved, reason, error_detail
         FROM warehouse_transport_log
         WHERE warehouse_id = $1
         ORDER BY day DESC, id ASC
         LIMIT 300`,
        [request.params.id],
      );
      const { rows: days } = await pool.query<{ day: string; work_points: number }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, work_points
         FROM production_history WHERE building_id = $1 ORDER BY day DESC LIMIT 30`,
        [request.params.id],
      );
      response.json({
        days: days.map((row) => ({ day: row.day, workPoints: row.work_points })),
        events: events.map((row) => ({
          day: row.day,
          buildingType: row.linked_type,
          productId: row.product_id,
          direction: row.direction,
          wanted: row.wanted,
          moved: row.moved,
          reason: row.reason,
          errorDetail: row.error_detail,
        })),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar o histórico do armazém:', error);
      response.status(503).json({ error: 'residence_unavailable' });
    });
  });
  app.get('/api/residential-buildings/:id/production-history', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    void pool
      .query<{
        day: string;
        work_points: number;
        produced: number;
        transported: number;
        efficiency: number;
      }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, work_points, produced, transported, efficiency
         FROM production_history
         WHERE building_id = $1
         ORDER BY day DESC
         LIMIT 30`,
        [request.params.id],
      )
      .then(({ rows }) => {
        response.json({
          days: rows.map((row) => ({
            day: row.day,
            workPoints: row.work_points,
            produced: row.produced,
            transported: row.transported,
            efficiency: row.efficiency,
          })),
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o histórico de produção:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.get('/api/residential-buildings/:id/commerce-history', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void (async () => {
      const { rows: owners } = await pool.query<{ created_by: string }>(
        `SELECT created_by FROM all_buildings
         WHERE id = $1 AND building_type = ANY($2::text[])`,
        [request.params.id, SHOP_TYPES],
      );
      if (!owners[0]) {
        response.status(404).json({ error: 'shop_not_found' });
        return;
      }
      if (owners[0].created_by !== userId) {
        response.status(403).json({ error: 'forbidden' });
        return;
      }
      const { rows } = await pool.query<{
        day: string;
        employee_expense: number;
        product_expense: number;
        units_sold: number;
        units_lost: number;
        sale_price: number;
        diagnostics: ShopResidenceTransaction[] | null;
      }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                employee_expense, product_expense, units_sold, units_lost, sale_price,
                diagnostics
         FROM commerce_history
         WHERE building_id = $1
         ORDER BY day DESC
         LIMIT 30`,
        [request.params.id],
      );
      response.json({
        days: rows.map((row) => {
          const { revenue, profitLoss } = getShopProfitLoss(
            row.units_sold,
            row.sale_price,
            row.employee_expense,
            row.product_expense,
          );
          return {
            day: row.day,
            employeeExpense: row.employee_expense,
            productExpense: row.product_expense,
            unitsSold: row.units_sold,
            unitsLost: row.units_lost,
            salePrice: row.sale_price,
            revenue,
            profitLoss,
            transactions: row.diagnostics,
          };
        }),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar o histórico do comércio:', error);
      response.status(503).json({ error: 'residence_unavailable' });
    });
  });
  app.post('/api/residential-buildings/:id/simulate-sales', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    const price = parsePrice(request.body);
    const workSettings =
      typeof request.body === 'object' && request.body !== null
        ? parseWorkSettings({ ...request.body, desiredWorkers: 0 })
        : null;
    if (price === null || workSettings === null) {
      response.status(400).json({ error: 'invalid_sale_simulation_settings' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const { rows: targetRows } = await client.query<{
          id: string;
          created_by: string;
          city_id: string | null;
          building_type: ResidenceType;
          status: string;
        }>(
          `SELECT id, created_by, city_id, building_type, status
           FROM all_buildings WHERE id = $1`,
          [request.params.id],
        );
        const target = targetRows[0];
        if (!target) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'shop_not_found' });
          return;
        }
        if (target.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'shop_not_owned' });
          return;
        }
        const targetDefinition = getResidenceDefinition(target.building_type);
        if (
          target.status !== 'completed' ||
          targetDefinition?.kind !== 'shop' ||
          !targetDefinition.stockProductId ||
          !target.city_id
        ) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'not_a_completed_shop' });
          return;
        }
        const cityId = target.city_id;

        const { rows: buildingRows } = await client.query<{
          id: string;
          city_id: string;
          building_type: ResidenceType;
          tile_x: number;
          tile_y: number;
          status: string;
          price: number;
          stock: number;
          wage: number;
          work_hours_per_day: number;
          occupants: number;
          wellbeing: number;
        }>(
          `SELECT id, city_id, building_type, tile_x, tile_y, status,
                  price::float8 AS price, stock, wage::float8 AS wage,
                  work_hours_per_day, occupants, wellbeing::float8 AS wellbeing
           FROM all_buildings
           WHERE city_id = $1`,
          [cityId],
        );
        const { rows: assignmentRows } = await client.query<{
          workplace_id: string;
          residence_id: string;
          count: number;
          residence_wellbeing: number;
        }>(
          `SELECT assignments.workplace_id, assignments.residence_id, assignments.count,
                  COALESCE(residence.wellbeing, 0)::float8 AS residence_wellbeing
           FROM job_assignments assignments
           JOIN all_buildings workplace ON workplace.id = assignments.workplace_id
           JOIN all_buildings residence ON residence.id = assignments.residence_id
           WHERE workplace.city_id = $1 AND residence.city_id = $1`,
          [cityId],
        );
        const assignmentsForIncome = assignmentRows.map((assignment) => ({
          workplaceId: assignment.workplace_id,
          residenceId: assignment.residence_id,
          count: assignment.count,
        }));
        const wages = new Map(
          buildingRows.map((building) => [
            building.id,
            building.id === target.id ? workSettings.wage : building.wage,
          ]),
        );
        const residentialRows = buildingRows.filter((building) => {
          return (
            building.status === 'completed' &&
            getResidenceDefinition(building.building_type)?.kind === 'residence'
          );
        });
        const averageIncomes = getAverageIncomes(
          residentialRows.map((residence) => ({ id: residence.id })),
          wages,
          assignmentsForIncome,
        );
        const workersByWorkplace = new Map<string, number>();
        const consumersByResidence = new Map<string, number>();
        for (const assignment of assignmentRows) {
          workersByWorkplace.set(
            assignment.workplace_id,
            (workersByWorkplace.get(assignment.workplace_id) ?? 0) + assignment.count,
          );
          consumersByResidence.set(
            assignment.residence_id,
            (consumersByResidence.get(assignment.residence_id) ?? 0) + assignment.count,
          );
        }
        const averageTechniques = mapAverageWorkerTechniques(assignmentRows);
        const shopRows = buildingRows.filter((building) => {
          const definition = getResidenceDefinition(building.building_type);
          return (
            building.status === 'completed' &&
            definition?.kind === 'shop' &&
            Boolean(definition.stockProductId)
          );
        });
        const shops: SalesShop[] = shopRows.map((building) => {
          const definition = getResidenceDefinition(building.building_type);
          if (!definition?.stockProductId) {
            throw new Error(`O comércio ${building.id} não tem produto de venda configurado.`);
          }
          const workers = workersByWorkplace.get(building.id) ?? 0;
          const workHours =
            building.id === target.id ? workSettings.workHoursPerDay : building.work_hours_per_day;
          return {
            id: building.id,
            cityId: building.city_id,
            productId: definition.stockProductId,
            type: building.building_type,
            x: building.tile_x,
            y: building.tile_y,
            price: building.id === target.id ? price : building.price,
            stock: building.stock,
            capacity: getShopSalesCapacity(
              building.building_type,
              workers *
                getDailyWorkPoints(
                  workHours,
                  RESIDENCE_STATS.health,
                  averageTechniques.get(building.id) ?? 10,
                ),
              workers,
            ),
          };
        });
        const residences: SalesResidence[] = residentialRows.map((building) => ({
          id: building.id,
          cityId: building.city_id,
          type: building.building_type,
          x: building.tile_x,
          y: building.tile_y,
          consumers: consumersByResidence.get(building.id) ?? 0,
          averageIncome: averageIncomes.get(building.id) ?? 0,
          wellbeing: building.wellbeing,
        }));
        const { rows: worldRows } = await client.query<{ day: string }>(
          `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
           FROM world_state WHERE id = 1`,
        );
        const world = worldRows[0];
        if (!world) throw new Error('O relógio do mundo não está disponível para a simulação.');
        const shopTypes = [...new Set(shopRows.map((shop) => shop.building_type))];
        const { rows: monthlySalesRows } = await client.query<{
          building_type: ResidenceType;
          units_sold: number;
          sale_price: number;
        }>(
          `SELECT shop.building_type, history.units_sold, history.sale_price
           FROM commerce_history history
           JOIN all_buildings shop ON shop.id = history.building_id
           WHERE shop.city_id = $1
             AND history.day >= $2::date - $4::integer
             AND history.day < $2::date
             AND shop.status = 'completed'
             AND shop.building_type = ANY($3::text[])`,
          [cityId, world.day, shopTypes, GAME_RULES.consumption.averagePriceWindowDays],
        );
        const monthlySales: CityProductSale[] = monthlySalesRows.flatMap((sale) => {
          const productId = getResidenceDefinition(sale.building_type)?.stockProductId;
          return productId
            ? [{
                cityId,
                productId,
                unitsSold: sale.units_sold,
                price: sale.sale_price,
              }]
            : [];
        });
        const averagePrices = getCityProductAveragePrices(shops, monthlySales);
        const targetShop = shops.find((shop) => shop.id === target.id);
        if (!targetShop) throw new Error(`Não foi possível carregar a loja ${target.id}.`);
        const simulation: ShopSalesSimulation = simulateShopSales(
          target.id,
          residences,
          shops,
          demandBasicByProduct,
          averagePrices,
          {
            price,
            dailyCapacity: targetShop.capacity,
            wage: workSettings.wage,
            workers: workersByWorkplace.get(target.id) ?? 0,
          },
          Math.random,
          monthlySales,
        );
        await client.query('COMMIT');
        response.json(simulation);
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a simulação de vendas:', rollbackError);
        });
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível simular as vendas com os dados atuais:', error);
      response.status(503).json({ error: 'sale_simulation_unavailable' });
    });
  });
  app.get('/api/residential-buildings/:id/consumption', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    void pool
      .query<{
        product_id: string;
        last_quantity: number;
        last_spent: number;
        last_consumer_quantity: number;
        last_consumers: number;
        last_desired_quantity: number;
        last_desired_consumers: number;
        last_desired_records: number;
        month_quantity: number;
        month_consumer_quantity: number;
        month_spent: number;
        month_consumers: number;
        month_desired_quantity: number;
        month_desired_consumers: number;
        month_desired_records: number;
      }>(
        `WITH today AS (SELECT (world_time AT TIME ZONE 'UTC')::date AS day FROM world_state WHERE id = 1)
         SELECT product_id,
                COALESCE(SUM(quantity) FILTER (WHERE day = (SELECT day FROM today)), 0) AS last_quantity,
                COALESCE(SUM(spent) FILTER (WHERE day = (SELECT day FROM today)), 0) AS last_spent,
                COALESCE(SUM(quantity) FILTER (
                  WHERE day = (SELECT day FROM today) AND consumers IS NOT NULL
                ), 0) AS last_consumer_quantity,
                COALESCE(SUM(consumers) FILTER (WHERE day = (SELECT day FROM today)), 0)::float8 AS last_consumers,
                COALESCE(SUM(desired_quantity)
                  FILTER (WHERE day = (SELECT day FROM today)), 0)::float8 AS last_desired_quantity,
                COALESCE(SUM(consumers)
                  FILTER (WHERE day = (SELECT day FROM today)
                    AND desired_quantity IS NOT NULL), 0)::float8 AS last_desired_consumers,
                COUNT(desired_quantity)
                  FILTER (WHERE day = (SELECT day FROM today))::int AS last_desired_records,
                COALESCE(SUM(quantity), 0) AS month_quantity,
                COALESCE(SUM(quantity) FILTER (WHERE consumers IS NOT NULL), 0) AS month_consumer_quantity,
                COALESCE(SUM(spent), 0) AS month_spent,
                COALESCE(SUM(consumers), 0)::float8 AS month_consumers,
                COALESCE(SUM(desired_quantity), 0)::float8 AS month_desired_quantity,
                COALESCE(SUM(consumers)
                  FILTER (WHERE desired_quantity IS NOT NULL), 0)::float8 AS month_desired_consumers,
                COUNT(desired_quantity)::int AS month_desired_records
         FROM residence_consumption
         WHERE building_id = $1 AND day > (SELECT day FROM today) - 30
         GROUP BY product_id`,
        [request.params.id],
      )
      .then(({ rows }) => {
        response.json({
          products: rows.map((row) => ({
            productId: row.product_id,
            lastDayPerPerson: row.last_consumers > 0
              ? row.last_consumer_quantity / row.last_consumers
              : 0,
            lastDayDesiredPerPerson: row.last_desired_records > 0
              ? row.last_desired_consumers > 0
                ? row.last_desired_quantity / row.last_desired_consumers
                : 0
              : null,
            monthPerPerson: row.month_consumers > 0
              ? row.month_consumer_quantity / row.month_consumers
              : 0,
            monthDesiredPerPerson: row.month_desired_records > 0
              ? row.month_desired_consumers > 0
                ? row.month_desired_quantity / row.month_desired_consumers
                : 0
              : null,
            lastDayAveragePrice: row.last_quantity > 0 ? row.last_spent / row.last_quantity : null,
            monthAveragePrice: row.month_quantity > 0 ? row.month_spent / row.month_quantity : null,
          })),
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o consumo da residência:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.get('/api/residential-buildings/:id/warehouse-transfer-quote', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const destinationId = request.query.destinationId;
    const productId = request.query.productId;
    if (
      !userId ||
      !residenceIdPattern.test(request.params.id) ||
      typeof destinationId !== 'string' ||
      !residenceIdPattern.test(destinationId) ||
      typeof productId !== 'string'
    ) {
      response.status(400).json({ error: 'invalid_transfer_request' });
      return;
    }

    void pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const result = await getManualWarehouseTransferQuote(
          client,
          userId,
          request.params.id,
          destinationId,
          productId,
        );
        if ('error' in result) {
          await client.query('ROLLBACK');
          const status =
            result.error === 'transfer_building_not_owned'
              ? 403
              : result.error === 'transfer_building_not_found'
                ? 404
                : result.error === 'world_unavailable'
                  ? 503
                  : 409;
          response.status(status).json({ error: result.error });
          return;
        }
        await client.query('COMMIT');
        response.json({
          maxQuantity: result.quote.maxQuantity,
          workPoints: getTransportDemand(productId, result.quote.maxQuantity),
          destinationStock: result.quote.destinationStock,
          destinationCapacity: result.quote.destinationCapacity,
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a consulta de transferência:', rollbackError);
        });
        console.error('Não foi possível calcular os limites da transferência:', error);
        response.status(503).json({ error: 'transfer_unavailable' });
      } finally {
        client.release();
      }
    }).catch((error: unknown) => {
      console.error('Não foi possível iniciar a consulta de transferência:', error);
      response.status(503).json({ error: 'transfer_unavailable' });
    });
  });
  app.post('/api/residential-buildings/:id/warehouse-transfer', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const body = request.body as Record<string, unknown> | null;
    const destinationId = body?.destinationId;
    const productId = body?.productId;
    const quantity = body?.quantity;
    if (
      !userId ||
      !residenceIdPattern.test(request.params.id) ||
      typeof destinationId !== 'string' ||
      !residenceIdPattern.test(destinationId) ||
      typeof productId !== 'string' ||
      !Number.isInteger(quantity) ||
      (quantity as number) <= 0
    ) {
      response.status(400).json({ error: 'invalid_transfer_request' });
      return;
    }

    const failureReference = randomUUID().slice(0, 8).toUpperCase();
    let failureStage = 'connecting_to_database';
    void pool.connect().then(async (client) => {
      try {
        failureStage = 'beginning_transaction';
        await client.query('BEGIN');
        failureStage = 'acquiring_world_lock';
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        failureStage = 'rechecking_transfer_limits';
        const result = await getManualWarehouseTransferQuote(
          client,
          userId,
          request.params.id,
          destinationId,
          productId,
        );
        if ('error' in result) {
          await client.query('ROLLBACK');
          const status =
            result.error === 'transfer_building_not_owned'
              ? 403
              : result.error === 'transfer_building_not_found'
                ? 404
                : result.error === 'world_unavailable'
                  ? 503
                  : 409;
          response.status(status).json({ error: result.error });
          return;
        }
        if ((quantity as number) > result.quote.maxQuantity) {
          await client.query('ROLLBACK');
          response.status(409).json({
            error: 'transfer_limit_exceeded',
            maxQuantity: result.quote.maxQuantity,
          });
          return;
        }

        failureStage = 'removing_product_from_source';
        const { rowCount: sourceUpdated } = await client.query(
          `UPDATE warehouse_stock
           SET quantity = quantity - $3
           WHERE building_id = $1 AND product_id = $2 AND quantity >= $3::integer + $4::integer`,
          [request.params.id, productId, quantity, result.quote.sourceMinimumStock],
        );
        if (sourceUpdated !== 1) {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'transfer_stock_changed' });
          return;
        }
        if (result.quote.destinationColumn === 'input_stock') {
          failureStage = 'adding_product_to_destination';
          const { rowCount: destinationUpdated } = await client.query(
            `INSERT INTO building_input_stock (building_id, product_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (building_id, product_id) DO UPDATE
             SET quantity = building_input_stock.quantity + EXCLUDED.quantity
             WHERE building_input_stock.quantity + EXCLUDED.quantity <= $4`,
            [
              destinationId,
              productId,
              quantity,
              result.quote.destinationCapacity ?? 0,
            ],
          );
          if (destinationUpdated !== 1) {
            await client.query('ROLLBACK');
            response.status(409).json({ error: 'transfer_destination_full' });
            return;
          }
        } else if (result.quote.destinationColumn) {
          failureStage = 'adding_product_to_destination';
          const column = result.quote.destinationColumn;
          const { rowCount: destinationUpdated } = await client.query(
            `UPDATE all_buildings
             SET ${column} = ${column} + $2
             WHERE id = $1 AND ${column} + $2 <= $3`,
            [
              destinationId,
              quantity,
              (result.quote.destinationCapacity ?? 0),
            ],
          );
          if (destinationUpdated !== 1) {
            await client.query('ROLLBACK');
            response.status(409).json({ error: 'transfer_destination_full' });
            return;
          }
        } else {
          failureStage = 'adding_product_to_destination';
          await client.query(
            `INSERT INTO warehouse_stock (building_id, product_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (building_id, product_id)
             DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity`,
            [destinationId, productId, quantity],
          );
        }
        failureStage = 'recording_transfer_history';
        await client.query(
          `INSERT INTO warehouse_transport_log
             (warehouse_id, day, linked_id, linked_type, product_id, direction, wanted, moved, reason)
           VALUES ($1, $2::date, $3, $4, $5, 'in', $6, $6, NULL)`,
          [
            request.params.id,
            result.quote.day,
            destinationId,
            result.quote.destinationType,
            productId,
            quantity,
          ],
        );
        failureStage = 'registering_transport_work_points';
        const workPoints = getTransportDemand(productId, quantity as number);
        await logWarehouseDemand(client, request.params.id, result.quote.day, workPoints);
        failureStage = 'committing_transaction';
        await client.query('COMMIT');
        response.json({ quantity, workPoints });
        void publishCities().catch((error: unknown) => {
          console.error('A transferência foi concluída, mas a atualização do mundo falhou:', error);
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error(
            `Não foi possível reverter a transferência do armazém [${failureReference}]:`,
            rollbackError,
          );
        });
        const reason = getManualTransferFailureReason(error);
        console.error(
          `Falha na transferência [${failureReference}] durante ${failureStage} (${reason}):`,
          error,
        );
        response.status(503).json({
          error: 'transfer_unavailable',
          failureReference,
          failureStage,
          reason,
        });
      } finally {
        client.release();
      }
    }).catch((error: unknown) => {
      const reason = getManualTransferFailureReason(error);
      console.error(
        `Não foi possível iniciar a transferência [${failureReference}] durante ${failureStage} (${reason}):`,
        error,
      );
      response.status(503).json({
        error: 'transfer_unavailable',
        failureReference,
        failureStage,
        reason,
      });
    });
  });
  app.get('/api/residential-buildings/:id/warehouse', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }

    void pool
      .query<{ building_type: string; tile_x: number; tile_y: number }>(
        'SELECT building_type, tile_x, tile_y FROM all_buildings WHERE id = $1',
        [request.params.id],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (!isStorageBuilding(rows[0].building_type)) {
          response.status(400).json({ error: 'not_a_warehouse' });
          return;
        }
        const settings = await pool.query<{
          product_id: string;
          minimum_stock: number;
          maximum_stock: number | null;
          price: number;
          mode: 'sell' | 'buy';
        }>(
          `SELECT product_id, minimum_stock, maximum_stock, price, mode
           FROM warehouse_product_settings WHERE building_id = $1`,
          [request.params.id],
        );
        const stockRows = await pool.query<{ product_id: string; quantity: number }>(
          'SELECT product_id, quantity FROM warehouse_stock WHERE building_id = $1',
          [request.params.id],
        );
        const demandRows = await pool.query<{ day: string; demand: number }>(
          `SELECT to_char(day, 'YYYY-MM-DD') AS day, demand FROM warehouse_demand
           WHERE building_id = $1 AND day > (SELECT (world_time AT TIME ZONE 'UTC')::date FROM world_state WHERE id = 1) - 30
           ORDER BY day DESC`,
          [request.params.id],
        );
        const averagePriceRows = await pool.query<{ product_id: string; average_price: number }>(
          `SELECT setting.product_id,
                  SUM(setting.price::numeric * GREATEST(COALESCE(stock.quantity, 0) - setting.minimum_stock, 0))
                    / NULLIF(SUM(GREATEST(COALESCE(stock.quantity, 0) - setting.minimum_stock, 0)), 0)
                    AS average_price
           FROM all_buildings AS seller
           JOIN warehouse_product_settings AS setting ON setting.building_id = seller.id
           LEFT JOIN warehouse_stock AS stock
             ON stock.building_id = seller.id AND stock.product_id = setting.product_id
           WHERE seller.building_type IN ('warehouse', 'silo')
             AND seller.status = 'completed'
             AND setting.mode = 'sell'
             AND POWER(seller.tile_x - $1, 2) + POWER(seller.tile_y - $2, 2) <= 3600
           GROUP BY setting.product_id
           HAVING SUM(GREATEST(COALESCE(stock.quantity, 0) - setting.minimum_stock, 0)) > 0`,
          [rows[0].tile_x, rows[0].tile_y],
        );
        response.json({
          demand: {
            lastDay: demandRows.rows[0]?.day ?? null,
            last: demandRows.rows[0]?.demand ?? 0,
            monthAverage: demandRows.rows.reduce((sum, row) => sum + row.demand, 0) / 30,
          },
          settings: settings.rows.map((row) => ({
            productId: row.product_id,
            minimumStock: row.minimum_stock,
            maximumStock: row.maximum_stock,
            price: row.price,
            mode: row.mode,
          })),
          stock: stockRows.rows.map((row) => ({ productId: row.product_id, quantity: row.quantity })),
          averagePrices: averagePriceRows.rows.map((row) => ({
            productId: row.product_id,
            averagePrice: Number(row.average_price),
          })),
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o armazém:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.post('/api/residential-buildings/:id/warehouse/suppliers', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: targetRows } = await client.query<WarehouseTradeBuildingRow & { status: string }>(
          `SELECT b.id, b.building_type, b.created_by, b.status, b.tile_x, b.tile_y,
                  b.work_hours_per_day,
                  COALESCE((SELECT SUM(count) FROM job_assignments j WHERE j.workplace_id = b.id), 0)::int AS workers
           FROM all_buildings b WHERE b.id = $1`,
          [request.params.id],
        );
        const target = targetRows[0];
        if (!target || !isStorageBuilding(target.building_type)) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'warehouse_not_found' });
          return;
        }
        if (target.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        if (target.status !== 'completed') {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'warehouse_not_completed' });
          return;
        }

        const { rows: warehouseRows } = await client.query<WarehouseTradeBuildingRow>(
          `SELECT b.id, b.created_by, b.building_type, b.tile_x, b.tile_y, b.work_hours_per_day,
                  COALESCE((SELECT SUM(count) FROM job_assignments j WHERE j.workplace_id = b.id), 0)::int AS workers
           FROM all_buildings b
           WHERE b.building_type IN ('warehouse', 'silo') AND b.status = 'completed'
             AND (b.id = $1 OR (ABS(b.tile_x - $2) <= $4 AND ABS(b.tile_y - $3) <= $4))`,
          [target.id, target.tile_x, target.tile_y, LINK_RADIUS],
        );
        const warehouseIds = warehouseRows.map((row) => row.id);
        const averageTechniques = await loadAverageWorkerTechniques(client, warehouseIds);
        const { rows: stockRows } = await client.query<WarehouseTradeStockRow>(
          'SELECT building_id, product_id, quantity FROM warehouse_stock WHERE building_id = ANY($1::uuid[])',
          [warehouseIds],
        );
        const { rows: settingRows } = await client.query<WarehouseTradeSettingRow>(
          'SELECT building_id, product_id, minimum_stock, maximum_stock, price, mode FROM warehouse_product_settings WHERE building_id = ANY($1::uuid[])',
          [warehouseIds],
        );
        const tradeWarehouses = mapWarehouseTradeWarehouses(
          warehouseRows,
          stockRows,
          settingRows,
          averageTechniques,
        );
        const trades = planWarehouseTrades(tradeWarehouses, target.id);
        const ownerOf = new Map(warehouseRows.map((row) => [row.id, row.created_by]));
        const day =
          trades.length > 0
            ? (
                await client.query<{ day: string }>(
                  "SELECT (world_time AT TIME ZONE 'UTC')::date::text AS day FROM world_state WHERE id = 1",
                )
              ).rows[0]?.day ?? null
            : null;
        if (trades.length > 0 && day === null) {
          throw new Error('O relógio do mundo não está disponível para registrar a compra.');
        }
        if (day !== null) await applyWarehouseTrades(client, trades, ownerOf, day);
        await client.query('COMMIT');
        response.json({ trades });
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a busca de fornecedores:', rollbackError);
        });
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível procurar fornecedores para o armazém:', error);
      response.status(503).json({ error: 'warehouse_purchase_unavailable' });
    });
  });
  app.put('/api/residential-buildings/:id/warehouse', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const setting = parseWarehouseSetting(request.body);
    if (!residenceIdPattern.test(request.params.id) || !setting) {
      response.status(400).json({ error: 'invalid_warehouse_setting' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool
      .query<{ building_type: string; created_by: string; status: string }>(
        'SELECT building_type, created_by, status FROM all_buildings WHERE id = $1',
        [request.params.id],
      )
      .then(async ({ rows }) => {
        const building = rows[0];
        if (!building) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (!isStorageBuilding(building.building_type) || building.status !== 'completed') {
          response.status(400).json({ error: 'not_a_warehouse' });
          return;
        }
        if (!canStoreProduct(building.building_type, setting.productId)) {
          response.status(400).json({ error: 'invalid_warehouse_product' });
          return;
        }
        if (building.created_by !== userId) {
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        await pool.query(
          `INSERT INTO warehouse_product_settings
             (building_id, product_id, minimum_stock, maximum_stock, price, mode)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (building_id, product_id)
           DO UPDATE SET minimum_stock = EXCLUDED.minimum_stock,
                         maximum_stock = EXCLUDED.maximum_stock,
                         price = EXCLUDED.price, mode = EXCLUDED.mode`,
          [
            request.params.id,
            setting.productId,
            setting.minimumStock,
            setting.maximumStock,
            setting.price,
            setting.mode,
          ],
        );
        response.json(setting);
      })
      .catch((error: unknown) => {
        console.error('Não foi possível salvar a configuração do armazém:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.get('/api/residential-buildings/:id/stock-upgrades', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void (async () => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query<ResidentialBuildingRow & { created_by: string }>(
          `SELECT ${ALL_BUILDING_COLUMNS}, created_by
           FROM all_buildings WHERE id = $1`,
          [request.params.id],
        );
        const building = rows[0];
        if (!building) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (building.created_by !== userId) {
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        if (building.status !== 'completed') {
          response.status(409).json({ error: 'building_not_completed' });
          return;
        }
        response.json({
          quotes: await getStockCapacityUpgradeQuotes(client, building),
        });
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível calcular os upgrades de estoque:', error);
      response.status(503).json({ error: 'stock_upgrade_unavailable' });
    });
  });
  app.patch('/api/residential-buildings/:id/stock-upgrades', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const body = request.body as Record<string, unknown> | null;
    const stockKey = body?.stockKey;
    const direction = body?.direction;
    if (
      !residenceIdPattern.test(request.params.id) ||
      typeof stockKey !== 'string' ||
      (direction !== 'upgrade' && direction !== 'downgrade')
    ) {
      response.status(400).json({ error: 'invalid_stock_upgrade' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    void (async () => {
      const client = await pool.connect();
      let walletBalance: number | null = null;
      let investmentAmount = 0;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows } = await client.query<ResidentialBuildingRow & { created_by: string }>(
          `SELECT ${ALL_BUILDING_COLUMNS}, created_by
           FROM all_buildings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const building = rows[0];
        if (!building) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (building.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        if (building.status !== 'completed') {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'building_not_completed' });
          return;
        }
        const definition = getResidenceDefinition(building.building_type);
        const slot = definition &&
          getStockCapacitySlots(definition, building.selected_input_product_id)
            .find((candidate) => candidate.key === stockKey);
        if (!definition || !slot) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'invalid_stock_upgrade' });
          return;
        }
        const currentLevel = getStockLevel(building.stock_levels, slot.key);
        const targetLevel = currentLevel + (direction === 'upgrade' ? 1 : -1);
        if (targetLevel < 1 || targetLevel > 4) {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'stock_upgrade_level_limit' });
          return;
        }
        const targetCapacity = getStockCapacity(
          definition,
          slot.key,
          { ...building.stock_levels, [slot.key]: targetLevel },
        );
        if (
          direction === 'downgrade' &&
          getStockQuantityForKey(building, slot.key) > targetCapacity
        ) {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'stock_downgrade_requires_emptying' });
          return;
        }
        if (direction === 'upgrade') {
          const quotes = await getStockCapacityUpgradeQuotes(client, building);
          const quote = quotes.find((item) => item.key === slot.key);
          if (!quote || quote.upgradeCost === null) {
            await client.query('ROLLBACK');
            response.status(409).json({ error: 'stock_upgrade_price_unavailable' });
            return;
          }
          const { rows: walletRows } = await client.query<{ balance: number }>(
            `UPDATE player_wallets
             SET balance = balance - $2::numeric
             WHERE user_id = $1 AND balance >= $2::numeric
             RETURNING balance::float8`,
            [userId, quote.upgradeCost],
          );
          if (!walletRows[0]) {
            await client.query('ROLLBACK');
            response.status(409).json({ error: 'insufficient_funds' });
            return;
          }
          walletBalance = walletRows[0].balance;
          investmentAmount = quote.upgradeCost;
        }
        const { rows: updated } = await client.query<ResidentialBuildingRow>(
          `UPDATE all_buildings
           SET stock_levels = jsonb_set(
             COALESCE(stock_levels, '{}'::jsonb),
             ARRAY[$2::text],
             to_jsonb($3::integer),
             true
           )
           WHERE id = $1
           RETURNING ${ALL_BUILDING_COLUMNS}`,
          [building.id, slot.key, targetLevel],
        );
        if (!updated[0]) throw new Error(`O estoque da construção ${building.id} não foi atualizado.`);
        if (investmentAmount > 0) {
          const { rows: dayRows } = await client.query<{ day: string }>(
            `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
             FROM world_state WHERE id = 1`,
          );
          if (!dayRows[0]) throw new Error('O relógio do mundo não está disponível para registrar o investimento.');
          await client.query(
            `INSERT INTO player_investment_history (user_id, day, amount, category)
             VALUES ($1, $2::date, $3, 'stock_upgrade')`,
            [userId, dayRows[0].day, investmentAmount],
          );
        }
        await client.query('COMMIT');
        response.json({
          building: mapResidentialBuilding(updated[0]),
          walletBalance,
        });
        void publishCities().catch((error: unknown) => {
          console.error('O estoque foi atualizado, mas a atualização do mundo falhou:', error);
        });
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter o upgrade de estoque:', rollbackError);
        });
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível atualizar o nível do estoque:', error);
      response.status(503).json({ error: 'stock_upgrade_unavailable' });
    });
  });

  app.patch('/api/residential-buildings/:id/work-settings', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const settings = parseWorkSettings(request.body);
    if (!residenceIdPattern.test(request.params.id) || !settings) {
      response.status(400).json({ error: 'invalid_work_settings' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: buildingRows } = await client.query<{
          building_type: string;
          status: ResidentialBuilding['status'];
          created_by: string;
          city_minimum_wage: number;
          desired_workers: number;
          crop_phase: Crop['phase'] | null;
          farm_auto_planting_enabled: boolean;
          farm_planting_workers: number;
          farm_harvest_workers: number;
        }>(
          `SELECT building.building_type, building.status, building.created_by,
                  city.minimum_wage AS city_minimum_wage, building.desired_workers,
                  building.crop_phase, building.farm_auto_planting_enabled,
                  building.farm_planting_workers, building.farm_harvest_workers
           FROM all_buildings AS building
           JOIN city_assemblies AS city ON city.id = building.city_id
           WHERE building.id = $1 FOR UPDATE OF building`,
          [request.params.id],
        );
        const building = buildingRows[0];
        if (!building) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (building.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        if (settings.wage < building.city_minimum_wage) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'wage_below_minimum' });
          return;
        }
        const definition = getResidenceDefinition(building.building_type);
        const isResidence = definition?.kind === 'residence';
        if (
          !definition ||
          (isResidence && building.status !== 'under_construction') ||
          settings.desiredWorkers > getMaxDesiredWorkers(building.building_type, building.status)
        ) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'invalid_work_settings' });
          return;
        }
        const { rows } = await client.query<ResidentialBuildingRow>(
          `UPDATE all_buildings
             SET wage = $3, work_hours_per_day = $4, desired_workers = $5,
                 minimum_worker_technique = $6
             WHERE id = $1 AND created_by = $2
               AND (status = 'under_construction' OR building_type <> ALL($7::text[]))
           RETURNING ${ALL_BUILDING_COLUMNS}`,
          [
            request.params.id,
            userId,
            settings.wage,
            settings.workHoursPerDay,
            building.farm_auto_planting_enabled ? building.desired_workers : settings.desiredWorkers,
            settings.minimumWorkerTechnique,
            RESIDENCE_BUILDING_TYPES,
          ],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          throw new Error(`A construção ${request.params.id} mudou durante a atualização.`);
        }

        const targetWorkers = building.farm_auto_planting_enabled
          ? building.crop_phase === 'harvesting'
            ? building.farm_harvest_workers
            : building.crop_phase === 'growing'
              ? building.farm_planting_workers
              : 0
          : settings.desiredWorkers;
        await limitJobAssignments(client, request.params.id, targetWorkers);
        const { rows: updated } = await client.query<ResidentialBuildingRow>(
          `SELECT ${ALL_BUILDING_COLUMNS} FROM all_buildings WHERE id = $1`,
          [request.params.id],
        );
        await client.query('COMMIT');

        response.json(mapResidentialBuilding(updated[0]));
        void publishCities().catch((error: unknown) => {
          console.error('A construção foi atualizada, mas a atualização do mundo falhou:', error);
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('Não foi possível atualizar a construção:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      } finally {
        client.release();
      }
    })();
  });
  app.patch('/api/residential-buildings/:id/rent', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const rent = parseRent(request.body);
    if (!residenceIdPattern.test(request.params.id) || rent === null) {
      response.status(400).json({ error: 'invalid_rent' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: stateRows } = await client.query<{ day: string }>(
          `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
           FROM world_state WHERE id = 1 FOR UPDATE`,
        );
        const state = stateRows[0];
        if (!state) throw new Error('O relógio do mundo não está disponível para a realocação.');
        const { rows } = await client.query<ResidentialBuildingRow & { created_by: string }>(
          `SELECT ${ALL_BUILDING_COLUMNS}, created_by
           FROM all_buildings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const residence = rows[0];
        if (!residence) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (
          residence.created_by !== userId ||
          !RESIDENCE_BUILDING_TYPES.includes(residence.building_type)
        ) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }

        const rentChanged = Number(residence.rent) !== rent;
        if (rentChanged && residence.city_id) {
          const { rows: averageRentRows } = await client.query<{
            city_average_rent: number | null;
          }>(
            `SELECT AVG(rent)::float8 AS city_average_rent
             FROM all_buildings
             WHERE city_id = $1
               AND status = 'completed'
               AND building_type = ANY($2::text[])`,
            [residence.city_id, RESIDENCE_BUILDING_TYPES],
          );
          const cityAverageRent = averageRentRows[0]?.city_average_rent;
          if (
            cityAverageRent !== null &&
            cityAverageRent !== undefined &&
            !isRentIncreaseWithinCityAverageStepLimit(
              Number(residence.rent),
              rent,
              cityAverageRent,
            )
          ) {
            await client.query('ROLLBACK');
            response.status(400).json({ error: 'rent_increase_step_limit' });
            return;
          }
        }
        if (rentChanged) {
          await client.query('UPDATE all_buildings SET rent = $2 WHERE id = $1', [
            residence.id,
            rent,
          ]);
          if (
            residence.status === 'completed' &&
            getResidenceDefinition(residence.building_type)?.kind === 'residence'
          ) {
            const relocationCounts = emptyPerformanceCounts();
            await measurePerformanceStage(
              'mudanças de residência',
              'mudança de aluguel',
              state.day,
              randomUUID(),
              relocationCounts,
              async () =>
                (await applyResidenceRelocations(
                  client,
                  state.day,
                  relocationCounts,
                  residence.id,
                )).length > 0,
              0,
              false,
              5,
            );
          }
        }

        const { rows: updatedRows } = await client.query<ResidentialBuildingRow>(
          `SELECT ${ALL_BUILDING_COLUMNS} FROM all_buildings WHERE id = $1`,
          [residence.id],
        );
        const updatedResidence = updatedRows[0];
        if (!updatedResidence) {
          throw new Error(
            `Não foi possível carregar a residência ${residence.id} após alterar o aluguel.`,
          );
        }
        await client.query('COMMIT');
        response.json(mapResidentialBuilding(updatedResidence));
        if (rentChanged) {
          void publishCities().catch((error: unknown) => {
            console.error('O aluguel foi atualizado, mas a atualização do mundo falhou:', error);
          });
        }
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a alteração de aluguel:', rollbackError);
        });
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível atualizar o aluguel e realocar moradores:', error);
      if (!response.headersSent) {
        response.status(503).json({ error: 'residence_unavailable' });
      }
    });
  });
  app.patch('/api/residential-buildings/:id/price', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const price = parsePrice(request.body);
    if (!residenceIdPattern.test(request.params.id) || price === null) {
      response.status(400).json({ error: 'invalid_price' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool
      .query<ResidentialBuildingRow>(
        `UPDATE all_buildings
         SET price = $3
         WHERE id = $1 AND created_by = $2 AND building_type = ANY($4::text[])
         RETURNING ${ALL_BUILDING_COLUMNS}`,
        [request.params.id, userId, price, SHOP_TYPES],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query('SELECT 1 FROM all_buildings WHERE id = $1', [
            request.params.id,
          ]);
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'residence_not_owned' : 'residence_not_found' });
          return;
        }

        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('O preço foi atualizado, mas a atualização do mundo falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível atualizar o preço:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.patch('/api/residential-buildings/:id/input-product', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!residenceIdPattern.test(request.params.id) || !userId) {
      response.status(!userId ? 401 : 400).json({ error: !userId ? 'unauthorized' : 'invalid_residence' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: buildings } = await client.query<{
          building_type: ResidenceType;
          created_by: string;
          status: string;
        }>(
          `SELECT building_type, created_by, status
           FROM all_buildings
           WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const existing = buildings[0];
        if (!existing) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (existing.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        const productId = parseInputProductSelection(existing.building_type, request.body);
        if (!productId) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'invalid_input_product' });
          return;
        }
        if (existing.status !== 'completed') {
          await client.query('ROLLBACK');
          response.status(409).json({ error: 'building_not_completed' });
          return;
        }
        await client.query(
          `DELETE FROM building_input_stock
           WHERE building_id = $1 AND product_id <> $2`,
          [request.params.id, productId],
        );
        await client.query(
          `UPDATE all_buildings
           SET selected_input_product_id = $2
           WHERE id = $1`,
          [request.params.id, productId],
        );
        const { rows } = await client.query<ResidentialBuildingRow>(
          `SELECT ${ALL_BUILDING_COLUMNS}
           FROM all_buildings
           WHERE id = $1`,
          [request.params.id],
        );
        await client.query('COMMIT');
        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('A matéria-prima foi atualizada, mas a publicação do mundo falhou:', error);
        });
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a troca de matéria-prima:', rollbackError);
        });
        console.error('Não foi possível trocar a matéria-prima da construção:', error);
        response.status(503).json({ error: 'input_product_update_unavailable' });
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível iniciar a troca de matéria-prima:', error);
      response.status(503).json({ error: 'input_product_update_unavailable' });
    });
  });
  app.put('/api/residential-buildings/:id/farm-automation', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const settings = parseFarmAutomationSettings(request.body, 100000);
    if (!residenceIdPattern.test(request.params.id) || !settings) {
      response.status(400).json({ error: 'invalid_farm_automation' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: buildingRows } = await client.query<{
          building_type: string;
          status: ResidentialBuilding['status'];
          created_by: string;
          crop_phase: Crop['phase'] | null;
          desired_workers: number;
        }>(
          `SELECT building_type, status, created_by, crop_phase, desired_workers
           FROM all_buildings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const building = buildingRows[0];
        if (!building) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (building.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        const definition = getResidenceDefinition(building.building_type);
        if (
          !isAutomatableFarmType(building.building_type) ||
          building.status !== 'completed' ||
          !definition ||
          definition.kind !== 'farm' ||
          settings.plantingWorkers > definition.maxWorkers ||
          settings.harvestWorkers > definition.maxWorkers
        ) {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'invalid_farm_automation' });
          return;
        }
        const { rows } = await client.query<ResidentialBuildingRow>(
          `UPDATE all_buildings
           SET farm_auto_planting_enabled = $3,
               farm_auto_planting_months = $4::smallint[],
               farm_planting_workers = $5,
               farm_harvest_workers = $6
           WHERE id = $1 AND created_by = $2
           RETURNING ${ALL_BUILDING_COLUMNS}`,
          [
            request.params.id,
            userId,
            settings.enabled,
            settings.plantingMonths,
            settings.plantingWorkers,
            settings.harvestWorkers,
          ],
        );
        const targetWorkers = settings.enabled
          ? building.crop_phase === 'harvesting'
            ? settings.harvestWorkers
            : building.crop_phase === 'growing'
              ? settings.plantingWorkers
              : 0
          : building.desired_workers;
        await limitJobAssignments(client, request.params.id, targetWorkers);
        await client.query('COMMIT');

        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('A automação foi atualizada, mas a atualização do mundo falhou:', error);
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('Não foi possível salvar a automação da fazenda:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      } finally {
        client.release();
      }
    })();
  });
  app.post('/api/residential-buildings/:id/plant', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    // Iniciar ou reiniciar durante o crescimento zera o contador; durante a colheita não é permitido.
    void pool
      .query<ResidentialBuildingRow>(
        `UPDATE all_buildings
         SET crop_phase = 'growing',
             crop_planted_day = (SELECT (world_time AT TIME ZONE 'UTC')::date FROM world_state WHERE id = 1),
             crop_ratio_sum = 0, crop_days = 0, crop_yield = 0, crop_harvested = 0
         WHERE id = $1 AND created_by = $2 AND building_type = ANY($3::text[]) AND status = 'completed'
           AND (crop_phase IS NULL OR crop_phase = 'growing')
         RETURNING ${ALL_BUILDING_COLUMNS}`,
        [request.params.id, userId, FARM_CROP_TYPES],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const { rows: existing } = await pool.query<{
            created_by: string;
            building_type: string;
            status: string;
          }>('SELECT created_by, building_type, status FROM all_buildings WHERE id = $1', [
            request.params.id,
          ]);
          if (!existing[0]) {
            response.status(404).json({ error: 'residence_not_found' });
          } else if (existing[0].created_by !== userId) {
            response.status(403).json({ error: 'residence_not_owned' });
          } else if (!isFarmCropType(existing[0].building_type) || existing[0].status !== 'completed') {
            response.status(400).json({ error: 'cannot_plant' });
          } else {
            response.status(409).json({ error: 'harvest_in_progress' });
          }
          return;
        }

        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('O plantio foi registrado, mas a atualização do mundo falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível plantar:', error);
        response.status(503).json({ error: 'residence_unavailable' });
      });
  });
  app.put('/api/residential-buildings/:id/warehouse-link', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const link = parseWarehouseLink(request.body);
    if (
      !residenceIdPattern.test(request.params.id) ||
      !link ||
      (link.warehouseId !== null && !residenceIdPattern.test(link.warehouseId)) ||
      (link.warehouseId === request.params.id && link.linked)
    ) {
      response.status(400).json({ error: 'invalid_warehouse_link' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows: sources } = await client.query<{
          building_type: ResidenceType;
          status: string;
          created_by: string;
          tile_x: number;
          tile_y: number;
        }>(
          `SELECT building_type, status, created_by, tile_x, tile_y
           FROM all_buildings WHERE id = $1 FOR UPDATE`,
          [request.params.id],
        );
        const source = sources[0];
        if (!source) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (source.created_by !== userId) {
          await client.query('ROLLBACK');
          response.status(403).json({ error: 'residence_not_owned' });
          return;
        }
        if (!canLinkToWarehouse(source.building_type) || source.status !== 'completed') {
          await client.query('ROLLBACK');
          response.status(400).json({ error: 'invalid_warehouse_link' });
          return;
        }

        if (link.warehouseId !== null) {
          const { rows: targets } = await client.query<{
            building_type: ResidenceType;
            status: string;
            created_by: string;
            tile_x: number;
            tile_y: number;
          }>(
            `SELECT building_type, status, created_by, tile_x, tile_y
             FROM all_buildings WHERE id = $1 FOR SHARE`,
            [link.warehouseId],
          );
          const target = targets[0];
          if (!target || !isStorageBuilding(target.building_type) || target.status !== 'completed') {
            await client.query('ROLLBACK');
            response.status(400).json({ error: 'invalid_warehouse_link' });
            return;
          }
          if (target.created_by !== userId) {
            await client.query('ROLLBACK');
            response.status(403).json({ error: 'warehouse_not_owned' });
            return;
          }
          if (
            !isWithinLinkRadius(
              { type: source.building_type, x: source.tile_x, y: source.tile_y },
              { type: target.building_type, x: target.tile_x, y: target.tile_y },
            )
          ) {
            await client.query('ROLLBACK');
            response.status(400).json({ error: 'warehouse_out_of_range' });
            return;
          }
          if (link.linked) {
            await client.query(
              `INSERT INTO building_warehouse_links (building_id, warehouse_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [request.params.id, link.warehouseId],
            );
          } else {
            await client.query(
              'DELETE FROM building_warehouse_links WHERE building_id = $1 AND warehouse_id = $2',
              [request.params.id, link.warehouseId],
            );
          }
        } else {
          await client.query(
            'DELETE FROM building_warehouse_links WHERE building_id = $1',
            [request.params.id],
          );
        }

        const { rows } = await client.query<ResidentialBuildingRow>(
          `UPDATE all_buildings
           SET warehouse_id = (
             SELECT warehouse_id FROM building_warehouse_links
             WHERE building_id = all_buildings.id
             ORDER BY warehouse_id LIMIT 1
           )
           WHERE id = $1
           RETURNING ${ALL_BUILDING_COLUMNS}`,
          [request.params.id],
        );
        await client.query('COMMIT');
        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('O vínculo foi atualizado, mas a atualização do mundo falhou:', error);
        });
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a alteração de vínculo:', rollbackError);
        });
        throw error;
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível atualizar o vínculo:', error);
      response.status(503).json({ error: 'residence_unavailable' });
    });
  });
  app.delete('/api/residential-buildings/:id', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.id,
      )
    ) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool
      .query<{ id: string }>(
        `DELETE FROM all_buildings
         WHERE id = $1 AND created_by = $2
         RETURNING id`,
        [request.params.id, userId],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query(
            'SELECT 1 FROM all_buildings WHERE id = $1',
            [request.params.id],
          );
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'residence_not_owned' : 'residence_not_found' });
          return;
        }

        response.json(rows[0]);
        void publishCities().catch((error: unknown) => {
          console.error('A residência foi demolida, mas a atualização do mundo falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível demolir a residência:', error);
        response.status(503).json({ error: 'residence_demolition_unavailable' });
      });
  });
  app.post('/api/cities', requireAuth, requireMasterAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const city = parseCityInput(request.body);
    if (!city) {
      response.status(400).json({ error: 'invalid_city' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void createCityAssembly(city, userId)
      .then(({ city: createdCity, error }) => {
        if (!createdCity) {
          response.status(409).json({ error });
          return;
        }
        response.status(201).json(createdCity);
        void publishCities().catch((error: unknown) => {
          console.error('A assembleia foi criada, mas a atualização das cidades falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível criar a assembleia:', error);
        response.status(503).json({ error: 'city_creation_unavailable' });
      });
  });
  app.put('/api/cities/:id/zones', requireAuth, requireMasterAuth, (request, response) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.id,
      )
    ) {
      response.status(400).json({ error: 'invalid_city' });
      return;
    }

    const zones = parseCityZones(request.body);
    if (!zones) {
      response.status(400).json({ error: 'invalid_zones' });
      return;
    }

    void replaceCityZones(request.params.id, zones)
      .then(({ city, error }) => {
        if (!city) {
          if (error === 'city_not_found') {
            response.status(404).json({ error });
          } else {
            response.status(409).json({
              error: error === 'invalid_zone' ? 'invalid_zones' : error,
            });
          }
          return;
        }
        response.json(city);
        void publishCities().catch((publishError: unknown) => {
          console.error('As regiões foram salvas, mas a atualização das cidades falhou:', publishError);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível salvar as regiões da cidade:', error);
        response.status(503).json({ error: 'city_zones_unavailable' });
      });
  });
  app.post('/api/roads', requireAuth, requireMasterAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const { path, error } = parseRoadPath(request.body);
    if (!path) {
      response.status(error === 'path_too_long' ? 413 : 400).json({ error });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void createRoadPath(path, userId)
      .then(({ roads, error: placementError }) => {
        if (!roads) {
          response.status(409).json({ error: placementError });
          return;
        }
        response.status(201).json(roads);
        void publishCities().catch((publishError: unknown) => {
          console.error('A estrada foi construída, mas a atualização do mundo falhou:', publishError);
        });
      })
      .catch((creationError: unknown) => {
        console.error('Não foi possível construir a estrada:', creationError);
        response.status(503).json({ error: 'road_creation_unavailable' });
      });
  });
  app.delete('/api/roads', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const { path, error } = parseRoadPath(request.body);
    if (!path) {
      response.status(error === 'path_too_long' ? 413 : 400).json({ error });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const removed: RoadPosition[] = [];
        for (const position of path) {
          const { rows } = await client.query<{ tile_x: number; tile_y: number }>(
            `DELETE FROM road_tiles
             WHERE tile_x = $1 AND tile_y = $2 AND created_by = $3
             RETURNING tile_x, tile_y`,
            [position.x, position.y, userId],
          );
          if (rows[0]) removed.push({ x: rows[0].tile_x, y: rows[0].tile_y });
        }

        if (removed.length === 0) {
          const existing = await client.query(
            `SELECT 1
             FROM road_tiles AS road
             JOIN unnest($1::integer[], $2::integer[]) AS position(x, y)
               ON road.tile_x = position.x AND road.tile_y = position.y
             LIMIT 1`,
            [path.map(({ x }) => x), path.map(({ y }) => y)],
          );
          await client.query('COMMIT');
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'road_not_owned' : 'road_not_found' });
          return;
        }

        await client.query('COMMIT');
        response.json({ removed });
        void publishCities().catch((publishError: unknown) => {
          console.error('As estradas foram demolidas, mas a atualização do mundo falhou:', publishError);
        });
      } catch (demolitionError) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a demolição das estradas:', rollbackError);
        });
        console.error('Não foi possível demolir as estradas:', demolitionError);
        response.status(503).json({ error: 'road_demolition_unavailable' });
      } finally {
        client.release();
      }
    }).catch((connectionError: unknown) => {
      console.error('Não foi possível iniciar a demolição das estradas:', connectionError);
      response.status(503).json({ error: 'road_demolition_unavailable' });
    });
  });
  app.delete('/api/roads/:x/:y', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const { x, y } = request.params;
    if (!/^(0|[1-9]\d*)$/.test(x) || !/^(0|[1-9]\d*)$/.test(y)) {
      response.status(400).json({ error: 'invalid_road' });
      return;
    }

    const tileX = Number(x);
    const tileY = Number(y);
    if (
      !Number.isSafeInteger(tileX) ||
      !Number.isSafeInteger(tileY) ||
      tileX >= MAP.width ||
      tileY >= MAP.height
    ) {
      response.status(400).json({ error: 'invalid_road' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool.connect().then(async (client) => {
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows } = await client.query<{ tile_x: number; tile_y: number }>(
          `DELETE FROM road_tiles
           WHERE tile_x = $1 AND tile_y = $2 AND created_by = $3
           RETURNING tile_x, tile_y`,
          [tileX, tileY, userId],
        );
        if (!rows[0]) {
          const existing = await client.query(
            `SELECT 1 FROM road_tiles WHERE tile_x = $1 AND tile_y = $2`,
            [tileX, tileY],
          );
          await client.query('COMMIT');
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'road_not_owned' : 'road_not_found' });
          return;
        }

        await client.query('COMMIT');
        response.json({ x: rows[0].tile_x, y: rows[0].tile_y });
        void publishCities().catch((error: unknown) => {
          console.error('A estrada foi demolida, mas a atualização do mundo falhou:', error);
        });
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter a demolição da estrada:', rollbackError);
        });
        console.error('Não foi possível demolir a estrada:', error);
        response.status(503).json({ error: 'road_demolition_unavailable' });
      } finally {
        client.release();
      }
    }).catch((error: unknown) => {
      console.error('Não foi possível iniciar a demolição da estrada:', error);
      response.status(503).json({ error: 'road_demolition_unavailable' });
    });
  });
  app.patch('/api/cities/:id', requireAuth, requireMasterAuth, (request, response) => {
    const name =
      typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.id,
      ) ||
      name.length === 0 ||
      name.length > 80
    ) {
      response.status(400).json({ error: 'invalid_city' });
      return;
    }

    void pool
      .query<{ id: string; name: string }>(
        `UPDATE city_assemblies SET name = $1 WHERE id = $2 RETURNING id, name`,
        [name, request.params.id],
      )
      .then(({ rows }) => {
        const city = rows[0];
        if (!city) {
          response.status(404).json({ error: 'city_not_found' });
          return;
        }
        response.json(city);
        void publishCities().catch((error: unknown) => {
          console.error('O nome da cidade foi salvo, mas a atualização falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível atualizar o nome da cidade:', error);
        response.status(503).json({ error: 'city_update_unavailable' });
      });
  });
  app.patch('/api/cities/:id/minimum-wage', requireAuth, requireMasterAuth, (request, response) => {
    const minimumWage = parseCityMinimumWage(request.body?.minimumWage);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.id,
      ) ||
      minimumWage === null
    ) {
      response.status(400).json({ error: 'invalid_minimum_wage' });
      return;
    }

    void (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
        const { rows } = await client.query<{ id: string; minimum_wage: number }>(
          `UPDATE city_assemblies
           SET minimum_wage = $1
           WHERE id = $2
           RETURNING id, minimum_wage`,
          [minimumWage, request.params.id],
        );
        const city = rows[0];
        if (!city) {
          await client.query('ROLLBACK');
          response.status(404).json({ error: 'city_not_found' });
          return;
        }
        await client.query(
          `UPDATE all_buildings
           SET wage = $1
           WHERE city_id = $2 AND wage < $1`,
          [city.minimum_wage, city.id],
        );
        await client.query('COMMIT');
        response.json({ id: city.id, minimumWage: city.minimum_wage });
        void publishCities().catch((error: unknown) => {
          console.error('O salário mínimo foi salvo, mas a atualização das cidades falhou:', error);
        });
      } catch (error: unknown) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          console.error('Não foi possível reverter o salário mínimo da cidade:', rollbackError);
        });
        console.error('Não foi possível atualizar o salário mínimo da cidade:', error);
        response.status(503).json({ error: 'minimum_wage_update_unavailable' });
      } finally {
        client.release();
      }
    })().catch((error: unknown) => {
      console.error('Não foi possível iniciar a atualização do salário mínimo:', error);
      response.status(503).json({ error: 'minimum_wage_update_unavailable' });
    });
  });
  app.delete('/api/cities/:id', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.id,
      )
    ) {
      response.status(400).json({ error: 'invalid_city' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void pool
      .query<{ id: string }>(
        `DELETE FROM city_assemblies
         WHERE id = $1 AND created_by = $2
         RETURNING id`,
        [request.params.id, userId],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query(
            'SELECT 1 FROM city_assemblies WHERE id = $1',
            [request.params.id],
          );
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'city_not_owned' : 'city_not_found' });
          return;
        }

        response.json(rows[0]);
        void publishCities().catch((error: unknown) => {
          console.error('A construção foi demolida, mas a atualização das cidades falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível demolir a construção:', error);
        response.status(503).json({ error: 'city_demolition_unavailable' });
      });
  });
  app.get('/api/master/online-players', requireAuth, requireMasterAuth, (_request, response) => {
    void (async () => {
      await redis.zRemRangeByScore(PRESENCE_KEY, '-inf', Date.now());
      const entries = await redis.zRange(PRESENCE_KEY, 0, -1);
      const connections = new Map<string, number>();
      for (const entry of entries) {
        const id = entry.split('|')[0];
        if (id && id !== 'unknown') connections.set(id, (connections.get(id) ?? 0) + 1);
      }
      const { rows } = connections.size
        ? await pool.query<{ id: string; name: string | null; email: string | null }>(
            'SELECT id, name, email FROM neon_auth."user" WHERE id = ANY($1::text[])',
            [[...connections.keys()]],
          )
        : { rows: [] };
      response.json({
        players: rows
          .map((row) => ({
            id: row.id,
            name: row.name || row.email || row.id,
            email: row.email ?? '',
            connections: connections.get(row.id) ?? 1,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível listar os jogadores online:', error);
      response.status(503).json({ error: 'players_unavailable' });
    });
  });
  app.post('/api/master/time-scale', requireAuth, requireMasterAuth, (request, response) => {
    const timeScale = (request.body as { timeScale?: unknown } | undefined)?.timeScale;
    if (!isValidTimeScale(timeScale)) {
      response.status(400).json({ error: 'invalid_time_scale' });
      return;
    }
    // O mesmo UPDATE avança o relógio com a velocidade antiga antes de gravar a nova.
    void pool
      .query(
        `UPDATE world_state
         SET world_time = world_time
               + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - last_real_at)))
                 * time_scale * INTERVAL '1 second',
             last_real_at = clock_timestamp(),
             time_scale = $1
         WHERE id = 1`,
        [timeScale],
      )
      .then(() => publishSnapshot())
      .then(() => response.json({ timeScale }))
      .catch((error: unknown) => {
        console.error('Não foi possível alterar a velocidade do mundo:', error);
        response.status(503).json({ error: 'time_scale_unavailable' });
      });
  });
  app.post('/api/master/grant-money', requireAuth, requireMasterAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    const amount = parseMasterGrant((request.body as { amount?: unknown } | undefined)?.amount);
    if (!userId || amount === null) {
      response.status(400).json({ error: 'invalid_amount' });
      return;
    }
    void pool
      .query<{ balance: number }>(
        `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $2::numeric + $3::numeric)
         ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance + $3::numeric
         RETURNING balance`,
        [userId, STARTING_BALANCE, amount],
      )
      .then(({ rows }) => response.json({ balance: rows[0].balance }))
      .catch((error: unknown) => {
        console.error('Não foi possível adicionar dinheiro:', error);
        response.status(503).json({ error: 'wallet_unavailable' });
      });
  });
  app.get('/api/world', requireAuth, (_request, response) => {
    void getSnapshot()
      .then((snapshot) => response.json(snapshot))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o estado do mundo:', error);
        response.status(503).json({ error: 'world_unavailable' });
      });
  });

  const webRoot = resolve(process.cwd(), 'dist');
  app.use(
    express.static(webRoot, {
      index: false,
      maxAge: '1d',
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('.jxl')) {
          response.setHeader('Content-Type', 'image/jxl');
        }
        if (/[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(filePath)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.get('*', (_request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(resolve(webRoot, 'index.html'));
  });

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        rejectWebSocketUpgrade(socket, 404);
        return;
      }

      const token = url.searchParams.get('token');
      const wsUserId = token ? await verifyAccessToken(token, auth) : null;
      if (!wsUserId) {
        rejectWebSocketUpgrade(socket, 401);
        return;
      }

      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketUsers.set(websocket, wsUserId);
        websocketReconnects.set(websocket, url.searchParams.get('reconnect') === '1');
        websocketWorldDeltaSupport.set(
          websocket,
          url.searchParams.get('worldUpdates') === 'delta-v1',
        );
        websocketServer.emit('connection', websocket, request);
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível autenticar a conexão WebSocket:', error);
      rejectWebSocketUpgrade(socket, 503);
    });
  });

  websocketServer.on('connection', (websocket) => {
    clients.add(websocket);
    websocketWorldInitialized.set(websocket, false);
    const connectedAt = Date.now();
    websocketTrafficLastAccountedAt.set(websocket, connectedAt);
    recordWebSocketTrafficCounter(connectedAt, 'connections', 1);
    if (websocketReconnects.get(websocket)) {
      recordWebSocketTrafficCounter(connectedAt, 'reconnections', 1);
    }
    const presenceId = `${websocketUsers.get(websocket) ?? 'unknown'}|${randomUUID()}`;
    let presenceTimer: NodeJS.Timeout;

    const registerPresence = async () => {
      await redis.zAdd(PRESENCE_KEY, {
        score: Date.now() + PRESENCE_TTL_MS,
        value: presenceId,
      });
    };

    void registerPresence()
      .then(async () => {
        const snapshotPayload = JSON.stringify(await getSnapshot());
        websocket.send(snapshotPayload);
        recordWebSocketMessage('snapshot', snapshotPayload);
        await withWorldSyncLock(async (assertOwned) => {
          const world = await getWorldEntities();
          const cachedState = await redis.get(WORLD_SYNC_STATE_KEY);
          let revision = 0;
          if (cachedState !== null) {
            try {
              const parsed: unknown = JSON.parse(cachedState);
              if (isWorldSyncState(parsed)) {
                revision = parsed.revision;
              }
            } catch (error) {
              console.error('Não foi possível ler a revisão sincronizada do mundo:', error);
            }
          }
          assertOwned();
          const worldPayload = JSON.stringify(
            createPlayerWorldUpdate(
              { type: 'cities', revision, ...world },
              websocketUsers.get(websocket),
            ),
          );
          websocket.send(worldPayload);
          recordWebSocketMessage('worldUpdate', worldPayload);
          websocketWorldInitialized.set(websocket, true);
        });
        await publishSnapshot();
        presenceTimer = setInterval(() => {
          void registerPresence().catch((error: unknown) => {
            console.error('Não foi possível renovar a presença do jogador:', error);
            websocket.close(1011, 'Falha ao atualizar presença');
          });
        }, 10_000);
      })
      .catch((error: unknown) => {
        console.error('Não foi possível registrar a presença do jogador:', error);
        websocket.close(1011, 'Falha ao registrar presença');
      });

    websocket.on('close', () => {
      accountWebSocketConnectionTime(websocket, Date.now());
      clients.delete(websocket);
      clearInterval(presenceTimer);
      void redis
        .zRem(PRESENCE_KEY, presenceId)
        .then(publishSnapshot)
        .catch((error: unknown) => console.error('Não foi possível remover a presença:', error));
    });
    websocket.on('error', (error) => console.error('WebSocket:', error));
  });

  let tickRunning = false;
  const clockTimer = setInterval(() => {
    if (tickRunning) return;
    tickRunning = true;
    void redis
      .set(CLOCK_LEADER_KEY, INSTANCE_ID, { NX: true, EX: 2 })
      .then(async (leader) => {
        if (!leader) return;
        try {
          await advanceClock();
        } finally {
          await redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            { keys: [CLOCK_LEADER_KEY], arguments: [INSTANCE_ID] },
          );
        }
      })
      .catch((error: unknown) => console.error('Falha ao avançar o relógio do mundo:', error))
      .finally(() => {
        tickRunning = false;
      });
  }, 1000);

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`Valdora online em http://localhost:${PORT}`);
  });

  const shutdown = () => {
    clearInterval(clockTimer);
    clearInterval(websocketTrafficTimer);
    const disconnectedAt = Date.now();
    for (const websocket of clients) {
      accountWebSocketConnectionTime(websocket, disconnectedAt);
    }
    void flushWebSocketTraffic().finally(() => {
      websocketServer.close();
      server.close(() => {
        void Promise.all([redis.quit(), subscriber.quit(), pool.end()]).then(() => {
          process.exit(0);
        });
      });
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(async (error: unknown) => {
  console.error('Não foi possível iniciar o servidor do mundo:', error);
  await Promise.allSettled([redis.quit(), subscriber.quit(), pool.end()]);
  process.exitCode = 1;
});
