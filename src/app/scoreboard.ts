import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatchStore } from './match-store';
import { Sync } from './sync';
import {
  MatchState,
  Player,
  addPoint,
  gameWinner,
  gamesNeeded,
  isDecidingGame,
  matchWinner,
  other,
  scoreLine,
} from './match';

/** Two taps inside this window count as "take that point back". */
const DOUBLE_TAP_MS = 300;

interface Side {
  player: Player;
  name: string;
  score: number;
  gamesWon: number;
  serving: boolean;
  dots: boolean[];
  badge: string | null;
}

@Component({
  selector: 'app-scoreboard',
  templateUrl: './scoreboard.html',
  styleUrl: './scoreboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Scoreboard {
  readonly store = inject(MatchStore);
  readonly sync = inject(Sync);
  private readonly destroyRef = inject(DestroyRef);

  /** Hides the chrome and maximises the digits, for reading across the room. */
  readonly bigMode = signal(false);

  /** True while the browser is holding a screen wake lock for us. */
  readonly awake = signal(false);

  private lastTap: { player: Player | -1; at: number; scored: boolean } = {
    player: -1,
    at: 0,
    scored: false,
  };

  readonly state = computed(() => this.store.state()!);
  readonly gameOver = computed(() => this.store.gameWinner() !== null);
  readonly matchOver = computed(() => this.store.matchWinner() !== null);

  readonly sides = computed<Side[]>(() => {
    const s = this.state();
    const serve = this.store.serve();
    const order: Player[] = s.leftPlayer === 0 ? [0, 1] : [1, 0];

    return order.map((player) => {
      const serving = !this.gameOver() && serve?.server === player;
      return {
        player,
        name: s.config.names[player],
        score: s.score[player],
        gamesWon: s.gamesWon[player],
        serving,
        dots: serving
          ? Array.from({ length: serve!.servesInTurn }, (_, i) => i < serve!.serveNumber)
          : [],
        badge: this.badgeFor(s, player),
      };
    });
  });

  /** One pip per game needed to take the match. */
  readonly tallySlots = computed(() =>
    Array.from({ length: gamesNeeded(this.state().config.bestOf) }, (_, i) => i),
  );

  readonly statusLine = computed(() => {
    const s = this.state();
    const parts = [`Game ${s.gameNumber}`, `to ${s.config.target}`];
    if (s.config.bestOf > 1) parts.push(`best of ${s.config.bestOf}`);
    if (isDecidingGame(s) && s.config.bestOf > 1) parts.push('deciding game');
    return parts.join(' · ');
  });

  readonly gamesLine = computed(() => {
    const s = this.state();
    return s.history.map((game) => scoreLine(game)).join('  ');
  });

  readonly winnerName = computed(() => {
    const s = this.state();
    const winner = this.store.matchWinner() ?? this.store.gameWinner();
    return winner === null ? '' : s.config.names[winner];
  });

  /** Colours the result card in the winner's colour. */
  readonly winnerTeam = computed(() => {
    const winner = this.store.matchWinner() ?? this.store.gameWinner();
    return winner === null ? '' : `team-${winner}`;
  });

  readonly finalLine = computed(() => {
    const s = this.state();
    const last = s.history.at(-1);
    return last ? scoreLine(last) : '';
  });

  readonly matchGamesLine = computed(() => {
    const s = this.state();
    const winner = this.store.matchWinner();
    if (winner === null) return '';
    return `${s.gamesWon[winner]}–${s.gamesWon[other(winner)]} in games`;
  });

  constructor() {
    this.keepAwake();
  }

  /** Ends the match on this phone and drops out of any shared room. */
  end(): void {
    this.sync.leave();
    this.store.quit();
  }

  /**
   * One tap adds a point, two quick taps take one away.
   *
   * The first tap always scores immediately so the board feels responsive; if a
   * second tap follows, that point is undone and one is subtracted instead, so
   * a double tap lands on one below where the score started.
   */
  point(player: Player): void {
    const now = Date.now();
    const isDoubleTap =
      this.lastTap.player === player &&
      this.lastTap.scored &&
      now - this.lastTap.at < DOUBLE_TAP_MS;

    if (isDoubleTap) {
      this.lastTap = { player: -1, at: 0, scored: false };
      this.store.undo();
      this.store.subtract(player);
      return;
    }

    if (this.gameOver()) return;
    const before = this.store.state();
    this.store.point(player);
    this.lastTap = { player, at: now, scored: this.store.state() !== before };
  }

  subtract(event: Event, player: Player): void {
    event.stopPropagation();
    this.store.subtract(player);
  }

  /** "Game point" / "Match point" for a player one point from the win. */
  private badgeFor(state: MatchState, player: Player): string | null {
    if (gameWinner(state) !== null) return null;
    const projected = addPoint(state, player);
    if (gameWinner(projected) === null) return null;
    return matchWinner(projected) !== null ? 'Match point' : 'Game point';
  }

  /**
   * Holds a screen wake lock so the phone doesn't sleep between rallies — the
   * same mechanism a video player uses. Needs HTTPS and iOS 16.4+.
   *
   * iOS drops the lock whenever the page is backgrounded and sometimes on its
   * own, so we re-request on every plausible trigger rather than assuming the
   * first grant survives the match.
   */
  private keepAwake(): void {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: {
          request(type: 'screen'): Promise<{
            release(): Promise<void>;
            addEventListener(type: 'release', listener: () => void): void;
          }>;
        };
      }
    ).wakeLock;
    if (!wakeLock) return;

    let lock: Awaited<ReturnType<typeof wakeLock.request>> | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || lock || document.visibilityState !== 'visible') return;
      try {
        lock = await wakeLock.request('screen');
        this.awake.set(true);
        lock.addEventListener('release', () => {
          lock = null;
          this.awake.set(false);
        });
        if (disposed) void this.releaseLock(lock);
      } catch {
        // Denied, low battery, or unsupported — the screen just dims as usual.
        this.awake.set(false);
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    // Scoring a point is also a good moment to re-take a lock we quietly lost.
    document.addEventListener('pointerdown', acquire);

    this.destroyRef.onDestroy(() => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      document.removeEventListener('pointerdown', acquire);
      void this.releaseLock(lock);
      this.awake.set(false);
    });
  }

  private async releaseLock(lock: { release(): Promise<void> } | null): Promise<void> {
    try {
      await lock?.release();
    } catch {
      // Already gone.
    }
  }
}
