import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatchStore } from './match-store';
import { Player, SERVES_PER_TURN, Target } from './match';
import { Sync } from './sync';
import { isValidRoomCode, normaliseRoomCode, randomRoomCode } from './sync-config';

@Component({
  selector: 'app-setup',
  templateUrl: './setup.html',
  styleUrl: './setup.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Setup {
  private readonly store = inject(MatchStore);
  readonly sync = inject(Sync);

  readonly targets: Target[] = [11, 21];
  readonly bestOfOptions = [1, 3, 5, 7];

  private readonly previous = this.store.lastConfig();

  readonly names = signal<[string, string]>([...this.previous.names] as [string, string]);
  readonly target = signal<Target>(this.previous.target);
  readonly bestOf = signal<number>(this.previous.bestOf);
  readonly firstServer = signal<Player>(this.previous.firstServer);

  /** Share this match to a room others can tap along in. */
  readonly shared = signal(false);
  readonly code = signal(randomRoomCode());
  readonly joinCode = signal('');

  readonly servesPerTurn = computed(() => SERVES_PER_TURN[this.target()]);
  readonly canJoin = computed(() => isValidRoomCode(this.joinCode()));

  readonly displayNames = computed<[string, string]>(() => {
    const [a, b] = this.names();
    return [a.trim() || 'Player 1', b.trim() || 'Player 2'];
  });

  /** What the phone that joined someone else's room is waiting on. */
  readonly joinStatus = computed(() => {
    const seconds = this.sync.waitingFor();
    switch (this.sync.status()) {
      case 'connecting':
        return this.sync.waking()
          ? `Waking the relay — ${seconds}s. Free hosting sleeps when idle, so the first ` +
            `connection can take up to a minute. It'll join on its own.`
          : 'Connecting…';
      case 'retrying':
        return `Lost the relay — reconnecting (${seconds}s).`;
      case 'live':
        return `In room ${this.sync.room()}. Waiting for the match to start.`;
      default:
        return '';
    }
  });

  setName(index: 0 | 1, value: string): void {
    this.names.update((names) => {
      const next = [...names] as [string, string];
      next[index] = value;
      return next;
    });
  }

  setJoinCode(value: string): void {
    this.joinCode.set(normaliseRoomCode(value));
  }

  newCode(): void {
    this.code.set(randomRoomCode());
  }

  join(): void {
    if (!this.canJoin()) return;
    this.shared.set(false);
    this.sync.join(this.joinCode());
  }

  start(): void {
    // Join first so the new match is what seeds the room.
    if (this.shared()) this.sync.join(this.code());
    else this.sync.leave();

    this.store.start({
      names: this.displayNames(),
      target: this.target(),
      servesPerTurn: this.servesPerTurn(),
      bestOf: this.bestOf(),
      firstServer: this.firstServer(),
    });
  }
}
