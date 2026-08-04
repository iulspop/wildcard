# Implement Race-Safe UNO Calling and Catching

### Overview

Add an authoritative UNO declaration state machine to the existing pure game engine and `GameRoom` Durable Object. A play that leaves exactly one card opens a server-generated, claim-specific UNO opportunity; the exposed player receives a short owner-first declaration grace period, while other seated players may catch that exact claim afterward for a four-card penalty. Claims expire on the next successfully accepted gameplay action or whenever the target no longer has exactly one card, including draws, penalties, and game completion. Durable Object serialization, claim IDs, server time, idempotent action IDs, and a dedicated UNO rate limit ensure that simultaneous calls resolve deterministically and that pre-click catch spam cannot win with queued stale commands.

### Complexity Estimate

- **Size**: Medium (approximately 8 existing files)
- **Risk**: Medium — modifies authoritative game transitions, permits interrupt actions outside normal turn order, changes persisted game snapshots, and adds realtime controls.
- **Dependencies**: No new packages, external services, or database migration. Persisted JSON snapshots require load-time defaults for the new fields. Use the existing Durable Object, WebSocket, Vitest, and Playwright infrastructure.

### Steps

1. **File**: `app/domain/game/types.ts`, `app/domain/game/rules.ts`, `app/domain/game/test-helpers.ts`
   **Change**: Define `UnoClaim` with a cryptographically unpredictable claim ID, target player ID, opening action sequence, and server-authored `catchableAt` deadline. Add `unoClaim` and a monotonic `actionSequence` to `GameState`; add `call-uno` and `catch-uno` actions, with `catch-uno` requiring the exact claim ID. Add configurable defaults for UNO support, the four-card catch penalty, and a short owner-first grace period (750 ms), while normalizing older rule/state fixtures that lack the fields. Extend game events and rule error codes for opened, called, caught, stale, too-early, and self-catch outcomes.
   **Why**: A claim-specific state contract makes the race explicit, preserves the engine’s configurability, and prevents commands queued before the one-card play from applying to a newly opened opportunity.

2. **File**: `app/domain/game/engine.ts`
   **Change**: Extend deterministic action options with injectable server time and claim-ID generation. Process `call-uno` and `catch-uno` as authenticated interrupt actions that do not require the caller to own the current turn. On a successful play/draw/pass, expire any older unanswered claim before applying the transition; after a play, open a fresh claim only when the player has exactly one card, and clear claims when the target’s hand is no longer one card or the game finishes. Validate self-calls, other-player catches, exact claim IDs, grace deadlines, and target hand count. A valid catch draws the configured four-card penalty for the target without changing the current turn or pending draw stack. Preserve immutable transitions and reject invalid commands without expiring or otherwise mutating the authoritative claim.
   **Why**: Centralizing lifecycle rules in the pure engine makes all HTTP and WebSocket paths consistent and guarantees that forgotten claims cannot survive continued play, a later draw, a penalty, or a win.

3. **File**: `app/domain/game/view.ts`, `app/durable-objects/game-room.ts`
   **Change**: Project only public UNO metadata (`id`, target player ID, and `catchableAt`) into every recipient-safe `GameView`. Supply `Date.now()` and `crypto.randomUUID()` from the Durable Object when applying actions. Normalize persisted snapshots created before UNO support by initializing missing claim/action-sequence/rule fields, and ensure start, restart, finished-game, and return-to-lobby flows cannot retain stale claims. Keep persistence-before-broadcast behavior and existing `processed_actions` idempotency.
   **Why**: Every client needs the authoritative claim identity and deadline but no additional private hand information; load compatibility avoids breaking active or persistent rooms after deployment.

4. **File**: `app/durable-objects/game-room.ts`
   **Change**: Add a dedicated per-socket UNO-command rate window (initially 3 attempts per second) alongside the current general 20-message/10-second limit, with backward-compatible defaults for hibernated socket attachments. Parse enough of an incoming action to reject excessive `call-uno`/`catch-uno` traffic before loading and mutating room state. Never queue early catches for later execution: stale claim IDs and catches received before `catchableAt` return errors immediately. Continue overriding client identity from the authenticated socket attachment, and require that callers/catchers are active room seats.
   **Why**: Claim IDs defeat pre-click races; the narrower rate limit bounds abusive traffic and prevents repeated invalid catch attempts from monopolizing room processing.

5. **File**: `app/ui/scaffold-home-page.tsx`, `public/app.js`, `public/app.css`
   **Change**: Add an accessible UNO action area to the game table. Show a prominent **UNO!** button only to the exposed player while their claim is open; show **Catch UNO** to other players, disabled until the server deadline and enabled by a local display timer without treating the client clock as authoritative. Every command must carry the currently rendered claim ID, disable after one click until the next snapshot, and never auto-retry. Render who is vulnerable/called/caught through the existing live status/toast patterns, clear controls when the claim changes or expires, and keep the layout usable on mobile. Do not expose or infer hidden cards beyond existing public card counts.
   **Why**: The controls clearly communicate the short declaration race while ensuring the browser cannot manufacture authority or reuse a stale opportunity.

6. **File**: `app/domain/game/engine.test.ts`, `app/domain/game/view.test.ts`
   **Change**: Add deterministic unit tests using injected time and claim IDs for: opening a claim at one card; no claim at zero cards; owner calls during grace; catches rejected during grace; valid four-card catches after grace; stale/wrong claim IDs; self-catch and non-target call rejection; first valid call/catch winning; duplicate commands remaining idempotent at the room layer; unanswered claims expiring on the next successful play/draw/pass but not on rejected actions; target draws or receives cards; game completion; grouped plays ending at one card; and public projection without private hand leakage.
   **Why**: These tests define the state machine and cover the exact race, lifecycle, and privacy failures discussed.

7. **File**: `tests/e2e/wildcard.spec.ts`
   **Change**: Extend the existing realtime helpers and game-state test type for UNO metadata. Add a multi-client scenario that drives a player to one card, verifies the owner-first grace period, sends many pre-created stale catch commands around the one-card play and confirms none can claim the new ID, then races valid claim-bound calls/catches and asserts exactly one authoritative outcome and one penalty. Also cover both players forgetting while the next gameplay action expires the claim, a target later drawing to two cards, winning with no stale claim, reconnect snapshots preserving an active claim, and visible/disabled mobile and desktop controls.
   **Why**: Durable Object/WebSocket integration coverage proves serialization and anti-spam behavior under real command ordering rather than only testing pure transitions.

### Verification

- Run `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`.
- Run `pnpm test` and confirm all engine, view, service, and compatibility tests pass.
- Run focused Chromium Playwright coverage for the realtime UNO race first, then `pnpm test:e2e` across desktop and mobile.
- Run `pnpm build` / Wrangler dry-run and confirm no binding or Durable Object migration is introduced.
- Manually verify with two browser sessions that: the exposed player sees **UNO!** immediately; catchers cannot act during the 750 ms grace period; stale pre-clicks never catch a fresh claim; a valid post-grace catch adds exactly four cards; the next accepted gameplay action removes an ignored opportunity; drawing or winning leaves no stale controls; and reconnecting receives the current authoritative claim.
- Check that invalid or early catch spam receives bounded errors without changing room version/game state, that duplicate action IDs cannot apply a second penalty, and that all race decisions use Durable Object processing order/server time rather than client timestamps.
- Main risks: flaky timing assertions (use injected clocks in unit tests and generous polling in E2E), old persisted snapshots missing new fields, hibernated socket attachments missing UNO counters, and automated game-completion helpers needing to call UNO or intentionally advance past claims.
