import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import express, { type RequestHandler } from 'express';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { Pool } from 'pg';
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
  parseRent,
  parseWorkSettings,
  RESIDENCES,
  RESIDENCE_STATS,
  type ResidentialBuilding,
  type ResidenceType,
  type ResidencePlacementError,
} from '../src/types/residence.js';
import { STARTING_BALANCE } from '../src/types/wallet.js';
import { allocateWorkers, getDailyWorkPoints, getPayroll, type JobAssignment } from '../src/types/employment.js';
import { getShopSalesCapacity, parsePrice, planRiceSales } from '../src/types/commerce.js';
import {
  canLinkToWarehouse,
  getTransportDemand,
  isWithinLinkRadius,
  parseWarehouseLink,
  planTransfers,
  planWarehouseTrades,
} from '../src/types/logistics.js';
import {
  advanceGrowth,
  planHarvest,
  type Crop,
} from '../src/types/farming.js';
import { parseWarehouseSetting } from '../src/types/warehouse.js';
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
const TIME_SCALE = 15;
const MAP = {
  width: WORLD_CONFIG.width,
  height: WORLD_CONFIG.height,
  seed: WORLD_CONFIG.seed,
};
const mapGenerator = createMapGenerator(WORLD_CONFIG, DEFAULT_TILE_LIST);
const landTileIds = new Set(
  DEFAULT_TILE_LIST.filter((tile) => tile.category === 'land').map((tile) => tile.id),
);
const CLOCK_LEADER_KEY = 'valdora:clock:leader';
const PRESENCE_KEY = 'valdora:presence';
const SNAPSHOT_CHANNEL = 'valdora:world:snapshots';
const CITIES_CHANNEL = 'valdora:world:cities';
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
  crop_phase: Crop['phase'] | null;
  crop_planted_day: string | null;
  crop_ratio_sum: number;
  crop_days: number;
  crop_yield: number;
  crop_harvested: number;
  employed: number;
};

const RESIDENTIAL_COLUMNS = `id, building_type, tile_x, tile_y, city_id, status, started_at, completed_at, wage, work_hours_per_day, rent, occupants, desired_workers, work_points_done, price, stock, warehouse_id,
  crop_phase, to_char(crop_planted_day, 'YYYY-MM-DD') AS crop_planted_day, crop_ratio_sum, crop_days,
  crop_yield, crop_harvested,
  (SELECT COALESCE(SUM(j.count), 0)::int FROM job_assignments j
   WHERE j.workplace_id = residential_buildings.id OR j.residence_id = residential_buildings.id) AS employed`;

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
  };
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
           * $1 * INTERVAL '1 second' AS world_time,
         clock_timestamp() AS server_time
       FROM world_state
       WHERE id = 1`,
      [TIME_SCALE],
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
    timeScale: TIME_SCALE,
    map: MAP,
    onlinePlayers: online,
  };
}

function broadcast(payload: string) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

async function publishSnapshot() {
  const snapshot = await getSnapshot();
  await redis.publish(SNAPSHOT_CHANNEL, JSON.stringify(snapshot));
}

async function getCities(): Promise<CityAssembly[]> {
  const { rows } = await pool.query<{
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
  );
  return rows.map((row) => ({
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

// Às 12:00 distribui os trabalhadores e às 00:00 cobra a folha de pagamento dos donos.
async function runDailyEmployment(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);
    const { rows: stateRows } = await client.query<{
      day: string;
      hour: number;
      last_alloc: string | null;
      last_payroll: string | null;
      last_trade: string | null;
    }>(
      `SELECT to_char(world_time AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              EXTRACT(HOUR FROM world_time AT TIME ZONE 'UTC')::int AS hour,
              to_char(last_job_allocation_day, 'YYYY-MM-DD') AS last_alloc,
              to_char(last_payroll_day, 'YYYY-MM-DD') AS last_payroll,
              last_warehouse_trade_slot AS last_trade
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
        `SELECT id, created_by, wage, status, building_type, work_hours_per_day, work_points_done,
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
        const total =
          site.work_points_done +
          count * getDailyWorkPoints(site.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness);
        const needed = RESIDENCES[site.building_type].workPoints;
        await client.query(
          `UPDATE residential_buildings
           SET work_points_done = LEAST($2::double precision, $3::double precision),
               status = CASE WHEN $2::double precision >= $3::double precision THEN 'completed' ELSE status END,
               completed_at = CASE WHEN $2::double precision >= $3::double precision
                                   THEN clock_timestamp() ELSE completed_at END
           WHERE id = $1`,
          [site.id, total, needed],
        );
        changed = true;
      }
      // Vendas de arroz: capacidade do dia vem dos Work Points gerados pela loja.
      const wageOf = new Map(workplaces.map((row) => [row.id, row.wage]));
      const incomeByResidence = new Map<string, number>();
      for (const row of assignmentRows) {
        incomeByResidence.set(
          row.residence_id,
          (incomeByResidence.get(row.residence_id) ?? 0) + row.count * (wageOf.get(row.workplace_id) ?? 0),
        );
      }
      const shops = workplaces
        .filter((row) => row.status === 'completed' && row.building_type === 'shop_rice')
        .map((row) => ({
          id: row.id,
          type: row.building_type,
          x: row.tile_x,
          y: row.tile_y,
          price: row.price,
          stock: row.stock,
          capacity: getShopSalesCapacity(
            (workers.get(row.id) ?? 0) *
              getDailyWorkPoints(row.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness),
          ),
        }));
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
          averageIncome: (incomeByResidence.get(row.id) ?? 0) / row.occupants,
        }));
      const sold = new Map<string, number>();
      const bought = new Map<string, { quantity: number; spent: number }>();
      const shopPrice = new Map(shops.map((shop) => [shop.id, shop.price]));
      for (const purchase of planRiceSales(homes, shops)) {
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
           VALUES ($1, 'rice', $2, $3, $4, $5)
           ON CONFLICT (building_id, product_id, day) DO UPDATE
           SET quantity = residence_consumption.quantity + $3,
               spent = residence_consumption.spent + $4,
               occupants = $5`,
          [home.id, state.day, total.quantity, total.spent, home.occupants],
        );
      }
      for (const shop of shops) {
        const quantity = sold.get(shop.id) ?? 0;
        if (quantity <= 0) continue;
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
        changed = true;
      }
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
        const { rows: linked } = await client.query<{ id: string; building_type: ResidenceType; stock: number }>(
          `SELECT id, building_type, stock FROM residential_buildings
           WHERE warehouse_id = $1 AND status = 'completed'`,
          [warehouse.id],
        );
        if (linked.length === 0) continue;
        const warehouseSite = workplaces.find((row) => row.id === warehouse.id);
        const workPoints =
          (workers.get(warehouse.id) ?? 0) *
          getDailyWorkPoints(
            warehouseSite?.work_hours_per_day ?? 8,
            RESIDENCE_STATS.health,
            RESIDENCE_STATS.happiness,
          );
        const { rows: stockRows } = await client.query<{ product_id: string; quantity: number }>(
          'SELECT product_id, quantity FROM warehouse_stock WHERE building_id = $1',
          [warehouse.id],
        );
        const { rows: desiredRows } = await client.query<{ product_id: string; desired_stock: number }>(
          'SELECT product_id, desired_stock FROM warehouse_product_settings WHERE building_id = $1',
          [warehouse.id],
        );
        const transfers = planTransfers(
          {
            stock: new Map(stockRows.map((row) => [row.product_id, row.quantity])),
            desired: new Map(desiredRows.map((row) => [row.product_id, row.desired_stock])),
            capacityM3: RESIDENCES.warehouse.storageCapacityM3 ?? 0,
            workPoints,
          },
          linked.map((row) => ({ buildingId: row.id, type: row.building_type, stock: row.stock })),
        );
        for (const transfer of transfers) {
          const delta = transfer.direction === 'out' ? transfer.quantity : -transfer.quantity;
          await client.query(
            `INSERT INTO warehouse_stock (building_id, product_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (building_id, product_id) DO UPDATE SET quantity = warehouse_stock.quantity + $3`,
            [warehouse.id, transfer.productId, delta],
          );
          await client.query('UPDATE residential_buildings SET stock = stock + $2 WHERE id = $1', [
            transfer.buildingId,
            -delta,
          ]);
          changed = true;
        }
        await logWarehouseDemand(
          client,
          warehouse.id,
          state.day,
          transfers.reduce((sum, item) => sum + getTransportDemand(item.productId, item.quantity), 0),
        );
      }
      await client.query('UPDATE world_state SET last_payroll_day = $1 WHERE id = 1', [state.day]);
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
      const { rows: warehouseRows } = await client.query<{
        id: string;
        created_by: string;
        building_type: ResidenceType;
        tile_x: number;
        tile_y: number;
        work_hours_per_day: number;
        workers: number;
      }>(
        `SELECT b.id, b.created_by, b.building_type, b.tile_x, b.tile_y, b.work_hours_per_day,
                COALESCE((SELECT SUM(count) FROM job_assignments j WHERE j.workplace_id = b.id), 0)::int AS workers
         FROM residential_buildings b
         WHERE b.building_type = 'warehouse' AND b.status = 'completed'`,
      );
      const { rows: stockRows } = await client.query<{ building_id: string; product_id: string; quantity: number }>(
        'SELECT building_id, product_id, quantity FROM warehouse_stock',
      );
      const { rows: settingRows } = await client.query<{
        building_id: string;
        product_id: string;
        desired_stock: number;
        price: number;
        mode: 'sell' | 'buy';
      }>('SELECT building_id, product_id, desired_stock, price, mode FROM warehouse_product_settings');
      const tradeWarehouses = warehouseRows.map((row) => {
        const stock = new Map<string, number>();
        for (const item of stockRows) {
          if (item.building_id === row.id) stock.set(item.product_id, item.quantity);
        }
        const settings = new Map<string, { desired: number; price: number; mode: 'sell' | 'buy' }>();
        for (const item of settingRows) {
          if (item.building_id === row.id) {
            settings.set(item.product_id, { desired: item.desired_stock, price: item.price, mode: item.mode });
          }
        }
        return {
          id: row.id,
          ownerId: row.created_by,
          type: row.building_type,
          x: row.tile_x,
          y: row.tile_y,
          capacityM3: RESIDENCES.warehouse.storageCapacityM3 ?? 0,
          // Cada rodada usa metade dos Work Points diários do armazém.
          workPoints:
            (row.workers *
              getDailyWorkPoints(row.work_hours_per_day, RESIDENCE_STATS.health, RESIDENCE_STATS.happiness)) /
            2,
          stock,
          settings,
        };
      });
      const ownerOf = new Map(warehouseRows.map((row) => [row.id, row.created_by]));
      for (const trade of planWarehouseTrades(tradeWarehouses)) {
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
        const buyer = ownerOf.get(trade.buyerId);
        const seller = ownerOf.get(trade.sellerId);
        if (buyer && seller) {
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
        }
        changed = true;
        await logWarehouseDemand(
          client,
          trade.buyerId,
          state.day,
          getTransportDemand(trade.productId, trade.quantity),
        );
      }
      await client.query('UPDATE world_state SET last_warehouse_trade_slot = $1 WHERE id = 1', [tradeSlot]);
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
  await pool.query(
    `UPDATE world_state
     SET world_time = world_time
           + GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - last_real_at)))
             * $1 * INTERVAL '1 second',
         last_real_at = clock_timestamp()
     WHERE id = 1`,
    [TIME_SCALE],
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
): Promise<{ building: ResidentialBuilding | null; error: ResidencePlacementError | 'insufficient_materials' | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [583921303]);

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

    const { rows } = await client.query<ResidentialBuildingRow>(
      `INSERT INTO residential_buildings
         (id, building_type, tile_x, tile_y, city_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'under_construction', $6)
       RETURNING ${RESIDENTIAL_COLUMNS}`,
      [randomUUID(), type, position.x, position.y, city.id, userId],
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
  await pool.query(
    `INSERT INTO world_state (id, world_time, last_real_at)
     VALUES (1, TIMESTAMPTZ '1100-01-01 06:00:00+00', clock_timestamp())
     ON CONFLICT (id) DO NOTHING`,
  );

  await Promise.all([
    subscriber.subscribe(SNAPSHOT_CHANNEL, (message) => broadcast(message)),
    subscriber.subscribe(CITIES_CHANNEL, (message) => broadcast(message)),
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
  app.get('/api/cities', requireAuth, (_request, response) => {
    void getCities()
      .then((cities) => response.json(cities))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar as cidades:', error);
        response.status(503).json({ error: 'cities_unavailable' });
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
        if (!isMaster) {
          response.status(409).json({ error: 'insufficient_materials' });
          return;
        }
        return createResidentialBuilding(definition.type, { x, y }, userId)
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
      .query<{ building_type: string }>(
        'SELECT building_type FROM residential_buildings WHERE id = $1',
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
          desired_stock: number;
          price: number;
          mode: 'sell' | 'buy';
        }>(
          `SELECT product_id, desired_stock, price, mode
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
        response.json({
          demand: {
            lastDay: demandRows.rows[0]?.day ?? null,
            last: demandRows.rows[0]?.demand ?? 0,
            monthAverage: demandRows.rows.reduce((sum, row) => sum + row.demand, 0) / 30,
          },
          settings: settings.rows.map((row) => ({
            productId: row.product_id,
            desiredStock: row.desired_stock,
            price: row.price,
            mode: row.mode,
          })),
          stock: stockRows.rows.map((row) => ({ productId: row.product_id, quantity: row.quantity })),
        });
      })
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o armazém:', error);
        response.status(503).json({ error: 'residence_unavailable' });
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
          `INSERT INTO warehouse_product_settings (building_id, product_id, desired_stock, price, mode)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (building_id, product_id)
           DO UPDATE SET desired_stock = EXCLUDED.desired_stock, price = EXCLUDED.price, mode = EXCLUDED.mode`,
          [request.params.id, setting.productId, setting.desiredStock, setting.price, setting.mode],
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
         WHERE id = $1 AND created_by = $2 AND building_type = 'shop_rice'
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
  app.get('/api/world', requireAuth, (_request, response) => {
    void getSnapshot()
      .then((snapshot) => response.json(snapshot))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar o estado do mundo:', error);
        response.status(503).json({ error: 'world_unavailable' });
      });
  });

  const webRoot = resolve(process.cwd(), 'dist');
  app.use(express.static(webRoot));
  app.get('*', (_request, response) => response.sendFile(resolve(webRoot, 'index.html')));

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        rejectWebSocketUpgrade(socket, 404);
        return;
      }

      const token = url.searchParams.get('token');
      if (!token || !(await verifyAccessToken(token, auth))) {
        rejectWebSocketUpgrade(socket, 401);
        return;
      }

      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit('connection', websocket, request);
      });
    })().catch((error: unknown) => {
      console.error('Não foi possível autenticar a conexão WebSocket:', error);
      rejectWebSocketUpgrade(socket, 503);
    });
  });

  websocketServer.on('connection', (websocket) => {
    clients.add(websocket);
    const presenceId = randomUUID();
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
