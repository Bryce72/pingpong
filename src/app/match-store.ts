import { Injectable, computed, effect, signal } from '@angular/core';
import {
  MatchConfig,
  MatchState,
  Player,
  SERVES_PER_TURN,
  Target,
  addPoint,
  gameWinner,
  matchWinner,
  newMatch,
  nextGame,
  rematch,
  removePoint,
  serveInfo,
  swapEnds,
} from './match';

const MATCH_KEY = 'pingpong.match.v1';
const CONFIG_KEY = 'pingpong.config.v1';
const UNDO_DEPTH = 100;

export const DEFAULT_CONFIG: MatchConfig = {
  names: ['Player 1', 'Player 2'],
  target: 11,
  servesPerTurn: SERVES_PER_TURN[11],
  bestOf: 3,
  firstServer: 0,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, quota, etc. The app still works, it just won't resume.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/** Where a state change came from, so sync doesn't echo remote changes back. */
export type ChangeSource = 'local' | 'remote';

interface Envelope {
  state: MatchState | null;
  source: ChangeSource;
}

@Injectable({ providedIn: 'root' })
export class MatchStore {
  private readonly _envelope = signal<Envelope>({
    state: read<MatchState>(MATCH_KEY),
    source: 'remote',
  });
  private readonly _undo = signal<MatchState[]>([]);

  /** The state plus who changed it. Sync watches this; everything else uses `state`. */
  readonly envelope = this._envelope.asReadonly();

  /** Null when no match is in progress — the setup screen is showing. */
  readonly state = computed(() => this._envelope().state);
  readonly lastConfig = signal<MatchConfig>(read<MatchConfig>(CONFIG_KEY) ?? DEFAULT_CONFIG);

  readonly serve = computed(() => {
    const s = this.state();
    return s ? serveInfo(s) : null;
  });
  readonly gameWinner = computed(() => {
    const s = this.state();
    return s ? gameWinner(s) : null;
  });
  readonly matchWinner = computed(() => {
    const s = this.state();
    return s ? matchWinner(s) : null;
  });
  readonly canUndo = computed(() => this._undo().length > 0);

  constructor() {
    effect(() => {
      const s = this.state();
      if (s) write(MATCH_KEY, s);
      else remove(MATCH_KEY);
    });
    effect(() => write(CONFIG_KEY, this.lastConfig()));
  }

  start(config: MatchConfig): void {
    this.lastConfig.set(config);
    this._undo.set([]);
    this.setLocal(newMatch(config));
  }

  point(player: Player): void {
    this.commit((s) => addPoint(s, player));
  }

  subtract(player: Player): void {
    this.commit((s) => removePoint(s, player));
  }

  nextGame(): void {
    this.commit(nextGame);
  }

  swapEnds(): void {
    this.commit(swapEnds);
  }

  rematch(): void {
    const s = this.state();
    if (!s) return;
    this._undo.set([]);
    this.setLocal(rematch(s));
  }

  undo(): void {
    const stack = this._undo();
    const previous = stack.at(-1);
    if (!previous) return;
    this._undo.set(stack.slice(0, -1));
    this.setLocal(previous);
  }

  /** Ends the match and returns to setup. */
  quit(): void {
    this._undo.set([]);
    this.setLocal(null);
  }

  /**
   * Takes a state handed to us by another phone. Marked remote so the sync
   * layer doesn't bounce it straight back, and it clears undo: the stack refers
   * to a history the other phone never had.
   */
  applyRemote(state: MatchState | null): void {
    this._undo.set([]);
    this._envelope.set({ state, source: 'remote' });
  }

  private setLocal(state: MatchState | null): void {
    this._envelope.set({ state, source: 'local' });
  }

  private commit(change: (state: MatchState) => MatchState): void {
    const current = this.state();
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    this._undo.update((stack) => [...stack, current].slice(-UNDO_DEPTH));
    this.setLocal(next);
  }
}

export { SERVES_PER_TURN };
export type { MatchConfig, Target };
