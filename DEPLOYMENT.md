# Deployment Guide

## Environment Variables

When deploying the Clanker Man Treasury Dashboard (Vercel/Netlify/etc.), ensure these are configured.

### Required Variables (for UI build)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous/public key

### Required Variables (for API routes)
- `SUPABASE_SERVICE_ROLE_KEY` - Required for `/api/trades` (server-side Supabase REST)
- `ALCHEMY_BASE_API_KEY` or `ALCHEMY_API_KEY` - RPC and prices
- `ALCHEMY_PRICE_API_KEY` - Prices API (optional if `ALCHEMY_BASE_API_KEY` is set)
- `WSS_RPC_URL` - WebSocket provider for the listener

### Optional Variables (defaults provided)
- `TREASURY_ADDRESS` (default: `0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6`)
- `BUYBACK_ADDRESS` (default: `0x1195B555885C313614AF705D97db22881D2fbABD`)
- `BNKR_ADDRESS` (default: `0x22af33fe49fd1fa80c7149773dde5890d3c76f3b`)
- `FEE_ACCUM_ADDRESS` (default: `0xaF6E8f06c2c72c38D076Edc1ab2B5C2eA2bc365C`)
- `REALTIME_ENABLED` (default: `false`)
- `API_BASE_URL` (default: empty; only needed if UI and API are on different hosts)
- `BASESCAN_API_KEY` (optional, improves balances; RPC fallback is used)
- `ALCHEMY_WEBHOOK_TOKEN` (required for Notify webhooks)
- `ALCHEMY_WEBHOOK_SIGNING_KEY` (required for Activity webhooks)

## Common Issues

### Values Not Displaying
**Cause:** UI is loading but `/api/trades` is failing.

**Fix:**
1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set in the deployment environment.
2. Redeploy after setting env vars.
3. Test directly:
   - `/api/trades?limit=1`
   - `/api/balances?address=<treasury>`
   - `/api/price?token=usdc`

### Supabase Realtime WebSocket Failures
**Symptoms:** Console shows websocket errors from `realtime/v1/websocket`.

**Fix:**
- Disable realtime for stability:
  - `REALTIME_ENABLED=false`
- If you want realtime, enable replication for the `trades` table in Supabase and confirm RLS policies.

### Listener Healthcheck Warnings
You may see logs like:
```
[listener] warn healthcheck api/price: failed (200) - missing price
[listener] warn healthcheck api/balances: failed (200) - missing native balance
```
These happen when price/balance responses are valid but contain `0` or missing fields.
They are warnings and do not stop the listener.

### WebSocket 403 from Alchemy (Listener)
**Cause:** `WSS_RPC_URL` is invalid or blocked by restrictions.

**Fix:**
- Use this format:
  `wss://base-mainnet.g.alchemy.com/v2/<YOUR_ALCHEMY_API_KEY>`
- Ensure Base Mainnet is enabled for the Alchemy app.
- Remove IP/origin restrictions or whitelist your server.

### Webhook 401 Unauthorized
**Notify webhook** uses token:
- Set `ALCHEMY_WEBHOOK_TOKEN` in env.
- Alchemy webhook must send header:
  `X-Alchemy-Token: <token>`

**Activity webhook** uses signature:
- Set `ALCHEMY_WEBHOOK_SIGNING_KEY` in env.
- Alchemy sends `x-alchemy-signature` automatically.

## Build Process

The build process (`npm run build:ui`) performs the following:
1. Loads environment variables from `.env` (local) or platform env
2. Validates `SUPABASE_URL` and `SUPABASE_ANON_KEY`
3. Replaces placeholders in `web/index.html`
4. Outputs `dist/index.html`

## Testing Locally

```bash
npm install
cp .env.example .env
npm run build:ui
npm run ui
```

## Security Notes

- **Never** commit `.env` files to the repository.
- **Never** inject `SUPABASE_SERVICE_ROLE_KEY` into the frontend build.
- Only use `SUPABASE_ANON_KEY` in the UI HTML.
