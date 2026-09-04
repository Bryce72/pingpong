import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { MatchStore } from './match-store';
import { DEFAULT_CONFIG } from './match-store';

describe('App', () => {
  beforeEach(async () => {
    // The test environment's localStorage is a partial stub, so guard the reset.
    try {
      localStorage.clear?.();
    } catch {
      /* nothing persisted to clear */
    }
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('starts on the setup screen', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-setup')).toBeTruthy();
    expect(el.querySelector('app-scoreboard')).toBeNull();
  });

  it('shows the scoreboard once a match starts', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(MatchStore).start(DEFAULT_CONFIG);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-scoreboard')).toBeTruthy();
  });
});
