import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatchStore } from './match-store';
import { Scoreboard } from './scoreboard';
import { Setup } from './setup';

@Component({
  selector: 'app-root',
  imports: [Scoreboard, Setup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.state()) {
      <app-scoreboard />
    } @else {
      <app-setup />
    }
  `,
})
export class App {
  readonly store = inject(MatchStore);
}
