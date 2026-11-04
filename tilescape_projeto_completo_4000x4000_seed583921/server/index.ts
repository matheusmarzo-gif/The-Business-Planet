import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 3001);
const TIME_SCALE = 15;
const MAP = { width: 4000, height: 4000, seed: 583921 };
const CLOCK_LEADER_KEY = 'valdora:clock:leader';
const PRESENCE_KEY = 'valdora:presence';
const SNAPSHOT_CHANNEL = 'valdora:world:snapshots';
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

async function start() {
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

  await subscriber.subscribe(SNAPSHOT_CHANNEL, (message) => broadcast(message));

  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_request, response) => {
    void Promise.all([pool.query('SELECT 1'), redis.ping()])
      .then(() => response.json({ status: 'ok' }))
      .catch((error: unknown) => {
        console.error('Verificação de saúde do mundo falhou:', error);
        response.status(503).json({ status: 'unavailable' });
      });
  });
  app.get('/api/world', (_request, response) => {
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
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request);
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
