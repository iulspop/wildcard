# Implement the Wildcard MVP

### Overview

Build Wildcard as a greenfield Remix 3 application deployed as one Cloudflare Worker, with a pure configurable game engine, one hibernating Durable Object per room, D1-backed passkey identity, temporary guest-owned sessions, persistent authenticated rooms, real-time play for 2–8 players, and a responsive mobile-first interface. Keep animation DOM/CSS-based for the MVP; Canvas/WebGL and advanced sound are deferred until the core game is reliable and accessible.

### Complexity Estimate

- **Size**: Large (6+ files; greenfield full-stack application)
- **Risk**: High (real-time authoritative multiplayer, WebAuthn, persistence, and a new framework/runtime integration)
- **Dependencies**: Remix 3’s official Cloudflare adapter/template, Wrangler, Cloudflare Durable Objects with SQLite, Cloudflare D1, a WebAuthn server/browser library compatible with Workers (prefer `@simplewebauthn/server` and `@simplewebauthn/browser` after confirming Remix 3 compatibility), Vitest, and Playwright. Deployment requires a Cloudflare account, a D1 database, configured production RP ID/origin, and Wrangler authentication.

### MVP Decisions and Boundaries

- Use a standard 108-card Uno-style deck represented with Wildcard-owned names and visuals; do not use protected Uno branding or artwork.
- A turn may play one card or a group sharing the same rank/action across colors. The first card must be legal against the discard pile; the rest must match the selected group type.
- `+4` is legal at any time. Pending draw penalties can be passed only by playing the same draw type (`+2` on `+2`, `+4` on `+4`); otherwise the player draws the full stack and loses the turn. Keep these choices in rule configuration so mixed stacking can be added later.
- Resolve grouped action cards in their submitted order and accumulate grouped draw cards. Require a color choice whenever the final effective card is wild.
- Record match wins/losses rather than card-point scoring for the first leaderboard. A disconnect does not immediately remove a seated player; a reconnect token restores the seat.
- A temporary room expires one hour after its last connection closes. Persistent rooms retain completed-match aggregates indefinitely. No public room directory, matchmaking, chat, spectators, bots, installable PWA, push notifications, Canvas/WebGL renderer, or elaborate sound system is included.

### Steps

1. **Files**: `package.json`, Remix application/config files, `wrangler.jsonc`, `tsconfig.json`, `.dev.vars.example`, `.gitignore`
   - **Change**: Scaffold the current official Remix 3 Cloudflare project with TypeScript; configure one Worker entry, static assets, a SQLite Durable Object binding named `GAME_ROOMS`, a D1 binding named `AUTH_DB`, local/preview environments, migrations, type generation, lint/typecheck/test/build/dev/deploy scripts, and documented non-secret environment variables for WebAuthn RP ID/name/origin and session signing.
   - **Why**: Establish one deployable unit with reproducible local development and no services beyond the Cloudflare free-tier primitives.

2. **Files**: `app/domain/game/types.ts`, `app/domain/game/rules.ts`, `app/domain/game/deck.ts`, `app/domain/game/engine.ts`, `app/domain/game/view.ts`, `app/domain/game/*.test.ts`
   - **Change**: Implement a deterministic, side-effect-free game engine covering deck creation/shuffle injection, 2–8 seats, dealing, legal grouped plays, color selection, turn direction, skip/reverse behavior, same-type draw stacking, drawing, win detection, and public/per-player projections that never expose opponents’ hands. Define a versioned `GameRules` configuration and action/event schemas shared by the Worker, Durable Object, and client. Add exhaustive unit tests for the initial rules and malformed/out-of-turn actions.
   - **Why**: Isolate security-critical game behavior from networking and make later game styles/rule variations additive rather than rewrites.

3. **Files**: `migrations/0001_auth.sql`, `app/services/db.server.ts`, `app/services/session.server.ts`, `app/services/passkey.server.ts`, auth route modules under `app/routes/`, auth tests
   - **Change**: Create indexed D1 tables for users, passkey credentials, login challenges, sessions, and owned-room references. Implement registration and authentication option/verification endpoints, secure challenge expiry and one-time consumption, passkey counter updates, signed `HttpOnly`/`Secure`/`SameSite=Lax` sessions, sign-out, and an authenticated-user loader. Derive RP settings from environment configuration and ensure no password/social-login path exists.
   - **Why**: Provide phishing-resistant optional identity while keeping global account lookup separate from room gameplay.

4. **Files**: `app/durable-objects/game-room.ts`, `app/durable-objects/schema.ts`, `app/durable-objects/protocol.ts`, Worker entry/export files, Durable Object tests
   - **Change**: Implement one SQLite-backed `GameRoom` object per opaque room ID. Store room metadata, hashed invite credential, seats/reconnect-token hashes, current game snapshot/version, completed matches, and aggregate standings. Add create/join/start/action/leave/reconnect operations; serialize all mutations through the object; validate every command with the pure engine; persist before broadcasting; provide only recipient-safe state; and use typed protocol messages with version and idempotency/action IDs.
   - **Why**: A room is the natural single-writer authority, eliminating race conditions while keeping traffic and state localized.

5. **Files**: `app/durable-objects/game-room.ts`, room socket/resource routes, lifecycle tests
   - **Change**: Add Cloudflare’s WebSocket Hibernation API, attachment metadata sufficient to restore player identity after wake-up, reconnect/snapshot synchronization, bounded message sizes and per-socket action throttling, server-generated randomness, origin checks, and Durable Object alarms. Delete ownerless room storage one hour after the final disconnect while canceling/postponing expiry on reconnection; never expire persistent room history through this path.
   - **Why**: Deliver reliable real-time play without polling or continuously billed active objects and prevent trivial abuse from exhausting the free plan.

6. **Files**: room creation/join route modules, `app/services/rooms.server.ts`, D1 migration updates if required, integration tests
   - **Change**: Implement room creation for guests and authenticated users, generate unguessable room IDs plus optional high-entropy invite credentials, store only credential hashes, and return invite URLs with credentials in the URL fragment. For authenticated creation, atomically associate the room with its owner in D1 and initialize it as persistent; expose an owner-only room list and protected-room credential verification. Allow every participant to choose a validated room display name without creating an account.
   - **Why**: Support both zero-friction disposable play and owned rooms with lasting identity/history without leaking secrets into request logs.

7. **Files**: `app/routes/_index.tsx`, auth UI routes/components, room lobby routes/components, shared styles and accessible UI primitives
   - **Change**: Build the mobile-first home, passkey register/sign-in controls, temporary/persistent room creation, invite copying, open/protected join flow, display-name entry, 2–8-player lobby, owner start controls, connection/reconnection states, and clear error states. Use semantic HTML, keyboard-visible focus, reduced-motion support, and touch targets suitable for phones.
   - **Why**: Make creating or joining a game require the fewest possible steps while retaining accessible fallback behavior.

8. **Files**: game table route/components/hooks/styles under `app/features/game/`
   - **Change**: Build a responsive game table using HTML/CSS transforms and a WebSocket state hook. Show the local hand, discard/draw piles, active player, direction, opponents as a scrollable/adaptive roster for up to eight players, pending draw total/type, selected same-type card group, wild-color chooser, legal-action feedback, winner state, and reconnect overlay. Animate only client-side state transitions and honor `prefers-reduced-motion`; add minimal optional sound with an explicit mute control and no autoplay dependency.
   - **Why**: Keep eight-player mobile play readable and tactile without adding a heavyweight renderer before gameplay is validated.

9. **Files**: persistent room/leaderboard route modules and components, `app/durable-objects/game-room.ts`, related tests
   - **Change**: On match completion, transactionally increment each named participant’s games, wins/losses, and update timestamps; expose standings through the room object and render wins, losses, games played, and W/L ratio (display undefeated records without division errors). Limit history to aggregates for MVP and restrict persistent-room management to the passkey-authenticated owner.
   - **Why**: Fulfill the lasting-rivalry value proposition without expensive scans or unnecessary event-history storage.

10. **Files**: `tests/e2e/*.spec.ts`, test configuration, CI workflow, `README.md`
    - **Change**: Add local Cloudflare integration/e2e coverage for guest creation and expiry, protected joins, passkey flows using Playwright virtual authenticators, 2–8 clients, reconnects, hidden-hand privacy, stacking/group-play scenarios, match completion, persistent standings, and authorization failures. Document local D1/DO migrations, environment setup, development, verification, preview deployment, production migration/deploy order, free-tier monitoring, and recovery/rollback procedures. Configure CI to run formatting/linting, typecheck, unit/integration tests, build, and critical browser tests without deploying.
    - **Why**: Make the MVP independently reproducible, verify its highest-risk paths, and provide evidence that it is safe to deploy.

### Verification

- Run formatting/linting, TypeScript checks, engine and service unit tests, Durable Object integration tests against the local Cloudflare runtime, the Remix production build, and Playwright browser tests.
- Manually test on narrow mobile viewports and desktop with 2, 4, and 8 simultaneous players: create guest and persistent rooms, join via open/protected links, play grouped cards, stack and collect draw penalties, choose wild colors, disconnect/reconnect, finish games, and confirm standings.
- Inspect WebSocket payloads to verify no opponent hand, reconnect secret, room credential, session secret, or passkey challenge leaks. Verify invite credentials remain in the URL fragment and stored values are hashed.
- Confirm hibernation is enabled, clients never poll, server timers do not keep objects alive, broadcasts occur only for meaningful state changes, SQL queries use indexes, and temporary-room cleanup deletes storage after the configured grace period.
- Deploy first to a Cloudflare preview environment, apply D1 migrations before Worker promotion, register a real passkey on the production-like HTTPS origin, and monitor Worker/DO request counts, CPU, D1 rows read/written, DO storage, exceptions, and WebSocket reconnect rates against free-plan limits.
- Likely failure modes are framework/adapter API changes, WebAuthn RP-origin mismatch, stale reconnect state after object hibernation, duplicate commands during network retries, hidden-card leakage, race conditions around starting/finishing a match, and write amplification. Treat any of these as release blockers.

### Completion Criteria

The MVP is complete when an unauthenticated player can create an expiring room, an authenticated passkey user can create and later reopen a persistent room, up to eight named players can join and complete the configured game over reconnectable hibernating WebSockets, illegal moves are rejected server-side, private hands remain private, protected invite links work, persistent standings survive redeploy/restart, temporary rooms expire, all verification suites pass, and the preview deployment stays within the intended Cloudflare free-tier architecture.
