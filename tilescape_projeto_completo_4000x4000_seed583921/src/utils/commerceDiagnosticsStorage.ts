import {
  isShopResidenceTransaction,
  type CommerceDiagnosticsUpdate,
  type ShopResidenceTransaction,
} from '../types/commerce';

const STORAGE_PREFIX = 'valdora:commerce-demand';
const MAX_STORED_DAYS = 30;

type CommerceDiagnosticsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function getStorageKey(userEmail: string, buildingId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(userEmail.toLowerCase())}:${buildingId}`;
}

function parseStoredDays(value: string | null): Record<string, ShopResidenceTransaction[]> {
  if (value === null) return {};
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('O cálculo da demanda salvo neste navegador está inválido.');
  }
  const days = parsed as Record<string, unknown>;
  const validDays: Record<string, ShopResidenceTransaction[]> = {};
  for (const [day, transactions] of Object.entries(days)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Array.isArray(transactions) ||
      !transactions.every(isShopResidenceTransaction)
    ) {
      throw new Error('O cálculo da demanda salvo neste navegador está inválido.');
    }
    validDays[day] = transactions;
  }
  return validDays;
}

function keepRecentDays(
  days: Record<string, ShopResidenceTransaction[]>,
): Record<string, ShopResidenceTransaction[]> {
  return Object.fromEntries(
    Object.entries(days)
      .sort(([firstDay], [secondDay]) => secondDay.localeCompare(firstDay))
      .slice(0, MAX_STORED_DAYS),
  );
}

export function saveCommerceDiagnostics(
  storage: CommerceDiagnosticsStorage,
  userEmail: string,
  update: CommerceDiagnosticsUpdate,
): void {
  const key = getStorageKey(userEmail, update.buildingId);
  const days = parseStoredDays(storage.getItem(key));
  days[update.day] = update.transactions;
  storage.setItem(key, JSON.stringify(keepRecentDays(days)));
}

export function loadCommerceDiagnostics(
  storage: CommerceDiagnosticsStorage,
  userEmail: string,
  buildingId: string,
): Map<string, ShopResidenceTransaction[]> {
  return new Map(
    Object.entries(parseStoredDays(storage.getItem(getStorageKey(userEmail, buildingId)))),
  );
}
