import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { Pool, type PoolClient } from 'pg';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';
import {
  type CityZone,
  type CityZoneBounds,
  type CityZoneType,
  type CityPlacementError,
  getCityZonePlacementError,
  getCityPlacementError,
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
  canStartResidenceConstruction,
  parseRent,
  parseWorkSettings,
  RESIDENCES,
  RESIDENCE_STATS,
  type ResidentialBuilding,
  type ResidenceType,
  type ResidencePlacementError,
} from '../src/types/residence.js';
import { STARTING_BALANCE } from '../src/types/wallet.js';
import { isValidTimeScale, parseMasterGrant } from '../src/types/worldClock.js';
import {
  advanceConstruction,
  allocateWorkers,
  getAverageIncomes,
  getDailyWorkPoints,
  getEmploymentSummary,
  getPayroll,
  type EmploymentSummaryWorkplace,
  type JobAssignment,
} from '../src/types/employment.js';
import {
  isCommerceDiagnosticsUpdate,
  getShopDailyFinancials,
  getShopProfitLoss,
  getShopSalesCapacity,
  parsePrice,
  planShopSalesDetailed,
  type CommerceDiagnosticsUpdate,
} from '../src/types/commerce.js';
import { nextEfficiencyPenalty, planProduction, rollToolDemand } from '../src/types/fishing.js';
import { getDairyFarmEfficiency } from '../src/types/dairy.js';
import { parseBasicDemandConfig } from '../src/types/commerceDemand.js';
import {
  canLinkToWarehouse,
  getTransportDemand,
  isWithinLinkRadius,
  parseWarehouseLink,
  planTransfersDetailed,
  planWarehouseTrades,
  type TradeWarehouse,
  type WarehouseTrade,
} from '../src/types/logistics.js';
import {
  advanceGrowth,
  getDailyWorkRatio,
  planHarvest,
  type Crop,
} from '../src/types/farming.js';
import { parseWarehouseSetting } from '../src/types/warehouse.js';
import { planDailySpoilage, PRODUCTS, type ProductDefinition } from '../src/types/product.js';
import {
  allocateImmigrants,
  getCityPopulation,
  IMMIGRATION_POPULATION_LIMIT,
} from '../src/types/immigration.js';
import { DEFAULT_TILE_LIST } from '../src/utils/tileAssets.js';
import { createMapGenerator } from '../src/utils/mapGenerator.js';
import { WORLD_CONFIG } from '../src/utils/worldConfig.js';

loadDotEnv({
  path: [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '.env')],
});

const PORT = Number(process.env.PORT ?? 3001);
const websocketUsers = new WeakMap<object, string>();
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
const CLOCK_LEADER_KEY = 'valdora:clock:leader';
const PRESENCE_KEY = 'valdora:presence';
const SNAPSHOT_CHANNEL = 'valdora:world:snapshots';
const CITIES_CHANNEL = 'valdora:world:cities';
const COMMERCE_DIAGNOSTICS_CHANNEL = 'valdora:world:commerce-diagnostics';
const INSTANCE_ID = randomUUID();
const PRESENCE_TTL_MS = 35_000;
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://valdora:valdora_dev_password@localhost:5432/valdora',
});
const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
const subscriber = redis.duplicate();
const clients = new Set<WebSocket>();
const app = express();
const server = createServer(app);
const websocketServer = new WebSocketServer({ noServer: true });

interface AuthConfig {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  issuer: string;
}

interface PendingCommerceDiagnostics extends CommerceDiagnosticsUpdate {
  ownerId: string;
}

interface CityAssembly {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  population: number;
  wellbeing: number;
  economy: number;
  zones: CityZone[];
}

type CityZoneInput = CityZoneBounds & { type: CityZoneType };
type ResidentialBuildingRow = {
  id: string;
  building_type: ResidenceType;
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
  desired_workers: number;
  work_points_done: number;
  price: number;
  stock: number;
  warehouse_id: string | null;
  tool_stock: number;
  wood_stock: number;
  iron_stock: number;
  efficiency_penalty: number;
  crop_phase: Crop['phase'] | null;
  crop_planted_day: string | null;
  crop_ratio_sum: number;
  crop_days: number;
  crop_yield: number;
  crop_harvested: number;
  employed: number;
  average_income: number;
};

const RESIDENTIAL_COLUMNS = `id, building_type, tile_x, tile_y, city_id, status, started_at, completed_at, wage, work_hours_per_day, rent, occupants, desired_workers, work_points_done, price, stock, warehouse_id, tool_stock, wood_stock, iron_stock, efficiency_penalty,
  crop_phase, to_char(crop_planted_day, 'YYYY-MM-DD') AS crop_planted_day, crop_ratio_sum, crop_days,
  crop_yield, crop_harvested,
  (SELECT COALESCE(SUM(j.count), 0)::int FROM job_assignments j
   WHERE j.workplace_id = residential_buildings.id OR j.residence_id = residential_buildings.id) AS employed,
  COALESCE((SELECT SUM(j.count * w.wage) FROM job_assignments j
            JOIN residential_buildings w ON w.id = j.workplace_id
            WHERE j.residence_id = residential_buildings.id), 0)::float8
    / GREATEST(occupants, 1) AS average_income`;

function mapResidentialBuilding(row: ResidentialBuildingRow): ResidentialBuilding {
  return {
    id: row.id,
    type: row.building_type,
    x: row.tile_x,
    y: row.tile_y,
    cityId: row.city_id,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    wage: row.wage,
    workHoursPerDay: row.work_hours_per_day,
    rent: row.rent,
    occupants: row.occupants,
    desiredWorkers: row.desired_workers,
    workPointsDone: row.work_points_done,
    price: row.price,
    stock: row.stock,
    warehouseId: row.warehouse_id,
    toolStock: row.tool_stock,
    woodStock: row.wood_stock,
    ironStock: row.iron_stock,
    efficiencyPenalty: row.efficiency_penalty,
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
  };
}

async function applyDailySpoilage(client: PoolClient): Promise<boolean> {
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

  const { rows: buildingStocks } = await client.query<{
    id: string;
    building_type: ResidenceType;
    stock: number;
  }>(
    `SELECT id, building_type, stock
     FROM residential_buildings
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
    await client.query('UPDATE residential_buildings SET stock = stock - $2 WHERE id = $1', [
      building.id,
      quantity,
    ]);
    changed = true;
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
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function deliverCommerceDiagnostics(message: string) {
  let update: unknown;
  try {
    update = JSON.parse(message);
  } catch (error) {
    console.error('Não foi possível interpretar o cálculo da demanda recebido pelo Redis:', error);
    return;
  }
  if (
    typeof update !== 'object' ||
    update === null ||
    !isCommerceDiagnosticsUpdate(update) ||
    !('ownerId' in update) ||
    typeof update.ownerId !== 'string'
  ) {
    console.error('O Redis publicou um cálculo da demanda inválido.');
    return;
  }

  const { ownerId, ...diagnostics } = update as PendingCommerceDiagnostics;
  const payload = JSON.stringify(diagnostics);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && websocketUsers.get(client) === ownerId) {
      client.send(payload);
    }
  }
}

async function publishSnapshot() {
  const snapshot = await getSnapshot();
  await redis.publish(SNAPSHOT_CHANNEL, JSON.stringify(snapshot));
}

async function getCities(): Promise<CityAssembly[]> {
  const [{ rows }, { rows: workplaceRows }] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      population: number;
      wellbeing: number;
      economy: number;
      zones: CityZone[];
    }>(
      `SELECT city.id, city.name, city.center_x, city.center_y,
            COALESCE((
              SELECT SUM(home.occupants)::integer
              FROM residential_buildings AS home
              WHERE home.city_id = city.id
            ), 0) AS population,
            city.wellbeing, city.economy,
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
       FROM residential_buildings b
       LEFT JOIN job_assignments j ON j.workplace_id = b.id
       GROUP BY b.id`,
    ),
  ]);
  const workplacesByCity = new Map<string, EmploymentSummaryWorkplace[]>();
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
  return rows.map((row) => ({
    ...getEmploymentSummary(workplacesByCity.get(row.id) ?? []),
    id: row.id,
    name: row.name,
    centerX: row.center_x,
    centerY: row.center_y,
    population: row.population,
    wellbeing: row.wellbeing,
    economy: row.economy,
    zones: row.zones,
  }));
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

async function getResidentialBuildings(): Promise<ResidentialBuilding[]> {
  const { rows } = await pool.query<ResidentialBuildingRow>(
    `SELECT ${RESIDENTIAL_COLUMNS}
     FROM residential_buildings
     ORDER BY started_at, id`,
  );
  return rows.map(mapResidentialBuilding);
}

async function publishCities() {
  const [cities, roads, buildings] = await Promise.all([
    getCities(),
    getRoadTiles(),
    getResidentialBuildings(),
  ]);
  await redis.publish(
    CITIES_CHANNEL,
    JSON.stringify({ type: 'cities', cities, roads, buildings }),
  );
}

async function runDailyImmigration(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
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

    const { rows } = await client.query<ResidentialBuildingRow>(
      `SELECT ${RESIDENTIAL_COLUMNS} FROM residential_buildings WHERE status = 'completed'`,
    );
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
          await client.query('UPDATE residential_buildings SET occupants = $2 WHERE id = $1', [
            home.id,
            home.occupants,
          ]);
        }
      }
    }
    await client.query('UPDATE world_state SET last_immigration_day = $1 WHERE id = 1', [state.day]);
    await client.query('COMMIT');
    return changed;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      console.error('Não foi possível reverter a imigração diária:', rollbackError);
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

interface WarehouseTradeBuildingRow {
  id: string;
  created_by: string;
  building_type: ResidenceType;
  tile_x: number;
  tile_y: number;
  work_hours_per_day: number;
  workers: number;
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
      capacityM3: RESIDENCES.warehouse.storageCapacityM3 ?? 0,
      workPoints:
        (building.workers *
          getDailyWorkPoints(
            building.work_hours_per_day,
            RESIDENCE_STATS.health,
            RESIDENCE_STATS.happiness,
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

    const cost = trade.quantity * trade.price;
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
        `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $3::bigint + $2::bigint)
         ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance + $2::bigint`,
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

// Histórico diário de produção; cada etapa da economia grava só as colunas que conhece.
// Roda em savepoint próprio: uma falha no histórico nunca pode desfazer a produção ou o transporte.
async function logProduction(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  buildingId: string,
  day: string,
  values: { workPoints?: number; produced?: number; transported?: number; efficiency?: number },
) {
  await client.query('SAVEPOINT production_log', []);
  try {
    await client.query(
      `INSERT INTO production_history (building_id, day, work_points, produced, transported, efficiency)
       VALUES ($1::uuid, $2::date, COALESCE($3::double precision, 0), COALESCE($4::double precision, 0),
               COALESCE($5::double precision, 0), COALESCE($6::double precision, 100))
       ON CONFLICT (building_id, day) DO UPDATE
       SET work_points = COALESCE($3::double precision, production_history.work_points),
           produced = COALESCE($4::double precision, production_history.produced),
           transported = production_history.transported + COALESCE($5::double precision, 0),
           efficiency = COALESCE($6::double precision, production_history.efficiency)`,
      [
        buildingId,
        day,
        values.workPoints ?? null,
        values.produced ?? null,
        values.transported ?? null,
        values.efficiency ?? null,
      ],
    );
    await client.query('RELEASE SAVEPOINT production_log', []);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT production_log', []);
    console.error('Não foi possível gravar o histórico de produção:', error);
  }
}

// Às 12:00 distribui os trabalhadores e às 00:00 cobra a folha de pagamento dos donos.
async function runDailyEmployment(): Promise<boolean> {
  const client = await pool.connect();
  const pendingCommerceDiagnostics: PendingCommerceDiagnostics[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
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
    if (state.last_payroll === null) {
      await client.query('UPDATE world_state SET last_payroll_day = $1 WHERE id = 1', [state.day]);
    } else if (state.last_payroll < state.day) {
      const { rows: workplaces } = await client.query<{
        id: string;
        created_by: string;
        city_id: string;
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
      }>(
        `SELECT id, created_by, city_id, wage, status, building_type, work_hours_per_day, work_points_done,
                tile_x, tile_y, price, stock, occupants
         FROM residential_buildings`,
      );
      const { rows: assignmentRows } = await client.query<{
        workplace_id: string;
        residence_id: string;
        count: number;
      }>('SELECT workplace_id, residence_id, count FROM job_assignments');
      const owed = getPayroll(
        workplaces.map((row) => ({ id: row.id, ownerId: row.created_by, wage: row.wage })),
        assignmentRows.map((row) => ({
          workplaceId: row.workplace_id,
          residenceId: row.residence_id,
          count: row.count,
        })),
      );
      for (const [ownerId, amount] of owed) {
        await client.query(
          `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $3::bigint - $2::bigint)
           ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance - $2::bigint`,
          [ownerId, amount, STARTING_BALANCE],
        );
      }
      // Work Points diários das obras: cada funcionário contribui conforme a carga horária.
      const workers = new Map<string, number>();
      for (const row of assignmentRows) {
        workers.set(row.workplace_id, (workers.get(row.workplace_id) ?? 0) + row.count);
      }
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
          RESIDENCE_STATS.happiness,
        );
        await client.query(
          `UPDATE residential_buildings
           SET work_points_done = $2::double precision,
               status = CASE WHEN $3::boolean THEN 'completed' ELSE status END,
               completed_at = CASE WHEN $3::boolean THEN clock_timestamp() ELSE completed_at END
           WHERE id = $1`,
          [site.id, progress.done, progress.completed],
        );
        changed = true;
      }
      // Falhas na economia (vendas, produção, transporte) não devem desfazer folha e obras do dia.
      await client.query('SAVEPOINT daily_economy');
      // Cada etapa tem seu próprio savepoint: uma falha nas vendas ou no transporte não desfaz a produção.
      const runStage = async (name: string, stage: () => Promise<void>): Promise<boolean> => {
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
      };
      try {
      const salesDiagnostics: PendingCommerceDiagnostics[] = [];
      const salesStageSucceeded = await runStage('vendas', async () => {
      // Vendas de arroz: capacidade do dia vem dos Work Points gerados pela loja.
      const wageOf = new Map(workplaces.map((row) => [row.id, row.wage]));
      const incomeByResidence = getAverageIncomes(
        workplaces,
        wageOf,
        assignmentRows.map((row) => ({
          workplaceId: row.workplace_id,
          residenceId: row.residence_id,
          count: row.count,
        })),
      );
      for (const { shopType, productId } of [
        { shopType: 'shop_rice', productId: 'rice' },
        { shopType: 'shop_fish', productId: 'fish' },
        { shopType: 'shop_milk', productId: 'milk' },
      ] as const) {
      const demandBasic = demandBasicByProduct.get(productId);
      if (demandBasic === undefined) {
        throw new Error(`demanda_basica não configurada para o produto ${productId}.`);
      }
      const { rows: previousSalesRows } = await client.query<{
        building_id: string;
        units_sold: number;
        sale_price: number;
      }>(
        `SELECT history.building_id, history.units_sold, history.sale_price
         FROM commerce_history history
         JOIN residential_buildings shop ON shop.id = history.building_id
         WHERE history.day = $1::date - 1 AND shop.building_type = $2`,
        [state.day, shopType],
      );
      const previousSales = new Map(previousSalesRows.map((row) => [row.building_id, row]));
      const shops = workplaces
        .filter((row) => row.status === 'completed' && row.building_type === shopType)
        .map((row) => {
          const previousSalesForShop = previousSales.get(row.id);
          return {
            id: row.id,
            ownerId: row.created_by,
            type: row.building_type,
            x: row.tile_x,
            y: row.tile_y,
            price: row.price,
            unitsSoldLastDay: previousSalesForShop?.units_sold ?? 0,
            lastDaySalePrice: previousSalesForShop?.sale_price ?? row.price,
            stock: row.stock,
            wage: row.wage,
            workers: workers.get(row.id) ?? 0,
            capacity: getShopSalesCapacity(
              (workers.get(row.id) ?? 0) *
                getDailyWorkPoints(row.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness),
            ),
          };
        });
      const homes = workplaces
        .filter(
          (row) =>
            row.status === 'completed' &&
            getResidenceDefinition(row.building_type)?.kind === 'residence' &&
            row.occupants > 0,
        )
        .map((row) => ({
          id: row.id,
          type: row.building_type,
          x: row.tile_x,
          y: row.tile_y,
          occupants: row.occupants,
          averageIncome: incomeByResidence.get(row.id) ?? 0,
        }));
      const sold = new Map<string, number>();
      const bought = new Map<string, { quantity: number; spent: number }>();
      const shopPrice = new Map(shops.map((shop) => [shop.id, shop.price]));
      const salesPlan = planShopSalesDetailed(homes, shops, Math.random, demandBasic);
      for (const purchase of salesPlan.purchases) {
        sold.set(purchase.shopId, (sold.get(purchase.shopId) ?? 0) + purchase.quantity);
        const total = bought.get(purchase.residenceId) ?? { quantity: 0, spent: 0 };
        total.quantity += purchase.quantity;
        total.spent += purchase.quantity * (shopPrice.get(purchase.shopId) ?? 0);
        bought.set(purchase.residenceId, total);
      }
      for (const home of homes) {
        const total = bought.get(home.id);
        if (!total) continue;
        await client.query(
          `INSERT INTO residence_consumption (building_id, product_id, day, quantity, spent, occupants)
           VALUES ($1, $6, $2, $3, $4, $5)
           ON CONFLICT (building_id, product_id, day) DO UPDATE
           SET quantity = residence_consumption.quantity + $3,
               spent = residence_consumption.spent + $4,
               occupants = $5`,
          [home.id, state.day, total.quantity, total.spent, home.occupants, productId],
        );
      }
      for (const shop of shops) {
        const quantity = sold.get(shop.id) ?? 0;
        if (quantity > 0) {
          const owner = workplaces.find((row) => row.id === shop.id)?.created_by;
          await client.query('UPDATE residential_buildings SET stock = stock - $2 WHERE id = $1', [
            shop.id,
            quantity,
          ]);
          if (owner) {
            await client.query(
              `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $3::bigint + $2::bigint)
               ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance + $2::bigint`,
              [owner, quantity * shop.price, STARTING_BALANCE],
            );
          }
          changed = true;
        }
        const financials = getShopDailyFinancials(
          shop.wage,
          shop.workers,
          quantity,
          shop.price,
        );
        await client.query(
          `INSERT INTO commerce_history
             (building_id, day, employee_expense, product_expense, units_sold, sale_price)
           VALUES ($1, $2::date, $3, $4, $5, $6)
           ON CONFLICT (building_id, day) DO UPDATE
           SET employee_expense = EXCLUDED.employee_expense,
               product_expense = EXCLUDED.product_expense,
               units_sold = EXCLUDED.units_sold,
               sale_price = EXCLUDED.sale_price`,
          [
            shop.id,
            state.day,
            financials.employeeExpense,
            financials.productExpense,
            financials.unitsSold,
            financials.salePrice,
          ],
        );
        salesDiagnostics.push({
          ownerId: shop.ownerId,
          type: 'commerce_diagnostics',
          buildingId: shop.id,
          day: state.day,
          transactions: salesPlan.transactionsByShop.get(shop.id) ?? [],
        });
      }
      await client.query('DELETE FROM commerce_history WHERE day < $1::date - 30', [state.day]);
      }
      });
      if (salesStageSucceeded) pendingCommerceDiagnostics.push(...salesDiagnostics);
      await runStage('produção', async () => {
      // Construções produtivas: demanda de Ferramentas, penalidade de eficiência e produção diária.
      for (const site of workplaces) {
        const definition = getResidenceDefinition(site.building_type);
        if (!definition?.production || site.status !== 'completed') continue;
        const count = workers.get(site.id) ?? 0;
        const { rows: stateRows } = await client.query<{
          stock: number;
          tool_stock: number;
          wood_stock: number;
          iron_stock: number;
          efficiency_penalty: number;
          production_progress: number;
        }>(
          `SELECT stock, tool_stock, wood_stock, iron_stock, efficiency_penalty, production_progress
           FROM residential_buildings WHERE id = $1`,
          [site.id],
        );
        const current = stateRows[0];
        if (!current) continue;
        const usesTools = Boolean(definition.toolCapacity);
        const demand = usesTools ? rollToolDemand(count, Math.random, definition.toolDemandPerWorker) : 0;
        const demandMet = current.tool_stock >= demand;
        const penalty = usesTools
          ? nextEfficiencyPenalty(current.efficiency_penalty, demandMet)
          : current.efficiency_penalty;
        const generatedPoints =
          count * getDailyWorkPoints(site.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness);
        const month = Number(state.day.slice(5, 7));
        const seasonalEfficiency =
          site.building_type === 'farm_dairy' ? getDairyFarmEfficiency(month) : 1;
        const result = planProduction(definition.production, {
          progress: current.production_progress,
          workPoints: generatedPoints * seasonalEfficiency,
          penalty,
          freeSpace: (definition.stockCapacity ?? 0) - current.stock,
          wood: current.wood_stock,
          iron: current.iron_stock,
        });
        await client.query(
          `UPDATE residential_buildings
           SET stock = stock + $2,
               production_progress = $3,
               tool_stock = tool_stock - $4,
               wood_stock = wood_stock - $6,
               iron_stock = iron_stock - $7,
               efficiency_penalty = $5
           WHERE id = $1`,
          [
            site.id,
            result.units,
            result.progress,
            usesTools && demandMet ? demand : 0,
            penalty,
            result.woodUsed,
            result.ironUsed,
          ],
        );
        changed = true;
        await logProduction(client, site.id, state.day, {
          workPoints: generatedPoints * seasonalEfficiency,
          produced: result.units,
          efficiency: (100 - penalty) * seasonalEfficiency,
        });
      }
      });
      await runStage('fazendas', async () => {
      // Fazendas de arroz: crescimento (produtividade pelos Work Points) e colheita.
      const { rows: farmRows } = await client.query<{
        id: string;
        work_hours_per_day: number;
        stock: number;
        crop_phase: Crop['phase'];
        crop_planted_day: string;
        crop_ratio_sum: number;
        crop_days: number;
        crop_yield: number;
        crop_harvested: number;
      }>(
        `SELECT id, work_hours_per_day, stock, crop_phase,
                to_char(crop_planted_day, 'YYYY-MM-DD') AS crop_planted_day,
                crop_ratio_sum, crop_days, crop_yield, crop_harvested
         FROM residential_buildings
         WHERE building_type = 'farm_rice' AND status = 'completed' AND crop_phase IS NOT NULL`,
      );
      for (const farm of farmRows) {
        const farmPoints =
          (workers.get(farm.id) ?? 0) *
          getDailyWorkPoints(farm.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness);
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
          const next = advanceGrowth(crop, state.day, farmPoints);
          await client.query(
            `UPDATE residential_buildings
             SET crop_phase = $2, crop_ratio_sum = $3, crop_days = $4, crop_yield = $5, crop_harvested = $6
             WHERE id = $1`,
            [farm.id, next.phase, next.ratioSum, next.days, next.yieldUnits, next.harvested],
          );
        } else {
          const capacity = RESIDENCES.farm_rice.stockCapacity ?? 0;
          const { units, done } = planHarvest(crop, farmPoints, Math.max(0, capacity - farm.stock));
          farmProduced = units;
          await client.query(
            `UPDATE residential_buildings
             SET stock = stock + $2,
                 crop_phase = CASE WHEN $3::boolean THEN NULL ELSE crop_phase END,
                 crop_planted_day = CASE WHEN $3::boolean THEN NULL ELSE crop_planted_day END,
                 crop_ratio_sum = CASE WHEN $3::boolean THEN 0 ELSE crop_ratio_sum END,
                 crop_days = CASE WHEN $3::boolean THEN 0 ELSE crop_days END,
                 crop_yield = CASE WHEN $3::boolean THEN 0 ELSE crop_yield END,
                 crop_harvested = CASE WHEN $3::boolean THEN 0 ELSE crop_harvested + $2 END
             WHERE id = $1`,
            [farm.id, units, done],
          );
        }
        await logProduction(client, farm.id, state.day, {
          workPoints: farmPoints,
          produced: farmProduced,
          efficiency: getDailyWorkRatio(farmPoints) * 100,
        });
        changed = true;
      }
      });
      await runStage('transporte', async () => {
      // Transporte entre armazéns e construções ligadas; consome Work Points do armazém.
      const { rows: warehouseRows } = await client.query<{
        id: string;
        tile_x: number;
        tile_y: number;
        building_type: ResidenceType;
      }>(
        `SELECT id, tile_x, tile_y, building_type FROM residential_buildings
         WHERE building_type = 'warehouse' AND status = 'completed'`,
      );
      for (const warehouse of warehouseRows) {
        let transportPhase = 'loading_linked_buildings';
        const warehouseSiteForLog = workplaces.find((row) => row.id === warehouse.id);
        await logProduction(client, warehouse.id, state.day, {
          workPoints:
            (workers.get(warehouse.id) ?? 0) *
            getDailyWorkPoints(
              warehouseSiteForLog?.work_hours_per_day ?? 8,
              RESIDENCE_STATS.health,
              RESIDENCE_STATS.happiness,
            ),
        });
        // Uma falha em um armazém não pode desfazer o histórico nem o transporte dos demais.
        await client.query('SAVEPOINT warehouse_transport');
        try {
        const { rows: linked } = await client.query<{
          id: string;
          building_type: ResidenceType;
          stock: number;
          tool_stock: number;
          wood_stock: number;
          iron_stock: number;
        }>(
          `SELECT id, building_type, stock, tool_stock, wood_stock, iron_stock FROM residential_buildings
           WHERE warehouse_id = $1 AND status = 'completed'`,
          [warehouse.id],
        );
        transportPhase = 'loading_stock';
        const warehouseSite = workplaces.find((row) => row.id === warehouse.id);
        const workPoints =
          (workers.get(warehouse.id) ?? 0) *
          getDailyWorkPoints(
            warehouseSite?.work_hours_per_day ?? 8,
            RESIDENCE_STATS.health,
            RESIDENCE_STATS.happiness,
          );
        if (linked.length === 0) {
          await client.query('RELEASE SAVEPOINT warehouse_transport');
          continue;
        }
        const { rows: stockRows } = await client.query<{ product_id: string; quantity: number }>(
          'SELECT product_id, quantity FROM warehouse_stock WHERE building_id = $1',
          [warehouse.id],
        );
        const { rows: settingRows } = await client.query<{
          product_id: string;
          minimum_stock: number;
          maximum_stock: number | null;
        }>(
          'SELECT product_id, minimum_stock, maximum_stock FROM warehouse_product_settings WHERE building_id = $1',
          [warehouse.id],
        );
        const types = new Map(linked.map((row) => [row.id, row.building_type]));
        transportPhase = 'planning_transfers';
        const { transfers, attempts } = planTransfersDetailed(
          {
            stock: new Map(stockRows.map((row) => [row.product_id, row.quantity])),
            minimumStock: new Map(settingRows.map((row) => [row.product_id, row.minimum_stock])),
            maximumStock: new Map(settingRows.map((row) => [row.product_id, row.maximum_stock])),
            capacityM3: RESIDENCES.warehouse.storageCapacityM3 ?? 0,
            workPoints,
          },
          linked.map((row) => ({
            buildingId: row.id,
            type: row.building_type,
            stock: row.stock,
            toolStock: row.tool_stock,
            woodStock: row.wood_stock,
            ironStock: row.iron_stock,
          })),
        );
        transportPhase = 'writing_attempts';
        await client.query('SAVEPOINT transport_log');
        try {
          for (const attempt of attempts) {
            await client.query(
              `INSERT INTO warehouse_transport_log
                 (warehouse_id, day, linked_id, linked_type, product_id, direction, wanted, moved, reason)
               VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)`,
              [
                warehouse.id,
                state.day,
                attempt.buildingId,
                types.get(attempt.buildingId) ?? '',
                attempt.productId,
                attempt.direction,
                attempt.wanted,
                attempt.moved,
                attempt.reason,
              ],
            );
          }
          await client.query(
            `DELETE FROM warehouse_transport_log WHERE warehouse_id = $1 AND day < $2::date - 30`,
            [warehouse.id, state.day],
          );
          await client.query('RELEASE SAVEPOINT transport_log');
        } catch (logError) {
          await client.query('ROLLBACK TO SAVEPOINT transport_log');
          console.error('Não foi possível gravar o histórico do armazém:', logError);
        }
        transportPhase = 'applying_transfers';
        for (const transfer of transfers) {
          if (transfer.direction === 'out') {
            await client.query(
              `INSERT INTO warehouse_stock (building_id, product_id, quantity) VALUES ($1, $2, $3)
               ON CONFLICT (building_id, product_id) DO UPDATE
               SET quantity = warehouse_stock.quantity + EXCLUDED.quantity`,
              [warehouse.id, transfer.productId, transfer.quantity],
            );
          } else {
            const result = await client.query(
              `UPDATE warehouse_stock
               SET quantity = quantity - $3
               WHERE building_id = $1 AND product_id = $2 AND quantity >= $3`,
              [warehouse.id, transfer.productId, transfer.quantity],
            );
            if (result.rowCount !== 1) {
              throw new Error(
                `Estoque insuficiente no armazém ${warehouse.id} para ${transfer.productId}: ${transfer.quantity}.`,
              );
            }
          }
          const kind = getResidenceDefinition(types.get(transfer.buildingId) ?? '')?.kind;
          // 'in' em comércios repõe o estoque principal; nas demais construções é um insumo.
          const column =
            transfer.direction === 'out' || kind === 'shop'
              ? 'stock'
              : ({ tools: 'tool_stock', wood: 'wood_stock', iron: 'iron_stock' } as Record<string, string>)[
                  transfer.productId
                ];
          if (!column) continue;
          await client.query(`UPDATE residential_buildings SET ${column} = ${column} + $2 WHERE id = $1`, [
            transfer.buildingId,
            transfer.direction === 'out' ? -transfer.quantity : transfer.quantity,
          ]);
          if (transfer.direction === 'out') {
            await logProduction(client, transfer.buildingId, state.day, { transported: transfer.quantity });
          }
          changed = true;
        }
        transportPhase = 'recording_daily_demand';
        await logWarehouseDemand(
          client,
          warehouse.id,
          state.day,
          transfers.reduce((sum, item) => sum + getTransportDemand(item.productId, item.quantity), 0),
        );
        await client.query('RELEASE SAVEPOINT warehouse_transport');
        } catch (transportError) {
          await client.query('ROLLBACK TO SAVEPOINT warehouse_transport');
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
            `${transportPhase}: ${errorMessage}${errorMetadata.length ? ` (${errorMetadata.join('; ')})` : ''}`.slice(
              0,
              1000,
            );
          console.error(`Falha no transporte do armazém ${warehouse.id} (${transportPhase}):`, transportError);
          await client.query('SAVEPOINT transport_error_log');
          try {
            await client.query(
              `INSERT INTO warehouse_transport_log
                 (warehouse_id, day, linked_id, linked_type, product_id, direction, wanted, moved, reason, error_detail)
               VALUES ($1, $2::date, $1, 'system', '', 'out', 0, 0, 'error', $3)`,
              [warehouse.id, state.day, errorDetail],
            );
            await client.query('RELEASE SAVEPOINT transport_error_log');
          } catch (logError) {
            await client.query('ROLLBACK TO SAVEPOINT transport_error_log');
            console.error('Não foi possível registrar o erro do armazém:', logError);
          }
          await client.query('RELEASE SAVEPOINT warehouse_transport');
        }
      }
      });
      } catch (economyError) {
        await client.query('ROLLBACK TO SAVEPOINT daily_economy');
        console.error('Falha na economia diária (folha e obras foram preservadas):', economyError);
      }
      await client.query('UPDATE world_state SET last_payroll_day = $1 WHERE id = 1', [state.day]);
    }

    if (state.hour >= 18 && (state.last_spoilage === null || state.last_spoilage < state.day)) {
      await client.query('SAVEPOINT inventory_spoilage');
      try {
        const spoiled = await applyDailySpoilage(client);
        await client.query('UPDATE world_state SET last_spoilage_day = $1::date WHERE id = 1', [state.day]);
        await client.query('RELEASE SAVEPOINT inventory_spoilage');
        if (spoiled) changed = true;
      } catch (spoilageError) {
        await client.query('ROLLBACK TO SAVEPOINT inventory_spoilage');
        console.error(`Falha na deterioração diária do estoque (${state.day}):`, spoilageError);
      }
    }

    if (state.hour >= 12 && (state.last_alloc === null || state.last_alloc < state.day)) {
      const { rows } = await client.query<ResidentialBuildingRow>(
        `SELECT ${RESIDENTIAL_COLUMNS} FROM residential_buildings`,
      );
      const buildings = rows.map(mapResidentialBuilding);
      const residences = buildings.filter(
        (building) =>
          building.status === 'completed' &&
          getResidenceDefinition(building.type)?.kind === 'residence' &&
          building.occupants > 0,
      );
      const workplaces = buildings.filter(
        (building) =>
          building.desiredWorkers > 0 &&
          (getResidenceDefinition(building.type)?.kind !== 'residence' ||
            building.status === 'under_construction'),
      );
      const assignments: JobAssignment[] = allocateWorkers(residences, workplaces);
      await client.query('DELETE FROM job_assignments');
      for (const assignment of assignments) {
        await client.query(
          'INSERT INTO job_assignments (workplace_id, residence_id, count) VALUES ($1, $2, $3)',
          [assignment.workplaceId, assignment.residenceId, assignment.count],
        );
      }
      await client.query('UPDATE world_state SET last_job_allocation_day = $1 WHERE id = 1', [state.day]);
      changed = true;
    }

    // Às 03:00 e 15:00 os armazéns compram de armazéns de outros donos em até 60 tiles.
    const tradeSlot = state.hour >= 15 ? `${state.day}T15` : state.hour >= 3 ? `${state.day}T03` : null;
    if (tradeSlot && (state.last_trade === null || state.last_trade < tradeSlot)) {
      const { rows: warehouseRows } = await client.query<WarehouseTradeBuildingRow>(
        `SELECT b.id, b.created_by, b.building_type, b.tile_x, b.tile_y, b.work_hours_per_day,
                COALESCE((SELECT SUM(count) FROM job_assignments j WHERE j.workplace_id = b.id), 0)::int AS workers
         FROM residential_buildings b
         WHERE b.building_type = 'warehouse' AND b.status = 'completed'`,
      );
      const { rows: stockRows } = await client.query<WarehouseTradeStockRow>(
        'SELECT building_id, product_id, quantity FROM warehouse_stock',
      );
      const { rows: settingRows } = await client.query<WarehouseTradeSettingRow>(
        'SELECT building_id, product_id, minimum_stock, maximum_stock, price, mode FROM warehouse_product_settings',
      );
      const tradeWarehouses = mapWarehouseTradeWarehouses(warehouseRows, stockRows, settingRows);
      const ownerOf = new Map(warehouseRows.map((row) => [row.id, row.created_by]));
      const trades = planWarehouseTrades(tradeWarehouses);
      await applyWarehouseTrades(client, trades, ownerOf, state.day);
      if (trades.length > 0) changed = true;
      await client.query('UPDATE world_state SET last_warehouse_trade_slot = $1 WHERE id = 1', [tradeSlot]);
    }

    await client.query('COMMIT');
    for (const { ownerId, ...diagnostics } of pendingCommerceDiagnostics) {
      await redis
        .publish(
          COMMERCE_DIAGNOSTICS_CHANNEL,
          JSON.stringify({ ownerId, ...diagnostics }),
        )
        .catch((error: unknown) => {
          console.error(
            `Não foi possível enviar o cálculo da demanda da loja ${diagnostics.buildingId} ao navegador:`,
            error,
          );
        });
    }
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
  await pool.query(
    `UPDATE world_state
     SET world_time = world_time
           + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - last_real_at)))
             * time_scale * INTERVAL '1 second',
         last_real_at = clock_timestamp()
     WHERE id = 1`,
  );
  const employmentChanged = await runDailyEmployment();
  if ((await runDailyImmigration()) || employmentChanged) {
    await publishCities().catch((error: unknown) => {
      console.error('A atualização diária foi aplicada, mas a atualização do mundo falhou:', error);
    });
  }
  await publishSnapshot();
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
      `SELECT ${RESIDENTIAL_COLUMNS}
       FROM residential_buildings`,
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
      population: number;
      wellbeing: number;
      economy: number;
    }>(
      `INSERT INTO city_assemblies (id, name, center_x, center_y, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, center_x, center_y, population, wellbeing, economy`,
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
        population: row.population,
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
      population: number;
      wellbeing: number;
      economy: number;
    }>(
      `SELECT id, name, center_x, center_y,
              COALESCE((
                SELECT SUM(home.occupants)::integer
                FROM residential_buildings AS home
                WHERE home.city_id = city_assemblies.id
              ), 0) AS population,
              wellbeing, economy
       FROM city_assemblies WHERE id = $1 FOR UPDATE`,
      [cityId],
    );
    const cityRow = rows[0];
    if (!cityRow) {
      await client.query('ROLLBACK');
      return { city: null, error: 'city_not_found' };
    }

    const normalizedZones: CityZone[] = [];
    for (const zone of zones) {
      const placementError = getCityZonePlacementError(
        zone,
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
        population: cityRow.population,
        wellbeing: cityRow.wellbeing,
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
  error: ResidencePlacementError | 'insufficient_materials' | 'warehouse_already_claimed' | null;
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
           SELECT 1 FROM residential_buildings WHERE building_type = 'warehouse' AND created_by = $1
         ) AS has_warehouse`,
        [userId],
      );
      isFirstWarehouse = !warehouseRows[0]?.has_warehouse;
      if (!isMaster && !isFirstWarehouse) {
        await client.query('ROLLBACK');
        return { building: null, error: 'warehouse_already_claimed' };
      }
    } else if (!isMaster) {
      await client.query('ROLLBACK');
      return { building: null, error: 'insufficient_materials' };
    }

    const { rows: cityRows } = await client.query<{
      id: string;
      name: string;
      center_x: number;
      center_y: number;
      population: number;
      wellbeing: number;
      economy: number;
      zones: CityZone[];
    }>(
      `SELECT city.id, city.name, city.center_x, city.center_y,
              city.population, city.wellbeing, city.economy,
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
    const cities: CityAssembly[] = cityRows.map((city) => ({
      id: city.id,
      name: city.name,
      centerX: city.center_x,
      centerY: city.center_y,
      population: city.population,
      wellbeing: city.wellbeing,
      economy: city.economy,
      zones: city.zones,
    }));
    const { rows: buildingRows } = await client.query<ResidentialBuildingRow>(
      `SELECT ${RESIDENTIAL_COLUMNS}
       FROM residential_buildings`,
    );
    const buildings = buildingRows.map(mapResidentialBuilding);
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

    if (type === 'warehouse') {
      await client.query(
        'INSERT INTO player_warehouse_claims (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId],
      );
    }

    const { rows } = await client.query<ResidentialBuildingRow>(
      `INSERT INTO residential_buildings
         (id, building_type, tile_x, tile_y, city_id, status, completed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'completed' THEN clock_timestamp() ELSE NULL END, $7)
       RETURNING ${RESIDENTIAL_COLUMNS}`,
      [
        randomUUID(),
        type,
        position.x,
        position.y,
        city.id,
        isFirstWarehouse ? 'completed' : 'under_construction',
        userId,
      ],
    );
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
    const { rows } = await client.query<ResidentialBuildingRow>(
      `UPDATE residential_buildings
       SET status = 'completed', completed_at = clock_timestamp()
       WHERE id = $1 AND status = 'under_construction'
       RETURNING ${RESIDENTIAL_COLUMNS}`,
      [id],
    );
    if (!rows[0]) {
      const existing = await client.query(
        'SELECT 1 FROM residential_buildings WHERE id = $1',
        [id],
      );
      await client.query('COMMIT');
      return {
        building: null,
        error: existing.rowCount ? 'building_already_complete' : 'building_not_found',
      };
    }
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
  await Promise.all([
    subscriber.subscribe(SNAPSHOT_CHANNEL, (message) => broadcast(message)),
    subscriber.subscribe(CITIES_CHANNEL, (message) => broadcast(message)),
    subscriber.subscribe(COMMERCE_DIAGNOSTICS_CHANNEL, deliverCommerceDiagnostics),
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
        pool.query<{ balance: string }>(
          'SELECT balance FROM player_wallets WHERE user_id = $1',
          [userId],
        ),
      )
      .then(({ rows }) => response.json({ balance: Number(rows[0].balance) }))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar a carteira:', error);
        response.status(503).json({ error: 'wallet_unavailable' });
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
      .query<{ wood: number; stone: number }>(
        `SELECT
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'wood'), 0)::int AS wood,
           COALESCE(SUM(stock.quantity) FILTER (WHERE stock.product_id = 'stone'), 0)::int AS stone
         FROM residential_buildings AS warehouse
         LEFT JOIN warehouse_stock AS stock ON stock.building_id = warehouse.id
         WHERE warehouse.building_type = 'warehouse'
           AND warehouse.status = 'completed'
           AND warehouse.created_by = $1
           AND POWER(warehouse.tile_x + $4 - $2, 2)
             + POWER(warehouse.tile_y + $4 - $3, 2) <= 3600`,
        [userId, x, y, RESIDENCES.warehouse.width / 2],
      )
      .then(({ rows }) => response.json({ wood: rows[0].wood, stone: rows[0].stone }))
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
      const { rows: cityRows } = await pool.query<{ population: number }>(
        `SELECT COALESCE(SUM(building.occupants), 0)::int AS population
         FROM city_assemblies city
         LEFT JOIN residential_buildings building ON building.city_id = city.id
         WHERE city.id = $1
         GROUP BY city.id`,
        [request.params.id],
      );
      if (!cityRows[0]) {
        response.status(404).json({ error: 'city_not_found' });
        return;
      }

      const { rows } = await pool.query<{
        product_id: string;
        last_quantity: number;
        last_spent: number;
        month_quantity: number;
        month_spent: number;
      }>(
        `WITH today AS (
           SELECT (world_time AT TIME ZONE 'UTC')::date AS day
           FROM world_state WHERE id = 1
         )
         SELECT consumption.product_id,
                COALESCE(SUM(consumption.quantity)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_quantity,
                COALESCE(SUM(consumption.spent)
                  FILTER (WHERE consumption.day = (SELECT day FROM today)), 0)::float8 AS last_spent,
                COALESCE(SUM(consumption.quantity), 0)::float8 AS month_quantity,
                COALESCE(SUM(consumption.spent), 0)::float8 AS month_spent
         FROM residence_consumption consumption
         JOIN residential_buildings building ON building.id = consumption.building_id
         WHERE building.city_id = $1
           AND consumption.day > (SELECT day FROM today) - 30
         GROUP BY consumption.product_id`,
        [request.params.id],
      );
      const population = cityRows[0].population;
      response.json({
        products: rows.map((row) => ({
          productId: row.product_id,
          lastDayPerPerson: population > 0 ? row.last_quantity / population : 0,
          monthPerPerson: population > 0 ? row.month_quantity / population / 30 : 0,
          lastDayAveragePrice: row.last_quantity > 0 ? row.last_spent / row.last_quantity : null,
          monthAveragePrice: row.month_quantity > 0 ? row.month_spent / row.month_quantity : null,
        })),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar o consumo da cidade:', error);
      response.status(503).json({ error: 'city_unavailable' });
    });
  });
  app.post('/api/residential-buildings', requireAuth, (request, response) => {
    const userId = authenticatedUserIds.get(request);
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    const definition = getResidenceDefinition(request.body?.type);
    const x = request.body?.x;
    const y = request.body?.y;
    if (
      !definition ||
      typeof x !== 'number' ||
      !Number.isInteger(x) ||
      typeof y !== 'number' ||
      !Number.isInteger(y)
    ) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }

    void isMasterUser(userId)
      .then((isMaster) => {
        if (!canStartResidenceConstruction(definition.type, isMaster)) {
          response.status(409).json({ error: 'insufficient_materials' });
          return;
        }
        return createResidentialBuilding(definition.type, { x, y }, userId, isMaster)
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
        console.error('Não foi possível verificar os materiais disponíveis:', error);
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
        'SELECT created_by FROM residential_buildings WHERE id = $1',
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
        'SELECT created_by FROM residential_buildings WHERE id = $1 AND building_type = $2',
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
        `SELECT created_by FROM residential_buildings
         WHERE id = $1 AND building_type IN ('shop_rice', 'shop_fish', 'shop_milk')`,
        [request.params.id],
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
        sale_price: number;
      }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                employee_expense, product_expense, units_sold, sale_price
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
            salePrice: row.sale_price,
            revenue,
            profitLoss,
            transactions: null,
          };
        }),
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível consultar o histórico do comércio:', error);
      response.status(503).json({ error: 'residence_unavailable' });
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
        last_per_person: number;
        month_quantity: number;
        month_spent: number;
        month_per_person: number;
      }>(
        `WITH today AS (SELECT (world_time AT TIME ZONE 'UTC')::date AS day FROM world_state WHERE id = 1)
         SELECT product_id,
                COALESCE(SUM(quantity) FILTER (WHERE day = (SELECT day FROM today)), 0) AS last_quantity,
                COALESCE(SUM(spent) FILTER (WHERE day = (SELECT day FROM today)), 0) AS last_spent,
                COALESCE(SUM(quantity / NULLIF(occupants, 0)) FILTER (WHERE day = (SELECT day FROM today)), 0) AS last_per_person,
                COALESCE(SUM(quantity), 0) AS month_quantity,
                COALESCE(SUM(spent), 0) AS month_spent,
                COALESCE(SUM(quantity / NULLIF(occupants, 0)), 0) / 30 AS month_per_person
         FROM residence_consumption
         WHERE building_id = $1 AND day > (SELECT day FROM today) - 30
         GROUP BY product_id`,
        [request.params.id],
      )
      .then(({ rows }) => {
        response.json({
          products: rows.map((row) => ({
            productId: row.product_id,
            lastDayPerPerson: row.last_per_person,
            monthPerPerson: row.month_per_person,
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
  app.get('/api/residential-buildings/:id/warehouse', requireAuth, (request, response) => {
    if (!residenceIdPattern.test(request.params.id)) {
      response.status(400).json({ error: 'invalid_residence' });
      return;
    }

    void pool
      .query<{ building_type: string; tile_x: number; tile_y: number }>(
        'SELECT building_type, tile_x, tile_y FROM residential_buildings WHERE id = $1',
        [request.params.id],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (rows[0].building_type !== 'warehouse') {
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
           FROM residential_buildings AS seller
           JOIN warehouse_product_settings AS setting ON setting.building_id = seller.id
           LEFT JOIN warehouse_stock AS stock
             ON stock.building_id = seller.id AND stock.product_id = setting.product_id
           WHERE seller.building_type = 'warehouse'
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
           FROM residential_buildings b WHERE b.id = $1`,
          [request.params.id],
        );
        const target = targetRows[0];
        if (!target || target.building_type !== 'warehouse') {
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
           FROM residential_buildings b
           WHERE b.building_type = 'warehouse' AND b.status = 'completed'
             AND (b.id = $1 OR (ABS(b.tile_x - $2) <= 60 AND ABS(b.tile_y - $3) <= 60))`,
          [target.id, target.tile_x, target.tile_y],
        );
        const warehouseIds = warehouseRows.map((row) => row.id);
        const { rows: stockRows } = await client.query<WarehouseTradeStockRow>(
          'SELECT building_id, product_id, quantity FROM warehouse_stock WHERE building_id = ANY($1::uuid[])',
          [warehouseIds],
        );
        const { rows: settingRows } = await client.query<WarehouseTradeSettingRow>(
          'SELECT building_id, product_id, minimum_stock, maximum_stock, price, mode FROM warehouse_product_settings WHERE building_id = ANY($1::uuid[])',
          [warehouseIds],
        );
        const tradeWarehouses = mapWarehouseTradeWarehouses(warehouseRows, stockRows, settingRows);
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
        'SELECT building_type, created_by, status FROM residential_buildings WHERE id = $1',
        [request.params.id],
      )
      .then(async ({ rows }) => {
        const building = rows[0];
        if (!building) {
          response.status(404).json({ error: 'residence_not_found' });
          return;
        }
        if (building.building_type !== 'warehouse' || building.status !== 'completed') {
          response.status(400).json({ error: 'not_a_warehouse' });
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
        const { rows: typeRows } = await client.query<{ building_type: string }>(
          'SELECT building_type FROM residential_buildings WHERE id = $1',
          [request.params.id],
        );
        const definition = getResidenceDefinition(typeRows[0]?.building_type ?? '');
        if (definition && settings.desiredWorkers > definition.maxWorkers) {
          response.status(400).json({ error: 'invalid_work_settings' });
          return;
        }
        await client.query('BEGIN');
        const { rows } = await client.query<ResidentialBuildingRow>(
          `UPDATE residential_buildings
           SET wage = $3, work_hours_per_day = $4, desired_workers = $5
           WHERE id = $1 AND created_by = $2
             AND (status = 'under_construction' OR building_type NOT IN ('house_poor1', 'house_poor2'))
           RETURNING ${RESIDENTIAL_COLUMNS}`,
          [
            request.params.id,
            userId,
            settings.wage,
            settings.workHoursPerDay,
            settings.desiredWorkers,
          ],
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          const { rows: existing } = await pool.query<{ created_by: string }>(
            'SELECT created_by FROM residential_buildings WHERE id = $1',
            [request.params.id],
          );
          if (!existing[0]) {
            response.status(404).json({ error: 'residence_not_found' });
          } else if (existing[0].created_by !== userId) {
            response.status(403).json({ error: 'residence_not_owned' });
          } else {
            response.status(400).json({ error: 'invalid_work_settings' });
          }
          return;
        }

        // Reduz os empregados quando o novo limite desejado é menor que o atual.
        const { rows: jobs } = await client.query<{ residence_id: string; count: number }>(
          'SELECT residence_id, count FROM job_assignments WHERE workplace_id = $1 ORDER BY residence_id',
          [request.params.id],
        );
        let remaining = settings.desiredWorkers;
        for (const job of jobs) {
          const kept = Math.min(job.count, remaining);
          remaining -= kept;
          if (kept === job.count) continue;
          if (kept === 0) {
            await client.query(
              'DELETE FROM job_assignments WHERE workplace_id = $1 AND residence_id = $2',
              [request.params.id, job.residence_id],
            );
          } else {
            await client.query(
              'UPDATE job_assignments SET count = $3 WHERE workplace_id = $1 AND residence_id = $2',
              [request.params.id, job.residence_id, kept],
            );
          }
        }
        const { rows: updated } = await client.query<ResidentialBuildingRow>(
          `SELECT ${RESIDENTIAL_COLUMNS} FROM residential_buildings WHERE id = $1`,
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

    void pool
      .query<ResidentialBuildingRow>(
        `UPDATE residential_buildings
         SET rent = $3
         WHERE id = $1 AND created_by = $2 AND building_type IN ('house_poor1', 'house_poor2')
         RETURNING ${RESIDENTIAL_COLUMNS}`,
        [request.params.id, userId, rent],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query(
            'SELECT 1 FROM residential_buildings WHERE id = $1',
            [request.params.id],
          );
          response
            .status(existing.rowCount ? 403 : 404)
            .json({ error: existing.rowCount ? 'residence_not_owned' : 'residence_not_found' });
          return;
        }

        response.json(mapResidentialBuilding(rows[0]));
        void publishCities().catch((error: unknown) => {
          console.error('O aluguel foi atualizado, mas a atualização do mundo falhou:', error);
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível atualizar o aluguel:', error);
        response.status(503).json({ error: 'residence_unavailable' });
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
        `UPDATE residential_buildings
         SET price = $3
         WHERE id = $1 AND created_by = $2 AND building_type IN ('shop_rice', 'shop_fish', 'shop_milk')
         RETURNING ${RESIDENTIAL_COLUMNS}`,
        [request.params.id, userId, price],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query('SELECT 1 FROM residential_buildings WHERE id = $1', [
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

    // Plantar ou replantar durante o crescimento zera o contador; durante a colheita não é permitido.
    void pool
      .query<ResidentialBuildingRow>(
        `UPDATE residential_buildings
         SET crop_phase = 'growing',
             crop_planted_day = (SELECT (world_time AT TIME ZONE 'UTC')::date FROM world_state WHERE id = 1),
             crop_ratio_sum = 0, crop_days = 0, crop_yield = 0, crop_harvested = 0
         WHERE id = $1 AND created_by = $2 AND building_type = 'farm_rice' AND status = 'completed'
           AND (crop_phase IS NULL OR crop_phase = 'growing')
         RETURNING ${RESIDENTIAL_COLUMNS}`,
        [request.params.id, userId],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const { rows: existing } = await pool.query<{
            created_by: string;
            building_type: string;
            status: string;
          }>('SELECT created_by, building_type, status FROM residential_buildings WHERE id = $1', [
            request.params.id,
          ]);
          if (!existing[0]) {
            response.status(404).json({ error: 'residence_not_found' });
          } else if (existing[0].created_by !== userId) {
            response.status(403).json({ error: 'residence_not_owned' });
          } else if (existing[0].building_type !== 'farm_rice' || existing[0].status !== 'completed') {
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
      (link.warehouseId !== null && !residenceIdPattern.test(link.warehouseId))
    ) {
      response.status(400).json({ error: 'invalid_warehouse_link' });
      return;
    }
    if (!userId) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }

    void (async () => {
      const { rows: sources } = await pool.query<{
        building_type: ResidenceType;
        status: string;
        created_by: string;
        tile_x: number;
        tile_y: number;
      }>(
        'SELECT building_type, status, created_by, tile_x, tile_y FROM residential_buildings WHERE id = $1',
        [request.params.id],
      );
      const source = sources[0];
      if (!source) {
        response.status(404).json({ error: 'residence_not_found' });
        return;
      }
      if (source.created_by !== userId) {
        response.status(403).json({ error: 'residence_not_owned' });
        return;
      }
      if (!canLinkToWarehouse(source.building_type) || source.status !== 'completed') {
        response.status(400).json({ error: 'invalid_warehouse_link' });
        return;
      }
      if (link.warehouseId !== null) {
        const { rows: targets } = await pool.query<{
          building_type: ResidenceType;
          status: string;
          created_by: string;
          tile_x: number;
          tile_y: number;
        }>(
          'SELECT building_type, status, created_by, tile_x, tile_y FROM residential_buildings WHERE id = $1',
          [link.warehouseId],
        );
        const target = targets[0];
        if (!target || target.building_type !== 'warehouse' || target.status !== 'completed') {
          response.status(400).json({ error: 'invalid_warehouse_link' });
          return;
        }
        if (target.created_by !== userId) {
          response.status(403).json({ error: 'warehouse_not_owned' });
          return;
        }
        if (
          !isWithinLinkRadius(
            { type: source.building_type, x: source.tile_x, y: source.tile_y },
            { type: target.building_type, x: target.tile_x, y: target.tile_y },
          )
        ) {
          response.status(400).json({ error: 'warehouse_out_of_range' });
          return;
        }
      }
      const { rows } = await pool.query<ResidentialBuildingRow>(
        `UPDATE residential_buildings SET warehouse_id = $2 WHERE id = $1
         RETURNING ${RESIDENTIAL_COLUMNS}`,
        [request.params.id, link.warehouseId],
      );
      response.json(mapResidentialBuilding(rows[0]));
      void publishCities().catch((error: unknown) => {
        console.error('O vínculo foi atualizado, mas a atualização do mundo falhou:', error);
      });
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
        `DELETE FROM residential_buildings
         WHERE id = $1 AND created_by = $2
         RETURNING id`,
        [request.params.id, userId],
      )
      .then(async ({ rows }) => {
        if (!rows[0]) {
          const existing = await pool.query(
            'SELECT 1 FROM residential_buildings WHERE id = $1',
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
      .query<{ balance: string }>(
        `INSERT INTO player_wallets (user_id, balance) VALUES ($1, $2::bigint + $3::bigint)
         ON CONFLICT (user_id) DO UPDATE SET balance = player_wallets.balance + $3::bigint
         RETURNING balance`,
        [userId, STARTING_BALANCE, amount],
      )
      .then(({ rows }) => response.json({ balance: Number(rows[0].balance) }))
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
        websocketServer.emit('connection', websocket, request);
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível autenticar a conexão WebSocket:', error);
      rejectWebSocketUpgrade(socket, 503);
    });
  });

  websocketServer.on('connection', (websocket) => {
    clients.add(websocket);
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
        websocket.send(JSON.stringify(await getSnapshot()));
            const [cities, roads, buildings] = await Promise.all([
              getCities(),
              getRoadTiles(),
              getResidentialBuildings(),
            ]);
            websocket.send(JSON.stringify({ type: 'cities', cities, roads, buildings }));
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
    websocketServer.close();
    server.close(() => {
      void Promise.all([redis.quit(), subscriber.quit(), pool.end()]).then(() => {
        process.exit(0);
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
