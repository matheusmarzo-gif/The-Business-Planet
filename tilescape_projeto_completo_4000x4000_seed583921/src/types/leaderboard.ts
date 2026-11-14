export const LEADERBOARD_LIMIT = 30;

export interface LeaderboardCandidate {
  playerId: string;
  playerName: string;
  score: number;
}

export interface LeaderboardEntry extends LeaderboardCandidate {
  position: number;
  isCurrentPlayer: boolean;
}

export type LeaderboardPeriodDays = 30 | 365;

export interface ProductLeaderboard {
  productId: string;
  sales: LeaderboardEntry[];
  production: LeaderboardEntry[];
}

export interface LeaderboardHistoryAvailability {
  sales_since: string;
  production_since: string;
  profit_since: string;
  investment_since: string;
}

export interface LeaderboardSummary {
  periodDays: LeaderboardPeriodDays;
  worldDay: string;
  historyAvailableSince: LeaderboardHistoryAvailability | null;
  companyValue: LeaderboardEntry[];
  buildingTiles: LeaderboardEntry[];
  products: ProductLeaderboard[];
  profit: LeaderboardEntry[];
  investment: LeaderboardEntry[];
}

export function rankPlayers(
  candidates: readonly LeaderboardCandidate[],
  currentPlayerId: string,
  limit = LEADERBOARD_LIMIT,
): LeaderboardEntry[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('O limite do ranking precisa ser um inteiro positivo.');
  }

  const playerIds = new Set<string>();
  const ranked = candidates.map((candidate) => {
    if (
      !candidate.playerId ||
      !candidate.playerName ||
      !Number.isFinite(candidate.score) ||
      playerIds.has(candidate.playerId)
    ) {
      throw new RangeError('Os dados do ranking contêm jogadores ou pontuações inválidos.');
    }
    playerIds.add(candidate.playerId);
    return candidate;
  }).sort((first, second) =>
    second.score - first.score ||
    first.playerName.localeCompare(second.playerName, 'pt-BR') ||
    first.playerId.localeCompare(second.playerId),
  );
  const rankedEntries = ranked.map((player, index) => ({
    ...player,
    position: index + 1,
    isCurrentPlayer: player.playerId === currentPlayerId,
  }));

  const top = rankedEntries.slice(0, limit);
  const currentPlayer = rankedEntries.find((player) => player.isCurrentPlayer);
  if (currentPlayer && !top.some((player) => player.isCurrentPlayer)) {
    top.push(currentPlayer);
  }

  return top;
}
