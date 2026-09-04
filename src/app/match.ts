/** Pure match rules. No Angular, no I/O — everything here is a plain function. */

export type Player = 0 | 1;
export type Target = 11 | 21;

export interface MatchConfig {
  names: [string, string];
  /** Points needed to win a game (win by 2). */
  target: Target;
  /** Serves each player gets before handing over, before deuce. */
  servesPerTurn: number;
  /** 1, 3, 5 or 7. */
  bestOf: number;
  firstServer: Player;
}

export interface GameResult {
  score: [number, number];
  winner: Player;
}

export interface MatchState {
  config: MatchConfig;
  score: [number, number];
  gamesWon: [number, number];
  gameNumber: number;
  gameFirstServer: Player;
  /** Which player is shown in the left panel. */
  leftPlayer: Player;
  /** Finished games, in order. */
  history: GameResult[];
  /** Ends already swapped in the deciding game. */
  switchedEnds: boolean;
}

export interface ServeInfo {
  server: Player;
  /** 1-based serve within the current turn. */
  serveNumber: number;
  /** Serves in the current turn: servesPerTurn normally, 1 at deuce. */
  servesInTurn: number;
}

export const SERVES_PER_TURN: Record<Target, number> = { 11: 3, 21: 5 };

export function gamesNeeded(bestOf: number): number {
  return Math.ceil(bestOf / 2);
}

export function other(player: Player): Player {
  return player === 0 ? 1 : 0;
}

export function newMatch(config: MatchConfig): MatchState {
  return {
    config,
    score: [0, 0],
    gamesWon: [0, 0],
    gameNumber: 1,
    gameFirstServer: config.firstServer,
    leftPlayer: 0,
    history: [],
    switchedEnds: false,
  };
}

/**
 * Who serves the next point.
 *
 * Normal play: turns of `servesPerTurn` points, alternating. Once both players
 * reach `target - 1` (deuce) service alternates every single point, picking up
 * from whoever the normal rotation had serving at that moment.
 */
export function serveInfo(state: MatchState): ServeInfo {
  const { target, servesPerTurn } = state.config;
  const total = state.score[0] + state.score[1];
  const deuceTotal = 2 * (target - 1);
  const first = state.gameFirstServer;

  if (total < deuceTotal) {
    const turn = Math.floor(total / servesPerTurn);
    return {
      server: turn % 2 === 0 ? first : other(first),
      serveNumber: (total % servesPerTurn) + 1,
      servesInTurn: servesPerTurn,
    };
  }

  const turnsBeforeDeuce = Math.floor(deuceTotal / servesPerTurn);
  const base = turnsBeforeDeuce % 2 === 0 ? first : other(first);
  const server = (total - deuceTotal) % 2 === 0 ? base : other(base);
  return { server, serveNumber: 1, servesInTurn: 1 };
}

export function gameWinner(state: MatchState): Player | null {
  const [a, b] = state.score;
  const { target } = state.config;
  if (a >= target && a - b >= 2) return 0;
  if (b >= target && b - a >= 2) return 1;
  return null;
}

export function matchWinner(state: MatchState): Player | null {
  const needed = gamesNeeded(state.config.bestOf);
  if (state.gamesWon[0] >= needed) return 0;
  if (state.gamesWon[1] >= needed) return 1;
  return null;
}

/** True while the match is on its last possible game. */
export function isDecidingGame(state: MatchState): boolean {
  const { bestOf } = state.config;
  if (bestOf === 1 || matchWinner(state) !== null) return false;
  return state.gamesWon[0] + state.gamesWon[1] === bestOf - 1;
}

/** In the deciding game, ends change when the first player reaches half the target. */
export function shouldSwitchEnds(state: MatchState): boolean {
  if (!isDecidingGame(state) || state.switchedEnds) return false;
  const half = Math.floor(state.config.target / 2);
  return Math.max(state.score[0], state.score[1]) >= half;
}

/** Adds a point, banking the game (and switching ends) when it ends. */
export function addPoint(state: MatchState, player: Player): MatchState {
  if (gameWinner(state) !== null || matchWinner(state) !== null) return state;

  const score: [number, number] = [...state.score] as [number, number];
  score[player] += 1;
  let next: MatchState = { ...state, score };

  const winner = gameWinner(next);
  if (winner !== null) {
    const gamesWon: [number, number] = [...next.gamesWon] as [number, number];
    gamesWon[winner] += 1;
    next = {
      ...next,
      gamesWon,
      history: [...next.history, { score, winner }],
    };
  } else if (shouldSwitchEnds(next)) {
    next = { ...next, leftPlayer: other(next.leftPlayer), switchedEnds: true };
  }

  return next;
}

export function removePoint(state: MatchState, player: Player): MatchState {
  if (state.score[player] === 0) return state;
  const score: [number, number] = [...state.score] as [number, number];
  score[player] -= 1;
  return { ...state, score };
}

/** Starts the next game: scores reset, ends swapped, previous receiver serves. */
export function nextGame(state: MatchState): MatchState {
  if (matchWinner(state) !== null) return state;
  return {
    ...state,
    score: [0, 0],
    gameNumber: state.gameNumber + 1,
    gameFirstServer: other(state.gameFirstServer),
    leftPlayer: other(state.leftPlayer),
    switchedEnds: false,
  };
}

export function rematch(state: MatchState): MatchState {
  return newMatch({ ...state.config, firstServer: other(state.config.firstServer) });
}

export function swapEnds(state: MatchState): MatchState {
  return { ...state, leftPlayer: other(state.leftPlayer) };
}

export function scoreLine(result: GameResult): string {
  const [a, b] = result.score;
  return `${a}–${b}`;
}
