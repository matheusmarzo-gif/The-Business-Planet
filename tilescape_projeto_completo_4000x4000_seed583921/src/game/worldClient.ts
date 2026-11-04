import { getAccessToken } from '../auth/authClient';
import type { CityAssembly } from '../types/city';
import type { CityZone } from '../types/city';
import type { RoadTile } from '../types/road';

export interface WorldSnapshot {
  worldTime: string;
  serverTime: string;
  timeScale: number;
  map: {
    width: number;
    height: number;
    seed: number;
  };
  onlinePlayers: number;
}

function isCityAssembly(value: unknown): value is CityAssembly {
  if (typeof value !== 'object' || value === null) return false;
  const city = value as Record<string, unknown>;
  return (
    typeof city.id === 'string' &&
    typeof city.name === 'string' &&
    Number.isInteger(city.centerX) &&
    Number.isInteger(city.centerY) &&
    Number.isInteger(city.population) &&
    Number.isInteger(city.wellbeing) &&
    Number.isInteger(city.economy) &&
    (city.zones === undefined || (Array.isArray(city.zones) && city.zones.every(isCityZone)))
  );
}

function isCityZone(value: unknown): value is CityZone {
  if (typeof value !== 'object' || value === null) return false;
  const zone = value as Record<string, unknown>;
  return (
    typeof zone.id === 'string' &&
    typeof zone.cityId === 'string' &&
    (zone.type === 'urban' || zone.type === 'rural') &&
    Number.isInteger(zone.minX) &&
    Number.isInteger(zone.minY) &&
    Number.isInteger(zone.maxX) &&
    Number.isInteger(zone.maxY)
  );
}

function isRoadTile(value: unknown): value is RoadTile {
  if (typeof value !== 'object' || value === null) return false;
  const road = value as Record<string, unknown>;
  return (
    Number.isInteger(road.x) &&
    Number.isInteger(road.y) &&
    typeof road.cityId === 'string'
  );
}

export function connectToWorld(
  onSnapshot: (snapshot: WorldSnapshot) => void,
  onConnectionChange: (connected: boolean) => void,
  onCitiesChange: (cities: CityAssembly[]) => void,
  onRoadsChange: (roads: RoadTile[]) => void,
): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let stopped = false;
  let retryDelay = 1000;

  const scheduleReconnect = () => {
    if (stopped) return;
    reconnectTimer = window.setTimeout(() => {
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };

  const connect = async () => {
    if (stopped) return;

    try {
      const token = await getAccessToken();
      if (stopped) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(`${protocol}//${window.location.host}/ws`);
      url.searchParams.set('token', token);
      socket = new WebSocket(url);
    } catch (error) {
      console.error('Não foi possível autenticar a conexão com o mundo:', error);
      onConnectionChange(false);
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      retryDelay = 1000;
      onConnectionChange(true);
    });
    socket.addEventListener('message', (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'cities' &&
          'cities' in message &&
          Array.isArray(message.cities) &&
          message.cities.every(isCityAssembly) &&
          'roads' in message &&
          Array.isArray(message.roads) &&
          message.roads.every(isRoadTile)
        ) {
          onCitiesChange(
            message.cities.map((city) => ({
              ...city,
              zones: city.zones ?? [],
            })),
          );
          onRoadsChange(message.roads);
          return;
        }
        const snapshot = message as WorldSnapshot;
        if (
          typeof snapshot.worldTime === 'string' &&
          typeof snapshot.serverTime === 'string' &&
          Number.isFinite(snapshot.timeScale)
        ) {
          onSnapshot(snapshot);
        }
      } catch (error) {
        console.error('Não foi possível interpretar a atualização do mundo.', error);
      }
    });
    socket.addEventListener('error', () => {
      onConnectionChange(false);
    });
    socket.addEventListener('close', () => {
      onConnectionChange(false);
      scheduleReconnect();
    });
  };

  void connect();

  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
