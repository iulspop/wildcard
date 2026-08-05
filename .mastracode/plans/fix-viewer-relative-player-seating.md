# Fix Viewer-Relative Player Seating

### Overview

Keep the randomized circular player order established when a match starts, but rotate its presentation for each viewer so the local player sits conceptually between the rightmost and leftmost opponents. Opponent slots remain fixed for the match; clockwise turns traverse those slots left-to-right, counterclockwise turns traverse them right-to-left, and Reverse changes only traversal direction—not player placement.

### Complexity Estimate

- **Size**: Medium (3 files)
- **Risk**: Low (changes player-safe presentation metadata and browser ordering without changing authoritative turn logic)
- **Dependencies**: None; no migration or external service changes.

### Steps

1. **File**: `app/domain/game/view.ts:17-69`
   **Change**: Replace the direction/current-turn-derived `upcomingPlayerIds` projection with fixed viewer-relative seating metadata. Find the viewer in the authoritative randomized `state.players` ring, rotate the ring so opponents following that viewer occupy stable left-to-right slots, exclude the viewer, and expose the result under a seating-oriented field name. Keep `direction` and `currentPlayerId` separate so the client can show clockwise/counterclockwise progression without reordering slots. Preserve a safe deterministic fallback if a projection is ever requested without a matching viewer.
   **Why**: The current projection begins at the active player and follows `state.direction`, causing opponents to jump slots on every turn and Reverse. Seating must derive only from the match’s fixed circular player order and the viewer’s position.

2. **File**: `public/app.js:352-406`
   **Change**: Replace `opponentsInUpcomingTurnOrder()` with a fixed-seating renderer that maps the new viewer-relative seat IDs to player views. Continue marking the active opponent in place and showing the existing direction label; do not reverse or rotate DOM order when turns advance or direction changes.
   **Why**: Stable DOM order makes the local player the implicit ring boundary after the rightmost opponent and before the leftmost opponent, while the active badge visually travels left-to-right for clockwise play and right-to-left for counterclockwise play.

3. **File**: `app/domain/game/view.test.ts:20-43`
   **Change**: Replace upcoming-turn-order assertions with viewer-relative ring tests for multiple viewers. Verify each viewer gets the same circular player order rotated around themselves, changing `currentPlayerIndex` does not move slots, and changing `direction` does not move slots. Assert that clockwise and counterclockwise remain represented by the separate direction field.
   **Why**: These tests lock in the intended point-of-view invariant and prevent future turn or Reverse logic from reordering opponents.

### Verification

- Run `pnpm format:check`.
- Run `pnpm lint` and `pnpm typecheck`.
- Run `pnpm test`, including the updated player-view ordering tests.
- Run `pnpm build` for a Wrangler production dry run.
- Manually inspect a 4+ player room from at least two player sessions: confirm each viewer sees the same ring rotated around themselves, opponent slots do not move as turns advance, clockwise activity proceeds left-to-right, and Reverse makes activity proceed right-to-left without rearranging cards.
- Check small mobile layouts with 7 opponents to ensure the existing horizontal scrolling/centering behavior still works.
- Main risk: choosing the wrong ring orientation would invert the visual meaning of clockwise; the deterministic tests and two-viewer manual check must verify the agreed left-to-right clockwise convention.
