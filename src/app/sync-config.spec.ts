import { describe, expect, it } from 'vitest';
import { isValidRoomCode, normaliseRoomCode, randomRoomCode } from './sync-config';

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
