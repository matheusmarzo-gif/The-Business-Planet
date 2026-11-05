// Velocidades do mundo (segundos de jogo por segundo real; 15 = 1:15).
export const WORLD_TIME_SCALES = [15, 30, 60, 240] as const;
export const DEFAULT_TIME_SCALE = 15;
export const MAX_MASTER_GRANT = 1_000_000_000;

export function isValidTimeScale(value: unknown): value is number {
  return typeof value === 'number' && (WORLD_TIME_SCALES as readonly number[]).includes(value);
}

export function parseMasterGrant(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_MASTER_GRANT
    ? value
    : null;
}
