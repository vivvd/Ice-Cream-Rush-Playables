# Ice Cream Rush

An endless time-management game built as a lightweight YouTube Playable. Fill one-to-three-item tickets with custom ice cream, quick sodas, and Bubble Tea before patience runs out. Coins and upgrades persist through YouTube cloud save.

## Commands

- `npm start` — build and serve a production preview at `http://127.0.0.1:4173/`.
- `npm run dev` — local development server with hot reload (persistence remains in memory when the YouTube SDK is unavailable).
- `npm run preview` — serve the already-built `dist/` folder at `http://127.0.0.1:4173/`.

Do not open the source `index.html` through `file://`: browsers block Vite's TypeScript module in that mode. Use `npm start` (or `npm run dev`) and open the HTTP address printed in the terminal.

- `npm test` — deterministic game-logic and SDK-adapter tests.
- `npm run test:e2e` — desktop and mobile browser interaction tests.
- `npm run build` — type-check and build the static production bundle.
- `npm run analyze` — validate bundle names, sizes, SDK order, and paths.
- `npm run thumbnails` — rebuild the three submission thumbnails.
- `npm run package` — create the deterministic hosting ZIP.

## YouTube integration

The Playables SDK is the first script in `index.html`. The game calls `firstFrameReady`, awaits cloud `loadData`, then calls `gameReady`. Cloud save is the only persistent storage; no localStorage, analytics, dynamic remote assets, or off-platform services are used. YouTube pause/resume and audio state are authoritative.

The Developer / Publisher submission field intentionally remains unset in `submission/metadata.md`.
