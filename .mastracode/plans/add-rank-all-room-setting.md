# Add Configurable Rank-All Matches

### Overview

Add a persisted, host-controlled room setting for match completion: the existing `first-out` mode ends when the first player empties their hand, while `rank-all` records finishers in order, keeps them connected as spectators in their fixed seats, skips them during subsequent turns, and ends by automatically placing the final active player. Keep one lifetime standings table rather than creating a separate leaderboard: first place remains a win, every other placement remains a loss for compatibility, and placement totals/best/average add the detail needed for rank-all results.

### Complexity Estimate

- **Size**: Large (engine, Durable Object protocol/storage, UI, and tests; 8+ files)
- **Risk**: High (changes authoritative turn advancement, match completion, persistence, and standings recording)
- **Dependencies**: No new packages or external services. Existing Durable Object SQLite instances require additive, constructor-managed schema upgrades; no D1 migration is needed.

### Steps

1. **Files**: `app/domain/game/types.ts`, `app/domain/game/rules.ts`, `app/domain/game/test-helpers.ts`
   - **Change**: Add `finishMode: "first-out" | "rank-all"` to `GameRules`, defaulting to `first-out`; add ordered `finishOrder` state and player-finished/placement event metadata. Initialize new games and test states consistently, validate the setting, and normalize missing values in older rule objects to preserve existing snapshots.
   - **Why**: The authoritative engine needs an explicit, backward-compatible rule and ordered result model instead of overloading the single `winnerId`.

2. **Files**: `app/domain/game/engine.ts`
   - **Change**: Preserve current first-winner behavior in `first-out`. In `rank-all`, append a player to `finishOrder` when their hand reaches zero, clear any UNO/drawn-card state involving that player, and continue unless only one active player remains. Add active-player traversal helpers so normal turns, skip cards, Reverse, draw penalties, and drawn-card decisions bypass finished players without reordering the fixed player ring. When one active player remains, append that player automatically, set `winnerId` to the first finisher for compatibility, and mark the game finished. Reject ordinary gameplay actions from finishers while retaining claim-specific UNO behavior only where still valid.
   - **Why**: Sequential placement must remain deterministic across all action-card and direction cases, and finished players must become spectators without being removed from the game.

3. **Files**: `app/domain/game/view.ts`, `app/domain/game/view.test.ts`
   - **Change**: Project `finishMode`, public `finishOrder`/placement data, and per-player finished placement in `GameView`. Keep `seatedOpponentIds` based on the original randomized ring so finishers remain in fixed slots. Expose a hand only to its owner as today, produce playable IDs only for an active current player, and add privacy/stable-seating coverage for active players and spectators.
   - **Why**: Every client needs authoritative live placements and spectator status without leaking cards or destabilizing the viewer-relative seating layout.

4. **Files**: `app/durable-objects/protocol.ts`, `app/durable-objects/schema.ts`, `app/durable-objects/game-room.ts`
   - **Change**: Define a public `RoomSettings` model with `finishMode`, include it in room snapshots, and add a host-only lobby `update-settings` command to the HTTP/WebSocket dispatch and allowlist. Persist settings in `room_metadata` (as a settings JSON value suitable for future room rules), add constructor-time `PRAGMA`/`ALTER TABLE` compatibility for existing Durable Object databases, and default old rooms to `first-out`. Lock the persisted room setting into `GameState.rules` at start/restart instead of accepting an arbitrary client-supplied rules object. Reject setting changes while any game snapshot exists, bump room version, and broadcast the new setting to all seats.
   - **Why**: Settings must survive reconnects and room reopening, be visible to everyone, remain host-controlled, and become immutable for the duration of a match.

5. **Files**: `app/durable-objects/schema.ts`, `app/durable-objects/game-room.ts`, `app/durable-objects/protocol.ts`
   - **Change**: Extend completed match persistence to retain the ordered placement result while keeping `winner_player_id` as first place. Add `total_placement` and nullable `best_placement` to standings with additive compatibility upgrades; each completed match increments games, gives first place one win and all others one loss, and updates placement totals/best for every participant. Expose `totalPlacement`, `bestPlacement`, and derived `averagePlacement` in `RoomStanding`, sorting primarily by wins and then average placement/best placement with a deterministic name tie-breaker. Ensure normal completion records exactly once and owner “Stop game” continues to record nothing.
   - **Why**: A single leaderboard preserves the established W/L meaning while accurately representing rank-all performance and retaining complete match history.

6. **Files**: `app/ui/scaffold-home-page.tsx`, `public/app.js`, `public/app.css`
   - **Change**: Add an accessible lobby settings control explaining “First player out” versus “Rank every player.” Show it as editable only to the host before a match and read-only to other players, submit changes authoritatively, and reflect synchronized updates. During rank-all play, mark finishers and their placement in their fixed opponent/local-player slots, disable their gameplay controls, identify them as spectating, show the live finish order, and announce each finish. On completion, render the full ordered result. Extend the existing standings table with best and average finish while retaining W/L columns.
   - **Why**: Players need to understand the selected mode before starting, see who has finished during play, and interpret placement-aware lifetime results without a second competing leaderboard.

7. **Files**: `app/domain/game/engine.test.ts`, `app/domain/game/view.test.ts`, focused Durable Object/service test modules as needed
   - **Change**: Add deterministic tests for first-out compatibility; 2-, 3-, and 8-player rank-all completion; sequential and automatic-last placement; skipping finishers in both directions; Skip/Reverse/grouped action behavior near finished seats; pending draw targeting only active players; winner/UNO edge cases; spectator action rejection; snapshot normalization; settings authorization/locking/persistence; exactly-once match recording; placement aggregation; and stop-game non-recording.
   - **Why**: Most risk is in authoritative lifecycle and turn traversal, which should be proven without timing-dependent browser tests.

8. **Files**: `tests/e2e/wildcard.spec.ts`, `README.md`
   - **Change**: Add a focused multi-client Playwright scenario that changes the lobby setting as host, verifies non-host denial/read-only UI, starts a rank-all match, observes the first finisher remain in place as a spectator, completes all placements, and checks the placement-aware standings after reconnect. Update documentation with finish-mode semantics, settings ownership/locking, and the unified leaderboard definition.
   - **Why**: End-to-end coverage proves protocol, realtime synchronization, UI state, persistence, and standings work together as users experience them.

### Verification

- Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- Run focused engine/view/Durable Object tests while developing, then `pnpm test:e2e` with the existing single-worker configuration.
- Run `pnpm build` (or `pnpm verify`) and `git diff --check`.
- Manually verify a 4+ player room in two browser sessions: only the host can change settings; all clients see the selected mode; the setting locks after start; first finishers remain connected in fixed seats; clockwise/counter-clockwise turns skip them; the last active player is placed automatically; reconnect restores live placements; and the final standings show correct W/L, best, and average placement.
- Regression-check `first-out`, Play again, Return to lobby, Stop game, UNO claims, drawn-card stacking, fixed opponent seating, kick/rejoin, and persistent-room reopening.
- Key failure risks: advancing onto a finished player, applying Skip/draw penalties with the wrong active-player distance, recording a match more than once, malformed legacy snapshots/settings, schema upgrades racing room initialization, placement stats drifting from completed results, or spectators retaining enabled action controls.
