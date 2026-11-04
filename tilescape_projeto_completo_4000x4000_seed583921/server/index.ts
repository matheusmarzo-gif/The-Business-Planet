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
  type CityPlacementError,
  getCityPlacementError,
  MUNICIPAL_AREA_RADIUS,
} from '../src/types/city.js';
import {
  getRoadPlacementError,
  MAX_ROAD_PATH_TILES,
  type RoadPlacementError,
  type RoadPosition,
  type RoadTile,
} from '../src/types/road.js';
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
  }>(
    `SELECT id, name, center_x, center_y, population, wellbeing, economy
     FROM city_assemblies
     ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    centerX: row.center_x,
    centerY: row.center_y,
    population: row.population,
    wellbeing: row.wellbeing,
    economy: row.economy,
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

async function publishCities() {
  const [cities, roads] = await Promise.all([getCities(), getRoadTiles()]);
  await redis.publish(CITIES_CHANNEL, JSON.stringify({ type: 'cities', cities, roads }));
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

    for (const position of path) {
      const placementError = getRoadPlacementError(
        position,
        cities,
        (x, y) => landTileIds.has(mapGenerator.getTileAt(x, y).tileId),
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
  app.get('/api/cities', requireAuth, (_request, response) => {
    void getCities()
      .then((cities) => response.json(cities))
      .catch((error: unknown) => {
        console.error('Não foi possível consultar as cidades:', error);
        response.status(503).json({ error: 'cities_unavailable' });
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
            const [cities, roads] = await Promise.all([getCities(), getRoadTiles()]);
            websocket.send(JSON.stringify({ type: 'cities', cities, roads }));
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
