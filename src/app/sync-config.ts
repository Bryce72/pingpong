/**
 * Where the shared-scoreboard relay lives.
 *
 * This is the Render service built from `server/` (see the README). Empty it and
 * the app falls back to being a single-phone scoreboard with the sharing
 * controls hidden — everything else works the same.
 */
export const RELAY_URL = 'wss://pingpong-relay.onrender.com';

/** Codes people have to read off a screen and type on a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, no I/1
const CODE_LENGTH = 4;

export function randomRoomCode(): string {
  const values = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

export function normaliseRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/.test(code);
}

/**
 * The relay URL in force: `?relay=wss://…` wins over the baked-in value, so a
 * local relay can be tested against the deployed app.
 */
export function relayUrl(): string {
  const override = new URLSearchParams(location.search).get('relay');
  return (override ?? RELAY_URL).trim();
}

/**
 * The relay's health endpoint over plain HTTP. Fetching it is what wakes a
 * sleeping free-tier instance, and answering is how we know it's ready.
 */
export function healthUrl(): string {
  const url = relayUrl();
  if (!url) return '';
  return `${url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/+$/, '')}/healthz`;
}
