import { describe, expect, it } from 'vitest';
import {
  MatchConfig,
  MatchState,
  Player,
  SERVES_PER_TURN,
  Target,
  addPoint,
  gameWinner,
  isDecidingGame,
  matchWinner,
  newMatch,
  nextGame,
  serveInfo,
} from './match';

function config(target: Target, overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    names: ['A', 'B'],
    target,
    servesPerTurn: SERVES_PER_TURN[target],
    bestOf: 3,
    firstServer: 0,
    ...overrides,
  };
}

/** Plays a run of points, alternating so the total lands where we want it. */
function play(state: MatchState, points: Player[]): MatchState {
  return points.reduce((s, p) => addPoint(s, p), state);
}

function serversForTotals(target: Target, totals: number): Player[] {
  let state = newMatch(config(target));
  const servers: Player[] = [];
  for (let i = 0; i < totals; i++) {
    servers.push(serveInfo(state).server);
    // alternate points so neither side runs away with it
    state = addPoint(state, (i % 2) as Player);
  }
  return servers;
}

describe('serve rotation', () => {
  it('gives 3 serves per side in a game to 11', () => {
    expect(serversForTotals(11, 12)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1]);
  });

  it('gives 5 serves per side in a game to 21', () => {
    expect(serversForTotals(21, 20)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1,
    ]);
  });

  it('counts serves within the turn', () => {
    let state = newMatch(config(11));
    expect(serveInfo(state)).toMatchObject({ serveNumber: 1, servesInTurn: 3 });
    state = addPoint(state, 0);
    expect(serveInfo(state)).toMatchObject({ serveNumber: 2, servesInTurn: 3 });
    state = addPoint(state, 1);
    expect(serveInfo(state)).toMatchObject({ serveNumber: 3, servesInTurn: 3 });
    state = addPoint(state, 0);
    expect(serveInfo(state)).toMatchObject({ server: 1, serveNumber: 1 });
  });

  it('honours who serves first', () => {
    const state = newMatch(config(11, { firstServer: 1 }));
    expect(serveInfo(state).server).toBe(1);
  });

  it('alternates every point at deuce', () => {
    // 10-10 in a game to 11
    let state = newMatch(config(11));
    for (let i = 0; i < 20; i++) state = addPoint(state, (i % 2) as Player);
    expect(state.score).toEqual([10, 10]);

    const servers: Player[] = [];
    for (let i = 0; i < 4; i++) {
      const info = serveInfo(state);
      expect(info.servesInTurn).toBe(1);
      servers.push(info.server);
      state = addPoint(state, (i % 2) as Player);
    }
    expect(servers).toEqual([0, 1, 0, 1]);
  });

  it('continues the rotation into deuce without a jump', () => {
    // The server at 10-10 is whoever the normal 3-serve rotation had at that point.
    let state = newMatch(config(11));
    for (let i = 0; i < 19; i++) state = addPoint(state, (i % 2) as Player);
    const before = serveInfo(state).server;
    state = addPoint(state, 1);
    expect(state.score).toEqual([10, 10]);
    expect(serveInfo(state).server).toBe(before);
  });
});

describe('winning a game', () => {
  it('needs the target score', () => {
    let state = newMatch(config(11));
    for (let i = 0; i < 10; i++) state = addPoint(state, 0);
    expect(gameWinner(state)).toBeNull();
    state = addPoint(state, 0);
    expect(gameWinner(state)).toBe(0);
  });

  it('needs a two point lead', () => {
    let state = newMatch(config(11));
    for (let i = 0; i < 20; i++) state = addPoint(state, (i % 2) as Player);
    state = addPoint(state, 0); // 11-10
    expect(gameWinner(state)).toBeNull();
    state = addPoint(state, 0); // 12-10
    expect(gameWinner(state)).toBe(0);
  });

  it('ignores points after the game is won', () => {
    let state = newMatch(config(11));
    for (let i = 0; i < 11; i++) state = addPoint(state, 0);
    const frozen = addPoint(state, 1);
    expect(frozen.score).toEqual([11, 0]);
  });

  it('records the game and hands the first serve to the receiver', () => {
    let state = newMatch(config(11));
    for (let i = 0; i < 11; i++) state = addPoint(state, 0);
    expect(state.gamesWon).toEqual([1, 0]);
    expect(state.history).toHaveLength(1);

    state = nextGame(state);
    expect(state.score).toEqual([0, 0]);
    expect(state.gameNumber).toBe(2);
    expect(serveInfo(state).server).toBe(1);
  });
});

describe('winning a match', () => {
  it('takes two games in a best of three', () => {
    let state = newMatch(config(11));
    for (let i = 0; i < 11; i++) state = addPoint(state, 0);
    state = nextGame(state);
    expect(matchWinner(state)).toBeNull();
    for (let i = 0; i < 11; i++) state = addPoint(state, 0);
    expect(matchWinner(state)).toBe(0);
  });
});

describe('changing ends', () => {
  it('swaps ends between games', () => {
    let state = newMatch(config(11));
    expect(state.leftPlayer).toBe(0);
    state = play(state, Array(11).fill(0) as Player[]);
    state = nextGame(state);
    expect(state.leftPlayer).toBe(1);
  });

  it('swaps at 5 in a deciding game to 11', () => {
    let state = newMatch(config(11, { bestOf: 3 }));
    state = { ...state, gamesWon: [1, 1] }; // deciding game
    state = play(state, [0, 1, 0, 1, 0, 1, 0, 1] as Player[]); // 4-4
    expect(state.switchedEnds).toBe(false);
    state = addPoint(state, 0); // 5-4
    expect(state.switchedEnds).toBe(true);
    expect(state.leftPlayer).toBe(1);
  });

  it('stops calling it the deciding game once the match is won', () => {
    let state = newMatch(config(11, { bestOf: 3 }));
    state = play(state, Array(11).fill(0) as Player[]);
    state = nextGame(state);
    state = play(state, Array(11).fill(0) as Player[]); // 2-0, match over
    expect(isDecidingGame(state)).toBe(false);
  });

  it('does not swap mid-game when the match is not decided', () => {
    let state = newMatch(config(11, { bestOf: 3 }));
    state = play(state, Array(6).fill(0) as Player[]);
    expect(state.switchedEnds).toBe(false);
  });
});
