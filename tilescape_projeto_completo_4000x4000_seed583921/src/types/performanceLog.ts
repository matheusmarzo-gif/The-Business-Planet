export interface PerformanceEntityCounts {
  residences: number;
  workplaces: number;
  shops: number;
  warehouses: number;
}

export interface PerformanceLogRecord {
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
