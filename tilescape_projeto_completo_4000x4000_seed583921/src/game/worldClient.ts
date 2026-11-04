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

export function connectToWorld(
  onSnapshot: (snapshot: WorldSnapshot) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let stopped = false;
  let retryDelay = 1000;

  const connect = () => {
    if (stopped) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socket.addEventListener('open', () => {
      retryDelay = 1000;
      onConnectionChange(true);
    });
    socket.addEventListener('message', (event) => {
      try {
        const snapshot: WorldSnapshot = JSON.parse(String(event.data));
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
      if (!stopped) {
        reconnectTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      }
    });
  };

  connect();

  return () => {
    stopped = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
