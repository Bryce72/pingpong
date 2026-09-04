import { describe, expect, it } from 'vitest';
import {
  RELAY_URL,
  healthUrl,
  isValidRoomCode,
  normaliseRoomCode,
  randomRoomCode,
  relayUrl,
} from './sync-config';

describe('relay url', () => {
  it('is a websocket url with no trailing slash or path', () => {
    if (!RELAY_URL) return; // sharing intentionally disabled
    expect(RELAY_URL).toMatch(/^wss?:\/\/[^/]+$/);
  });

  it('derives the health endpoint the wake poll fetches', () => {
    if (!RELAY_URL) {
      expect(healthUrl()).toBe('');
      return;
    }
    const expected = RELAY_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    expect(healthUrl()).toBe(`${expected}/healthz`);
    expect(healthUrl()).toMatch(/^https?:\/\/.+\/healthz$/);
  });

  it('reports the configured relay when no override is present', () => {
    expect(relayUrl()).toBe(RELAY_URL);
  });
});

describe('room codes', () => {
  it('generates codes that are valid and unambiguous', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomRoomCode();
      expect(code).toHaveLength(4);
      expect(isValidRoomCode(code)).toBe(true);
      // O/0 and I/1 are too easily misread off a phone screen.
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it('cleans up what someone types', () => {
    expect(normaliseRoomCode(' zx8 4 ')).toBe('ZX84');
    expect(normaliseRoomCode('ab-cd')).toBe('ABCD');
    expect(normaliseRoomCode('abcdefghijk')).toBe('ABCDEFGH');
  });

  it('rejects codes that are too short or malformed', () => {
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('ab cd')).toBe(false);
    expect(isValidRoomCode('ABCD')).toBe(true);
  });
});
