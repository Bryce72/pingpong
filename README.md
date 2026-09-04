# Ping Pong Scorer

A one-thumb scoreboard for table tennis, built to live on an iPhone home screen.
Angular 21, standalone components, signals, no runtime dependencies beyond Angular.

- **Games to 11** → 3 serves per side. **Games to 21** → 5 serves per side.
- Serve rotation is automatic, including deuce: once both players reach one point
  short of the target, service alternates every point.
- Win by 2. Best of 1 / 3 / 5 / 7.
- Ends swap between games, and at the halfway point of a deciding game.
- Each player owns a colour — cyan and violet — carried through their name, score,
  serve blocks and result card, so there's no doubt which side you're tapping.
- **Single tap** a side to score it. **Double tap** to take a point off — the first
  tap scores immediately so the board stays responsive, and the second undoes it
  and subtracts one. `−` in the corner and `UNDO` do the same thing explicitly.
- Portrait or landscape: two equal halves, score dead centre of each half.
- `BIG` hides the chrome and blows the digits up for reading across the room.
- The match is saved to `localStorage`, so a locked screen or a reload doesn't lose it.
- Holds a **screen wake lock** so the phone doesn't sleep between rallies, and
  re-takes it whenever you come back to the tab or tap the board. `· AWAKE` in the
  header means the lock is actually held. Needs HTTPS and iOS 16.4 or newer; where
  it isn't granted the app works exactly the same, the screen just dims as usual.

## Running it locally

```bash
npm install
npm start
```

Then open http://localhost:4200.

```bash
npm test          # unit tests (vitest) — the serve/scoring rules are covered here
npm run build     # production build
```

## Hosting on GitHub Pages

1. Create an empty repo on GitHub and push this folder to it:

```bash
git remote add origin git@github.com:<you>/<repo>.git && git branch -M main && git push -u origin main
```

2. In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

3. That's it. `.github/workflows/deploy.yml` runs the tests, builds with a relative
   base href (so it works at `https://<you>.github.io/<repo>/`), and publishes on
   every push to `main`.

To build the Pages bundle by hand: `npm run build:pages`, then serve
`dist/pingpong/browser`.

## Shared scoreboard (two or more phones)

**Live at `wss://pingpong-relay.onrender.com`.** The relay is
[`server/`](server/index.js) — a ~150-line WebSocket server that keeps the latest
match state per room and forwards it to everyone else in that room. It holds no
game rules of its own, so it stays a dumb, replaceable pipe.

It deploys itself from this repo: [`render.yaml`](render.yaml) declares a free
Render web service built from `server/` (root directory `server`, `npm install`,
`node index.js`, health check `/healthz`), redeployed on every push to `main`.

To point the app somewhere else, change `RELAY_URL` in
[`src/app/sync-config.ts`](src/app/sync-config.ts) — `wss://`, no trailing slash.
Empty it and the app becomes a plain single-phone scoreboard with the sharing
controls hidden.

**Using it:** on the first phone pick **Share**, note the 4-character code, and start
the match. On any other phone, open the same page, type the code, tap **Join a game**.
Everyone sees the same score, and anyone can tap to score — taps land on every phone
in well under a second. The header shows `CODE · LIVE · n JOINED`.

Notes worth knowing:

- **Free tier sleeps.** After 15 minutes idle Render spins the service down, so the
  first connection of the day can take ~30–60 seconds. The app shows `connecting`
  and keeps retrying; the scoreboard stays fully usable as a local one meanwhile.
- **Reconnects are automatic** with backoff. If the relay restarts, the first phone
  back in re-seeds the room from its own state.
- **Last tap wins.** Phones exchange whole match states rather than individual
  points. Two people tapping at the same instant settle on one result on every
  phone — which is the right answer when both are scoring the same rally.
- **Rooms are ephemeral** — in memory only, dropped 6 hours after the last update.
  Nothing is stored, and no accounts are involved.
- Test against a local relay without redeploying: `cd server && npm install &&
  node index.js`, then open the app with `?relay=ws://localhost:8080`.

## On the phone

Open the Pages URL in Safari → Share → **Add to Home Screen**. It launches
full-screen with no browser chrome, and the dark theme carries into the status bar.

## Where the rules live

All of the scoring logic is in [`src/app/match.ts`](src/app/match.ts) as pure
functions over an immutable `MatchState` — no Angular, no I/O. That's the file to
read (and [`match.spec.ts`](src/app/match.spec.ts) to extend) when you want to
change how serves or games work. `match-store.ts` is the thin signal wrapper that
adds undo and persistence; the components only render.

`sync.ts` sits beside the store rather than inside it: it watches for locally-made
changes and publishes them, and pushes what arrives back in through
`applyRemote()`. Nothing in the scoring logic knows the network exists.

## Possible next step

Reading the score off a wall-mounted scoreboard with the phone's camera would slot
in as an alternative input to `MatchStore.point()` — the state model already
assumes points arrive one at a time from somewhere, so nothing below the store
would need to change.
