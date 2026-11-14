import assert from 'node:assert/strict';
import test from 'node:test';
import { rankPlayers } from './leaderboard.js';

test('returns the top 30 and appends the current player at their real position', () => {
  const result = rankPlayers(
    Array.from({ length: 32 }, (_, index) => ({
      playerId: `player-${index + 1}`,
      playerName: `Jogador ${index + 1}`,
      score: 100 - index,
    })),
    'player-32',
  );

  assert.equal(result.length, 31);
  assert.equal(result[0].position, 1);
  assert.equal(result[29].position, 30);
  assert.equal(result[30].position, 32);
  assert.equal(result[30].isCurrentPlayer, true);
});

test('sorts equal scores deterministically by player name', () => {
  const result = rankPlayers(
    [
      { playerId: 'player-b', playerName: 'Bela', score: 5 },
      { playerId: 'player-a', playerName: 'Ana', score: 5 },
    ],
    'player-a',
  );

  assert.deepEqual(result.map((entry) => entry.position), [1, 2]);
  assert.deepEqual(result.map((entry) => entry.playerName), ['Ana', 'Bela']);
});

test('rejects invalid limits and player data', () => {
  assert.throws(() => rankPlayers([], 'player-1', 0), RangeError);
  assert.throws(
    () => rankPlayers([{ playerId: '', playerName: 'Jogador', score: 0 }], 'player-1'),
    RangeError,
  );
  assert.throws(
    () => rankPlayers([{ playerId: 'player-1', playerName: 'Jogador', score: Number.NaN }], 'player-1'),
    RangeError,
  );
});
