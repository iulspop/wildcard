# Wildcard

Wildcard is a mobile-first, real-time card game for 2–8 players. It runs as one Remix 3 Cloudflare Worker with one SQLite Durable Object per room and D1-backed, passkey-only optional accounts.

## Architecture

- **Remix 3 Worker** renders the home and room routes and serves JSON APIs.
- **Durable Objects** serialize room mutations, persist game snapshots and standings, and host hibernating WebSockets.
- **D1** stores users, passkeys, sessions, challenges, and authenticated users' owned-room references.
- **Pure game engine** in `app/domain/game/` validates all plays server-side and projects recipient-safe state.
- Temporary guest rooms expire one hour after their final connection closes. Authenticated persistent rooms retain aggregate standings.

## Requirements

- Node.js 24.3+
- pnpm 10.14+
- A modern browser with WebAuthn support for passkey accounts
- A Cloudflare account and Wrangler authentication for preview/production deployment

## Local setup

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Open `http://localhost:8787`. Local passkeys use RP ID `localhost` and origin `http://localhost:8787`.

The non-secret runtime settings are configured in `wrangler.jsonc`. Keep `SESSION_SECRET` in `.dev.vars` locally and use a Cloudflare secret in deployed environments:

```sh
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put SESSION_SECRET --env preview
```

## Commands

```sh
pnpm format:check     # formatting
pnpm lint             # ESLint
pnpm typecheck        # TypeScript
pnpm test             # engine/service unit tests
pnpm test:e2e         # Playwright desktop + mobile tests
pnpm build            # production Worker dry run
pnpm verify           # formatting, lint, types, unit tests, build
```

Install the Playwright Chromium binary once before running browser tests:

```sh
pnpm exec playwright install chromium
```

## Deployment

1. Create D1 databases for production and preview and replace the placeholder IDs in `wrangler.jsonc`.
2. Configure each environment's `PASSKEY_RP_ID`, `PASSKEY_RP_NAME`, and exact HTTPS `PASSKEY_ORIGIN`.
3. Set `SESSION_SECRET` as a Wrangler secret.
4. Apply D1 migrations before promoting the Worker.
5. Deploy preview, verify a real passkey and multiplayer game, then deploy production.

```sh
pnpm exec wrangler d1 migrations apply AUTH_DB --remote --env preview
pnpm deploy:preview
pnpm db:migrate:remote
pnpm deploy
```

For rollback, deploy a previously verified Worker version. D1 migrations are forward-only; make schema changes additive and ship corrective migrations rather than deleting production data. Durable Object storage is room-local and remains across Worker code deployments.

## Security and operations

- Room IDs are high-entropy, unguessable capabilities; anyone with the complete room URL can join.
- Session cookies are signed, `HttpOnly`, `Secure` outside localhost, and `SameSite=Lax`.
- Reconnect tokens, passkey challenges, and opponent hands are never included in public snapshots.
- WebSocket upgrades enforce the configured origin, bounded payloads, and per-socket action throttling.
- Monitor Worker/DO requests and CPU, D1 reads/writes, Durable Object storage, exceptions, and reconnect rates against Cloudflare free-plan limits.

Release blockers include WebAuthn RP/origin mismatch, private-hand leakage, stale reconnect state after hibernation, duplicate-command behavior, match lifecycle races, and unexpected write amplification.
