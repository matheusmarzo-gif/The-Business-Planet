export interface WebSocketMessageTraffic {
  messages: number;
  payloadBytes: number;
}

export interface WebSocketTrafficHour {
  hour: string;
  connections: number;
  reconnections: number;
  connectionHours: number;
  peakConcurrentConnections: number;
  snapshots: WebSocketMessageTraffic;
  worldUpdates: WebSocketMessageTraffic;
  commerceDiagnostics: WebSocketMessageTraffic;
}

export interface WebSocketTrafficSnapshot {
  activeConnections: number;
  hours: WebSocketTrafficHour[];
}
