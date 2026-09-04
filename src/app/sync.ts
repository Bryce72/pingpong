import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatchState } from './match';
import { MatchStore } from './match-store';
import { healthUrl, isValidRoomCode, relayUrl } from './sync-config';

export type SyncStatus = 'off' | 'connecting' | 'live' | 'retrying';

/** A socket that hasn't opened by now is talking to something asleep. */
const OPEN_TIMEOUT_MS = 8000;
const RECONNECT_MS = [1000, 2000, 4000, 8000, 15000];
/** While the relay is cold, retry briskly instead of backing off. */
const COLD_RETRY_MS = 3000;
const HEALTH_POLL_MS = 2500;
/** Render's free tier can take most of a minute to spin up from sleep. */
const WAKE_BUDGET_MS = 120000;
/** Past this many seconds we tell the user it's a cold start, not a hiccup. */
const WAKING_AFTER_S = 4;
const ROOM_KEY = 'pingpong.room.v1';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable({ providedIn: 'root' })
export class Sync {
  private readonly store = inject(MatchStore);

  readonly status = signal<SyncStatus>('off');
  readonly room = signal<string | null>(null);
  /** Other phones currently in the room. */
  readonly peers = signal(0);
  /** Seconds spent waiting for a connection; resets once we're live. */
  readonly waitingFor = signal(0);
  readonly available = relayUrl().length > 0;
  readonly live = computed(() => this.status() === 'live');

  /** True once the wait is long enough to be a free-tier cold start. */
  readonly waking = computed(
    () => this.status() !== 'live' && this.status() !== 'off' && this.waitingFor() >= WAKING_AFTER_S,
  );

  /** Ready-made line for the UI: "live · 1 joined", "waking relay · 12s"… */
  readonly label = computed(() => {
    switch (this.status()) {
      case 'live': {
        const peers = this.peers();
        return peers === 0 ? 'live' : `live · ${peers} joined`;
      }
      case 'connecting':
        return this.waking() ? `waking relay · ${this.waitingFor()}s` : 'connecting';
      case 'retrying':
        return `reconnecting · ${this.waitingFor()}s`;
      default:
        return 'offline';
    }
  });

  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Set while the health poll is confirming the service is up. */
  private waker: Promise<void> | null = null;
  private relayUp = false;
  /** Until the relay answers our join we don't know whose state is newer. */
  private joined = false;
  private wantOpen = false;

  constructor() {
    // Any local change is published; remote changes are already everyone's.
    effect(() => {
      const { state, source } = this.store.envelope();
      if (source === 'local' && this.joined && state) this.push(state);
    });

    if (this.available) {
      const saved = sessionStorage.getItem(ROOM_KEY);
      if (saved && isValidRoomCode(saved)) this.join(saved);
    }
  }

  join(code: string): void {
    if (!this.available || !isValidRoomCode(code)) return;
    this.room.set(code);
    try {
      sessionStorage.setItem(ROOM_KEY, code);
    } catch {
      // Non-fatal: the room just won't survive a reload.
    }
    this.wantOpen = true;
    this.attempt = 0;
    this.relayUp = false;
    this.startWaitClock();
    this.open();
    // In parallel, poke the service over HTTP. A sleeping Render instance needs
    // a request to start booting, and this tells us the moment it's ready
    // rather than leaving us to guess with backoff.
    void this.wakeRelay();
  }

  leave(): void {
    this.wantOpen = false;
    this.joined = false;
    this.relayUp = false;
    this.clearTimers();
    this.send({ type: 'leave' });
    this.socket?.close();
    this.socket = null;
    this.room.set(null);
    this.peers.set(0);
    this.waitingFor.set(0);
    this.status.set('off');
    try {
      sessionStorage.removeItem(ROOM_KEY);
    } catch {
      // Nothing to clean up.
    }
  }

  /**
   * Polls the relay's health endpoint until it answers, then connects at once.
   * Free instances sleep, and the first request is what wakes them.
   */
  private async wakeRelay(): Promise<void> {
    if (this.waker) return this.waker;
    const url = healthUrl();
    if (!url) return;

    this.waker = (async () => {
      const deadline = Date.now() + WAKE_BUDGET_MS;
      while (this.wantOpen && !this.relayUp && Date.now() < deadline) {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (response.ok) {
            this.relayUp = true;
            // It's up — don't sit out the remaining backoff.
            if (this.wantOpen && this.status() !== 'live') {
              this.attempt = 0;
              this.open();
            }
            break;
          }
        } catch {
          // Still asleep, or no network. Keep knocking.
        }
        await delay(HEALTH_POLL_MS);
      }
      this.waker = null;
    })();

    return this.waker;
  }

  private open(): void {
    const url = relayUrl();
    const code = this.room();
    if (!this.wantOpen || !url || !code) return;

    this.clearRetry();
    this.clearOpenTimeout();
    this.socket?.close();
    this.status.set(this.attempt === 0 ? 'connecting' : this.status());

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    // A socket to a sleeping instance can hang; don't let it block the retries.
    this.openTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState !== WebSocket.OPEN) socket.close();
    }, OPEN_TIMEOUT_MS);

    socket.addEventListener('open', () => {
      this.clearOpenTimeout();
      this.relayUp = true;
      this.attempt = 0;
      this.send({ type: 'join', room: code });
    });

    socket.addEventListener('message', (event) => this.receive(event.data));

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.clearOpenTimeout();
      this.socket = null;
      this.joined = false;
      this.peers.set(0);
      if (this.wantOpen) {
        this.relayUp = false;
        this.startWaitClock();
        this.scheduleRetry();
        void this.wakeRelay();
      } else {
        this.status.set('off');
      }
    });

    socket.addEventListener('error', () => socket.close());
  }

  private receive(raw: unknown): void {
    let message: {
      type?: string;
      state?: MatchState | null;
      count?: number;
      peers?: number;
      reason?: string;
    };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (message.type) {
      case 'joined': {
        this.joined = true;
        this.status.set('live');
        this.stopWaitClock();
        this.peers.set(Math.max(0, (message.peers ?? 1) - 1));
        const theirs = message.state ?? null;
        const ours = this.store.state();
        // The room's state wins; if the room is empty, seed it with ours.
        if (theirs) this.store.applyRemote(theirs);
        else if (ours) this.push(ours);
        break;
      }
      case 'state':
        if (message.state) this.store.applyRemote(message.state);
        break;
      case 'peers':
        this.peers.set(Math.max(0, (message.count ?? 1) - 1));
        break;
      case 'error':
        // A bad or full room isn't worth hammering; drop back to solo.
        this.leave();
        break;
    }
  }

  private push(state: MatchState): void {
    this.send({ type: 'push', state });
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private scheduleRetry(): void {
    // While the relay is still cold, keep knocking at a steady pace; back off
    // only once we know it's awake and something else is wrong.
    const wait = this.relayUp
      ? RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)]
      : COLD_RETRY_MS;
    this.status.set(this.relayUp && this.attempt > 0 ? 'retrying' : 'connecting');
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.open(), wait);
  }

  private startWaitClock(): void {
    if (this.tickTimer) return;
    this.waitingFor.set(0);
    this.tickTimer = setInterval(() => this.waitingFor.update((s) => s + 1), 1000);
  }

  private stopWaitClock(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.waitingFor.set(0);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearOpenTimeout(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearTimers(): void {
    this.clearRetry();
    this.clearOpenTimeout();
    this.stopWaitClock();
  }
}
