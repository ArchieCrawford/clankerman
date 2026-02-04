# Clanker Man Listener - App README and Runbook

## Changelog
- 2026-02-04: Initial app runbook and file-by-file breakdown.

## Overview
This repo runs the Clanker Man listener and dashboard stack:
- A Node listener subscribes to Base chain swap logs, backfills history, and writes trades into Supabase.
- API endpoints provide price, balances, and webhook ingestion for Alchemy Notify webhooks.
- A lightweight UI (static HTML + JS) reads Supabase and the API endpoints to render the dashboard.

Key behaviors:
- Swap logs are parsed into standardized trade rows stored in the `trades` table.
- The listener maintains a `sync_state` cursor to resume backfills.
- Webhook payloads (Alchemy Notify) can be stored in `webhook_events`.
- The UI polls prices/balances and subscribes to realtime inserts.

## Directory tree (top level)
```
.
├─ api/                    # Vercel serverless wrappers (must keep /api/*.js paths)
├─ migrations/             # Supabase SQL migration notes
├─ scripts/                # Local utilities, UI server, API tests
├─ src/                    # Core app code (config, lib, services, api handlers)
├─ web/                    # Static UI
├─ index.js                # Listener entrypoint
├─ package.json            # Scripts and deps
├─ vercel.json             # Vercel routing/headers
└─ README.md               # Project README
```

## Runbook

### Prerequisites
- Node 18+ (fetch and AbortController are required)
- Supabase project
- Alchemy Base API access (RPC + Prices + Notify webhooks)
- Optional: BaseScan API key
- Optional: CoinMarketCap API key (price fallback)

### Environment setup
Copy `.env.example` to `.env` and fill in values.

Required for most workflows:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY (server) or SUPABASE_ANON_KEY (UI)
- ALCHEMY_BASE_API_KEY (RPC)
- ALCHEMY_PRICE_API_KEY (Prices)
- WSS_RPC_URL (WebSocket provider for listener)
- CLANKER_TOKEN, WETH_TOKEN, USDC_TOKEN
- TREASURY_ADDRESS

Recommended/optional:
- ALCHEMY_WEBHOOK_SIGNING_KEY (validates Notify signatures)
- ALCHEMY_WEBHOOK_TOKEN (validates Notify ingest token)
- BASESCAN_API_KEY (balance fallback)
- CMC_API_KEY (CoinMarketCap price fallback)
- BUYBACK_ADDRESS, BNKR_ADDRESS, FEE_ACCUM_ADDRESS
- HEALTHCHECK_BASE_URL (listener health checks)

### Start the listener
```
npm run dev
```
- Watches swap logs and writes to Supabase.
- Runs endpoint health checks if `HEALTHCHECK_BASE_URL` is set.

### Start the UI (local dev)
```
npm run ui
```
- Serves `web/index.html` with injected env values.
- Mounts API endpoints for local testing.

### Build the UI
```
npm run build:ui
```
- Copies `web/` into `dist/` for hosting.

### Run API checks
```
node scripts/test_apis.mjs
```
- Validates `/api/price`, `/api/balances`, and webhook routes.

### Create/list Alchemy Notify webhooks
```
# list
npm run alchemy:webhooks -- list

# create from env
npm run alchemy:webhooks -- create
```

## API endpoints

### GET /api/price
- Query: `token=clanker|bnkr|weth|usdc` and `range=4h|24h|7d|30d`
- Response: `{ price, history, source }`
- Uses Alchemy Prices; WETH can fall back to CoinMarketCap; USDC returns static 1.

### GET /api/balances
- Query: `address=0x...` (optional, falls back to TREASURY_ADDRESS)
- Response: `{ native, tokens: [...] }`
- Uses BaseScan first, falls back to Alchemy RPC.

### POST /api/webhook
- Alchemy activity webhook endpoint
- Requires `x-alchemy-signature` when `ALCHEMY_WEBHOOK_SIGNING_KEY` is set

### POST /api/webhooks/alchemy
- Alchemy Notify ingest endpoint (stores payload to Supabase)
- Requires `x-alchemy-token` or `x-webhook-token` (or `?token=`) when `ALCHEMY_WEBHOOK_TOKEN` is set

## Data model (Supabase)
- `trades`: swap events (pending/confirmed)
- `sync_state`: listener cursors (e.g., last processed block)
- `webhook_events`: raw webhook payloads

## File breakdown

### Root
- `index.js`: Listener entrypoint. Connects to WebSocket RPC, backfills logs, inserts trades, confirms them after N blocks.
- `package.json`: Scripts (`dev`, `ui`, `build:ui`, `alchemy:webhooks`) and dependencies.
- `vercel.json`: Vercel config for API routes.
- `README.md`: General project notes.

### api/ (Vercel wrappers)
- `api/price.js`: Exports `src/api/priceHandler.js`.
- `api/balances.js`: Exports `src/api/balancesHandler.js`.
- `api/webhook.js`: Exports `src/api/webhookHandler.js`.
- `api/webhooks/alchemy.js`: Exports `src/api/alchemyWebhookIngestHandler.js`.

### src/config/
- `env.js`: Central env parsing/validation and config object.
- `alchemy.js`: Alchemy endpoint helpers.
- `explorers.js`: BaseScan/Etherscan config.
- `webhooks.js`: Webhook configuration.
- `supabase.js`: Supabase client helpers.

### src/lib/
- `logger.js`: Scoped logger with timestamps + debug filter.
- `errors.js`: AppError and normalization helper.
- `http.js`: `fetchJson` with timeouts and no-store cache.
- `validate.js`: env + address helpers.

### src/services/
- `alchemy/rpc.js`: JSON-RPC calls + retry + timeout.
- `alchemy/prices.js`: Alchemy price + history.
- `alchemy/webhooks.js`: signature/token verification.
- `alchemy/sockets.js`: WebSocket provider lifecycle + reconnect.
- `explorers/etherscanV2.js`: Etherscan-style client with retries.
- `explorers/basescan.js`: BaseScan balance helpers + RPC fallback.
- `supabase/client.js`: Singleton admin client.
- `supabase/trades.js`: Insert trades + confirm.
- `supabase/syncState.js`: Read/write sync cursor.
- `swaps.js`: Pool meta cache, swap parsing, amount derivation.
- `pricing/coinmarketcap.js`: CoinMarketCap price fallback.
- `health/endpointChecks.js`: Local/API health check runner.

### src/api/
- `priceHandler.js`: Handles `/api/price`.
- `balancesHandler.js`: Handles `/api/balances`.
- `webhookHandler.js`: Alchemy activity webhook logic.
- `alchemyWebhookIngestHandler.js`: Notify webhook ingest.

### web/
- `index.html`: Dashboard UI (Supabase + API polling).
- `styles/main.css`: Dashboard styles.

### scripts/
- `serve-ui.js`: Local UI server + API mount points.
- `build-ui.js`: Copies UI to `dist/`.
- `test_apis.mjs`: Health test script.
- `alchemy_notify.mjs`: List/create Alchemy Notify webhooks.
- Other scripts (pool discovery, treasury watch, snapshots) for local ops.

### migrations/
- `README.md`: Notes for SQL migrations (Supabase CLI/manual).

## Troubleshooting
- 401 on webhook POST: missing `ALCHEMY_WEBHOOK_SIGNING_KEY` or `ALCHEMY_WEBHOOK_TOKEN` headers.
- 500 on /api/price: missing ALCHEMY_PRICE_API_KEY or unsupported token.
- /api/* returns HTML: UI server fallback is catching the route; restart `npm run ui`.
- /api/balances timeout: check BaseScan key or RPC latency.

## Operational notes
- Use `DEBUG=1` or `DEBUG=scope` to enable debug logs.
- The listener runs indefinitely; deploy it as a long-running process.
- API routes are serverless on Vercel and must keep the `/api/*.js` paths.
