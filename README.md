# Clanker Man Listener

Local-first swap listener that watches EVM pools over WebSocket, writes swap logs into Supabase, and tracks pending/confirmed status with a last-processed block cursor.

## Quick start

1) Install deps
```bash
npm install
```

2) Copy env
```bash
cp .env.example .env
# fill in your RPC/Supabase values
# add BASESCAN_API_KEY if you want to auto-discover pools
# add BUYBACK_ADDRESS / TREASURY_ADDRESS if you want UI highlights
```

3) Run dev (auto-restart)
```bash
npm run dev
```

4) Required Supabase tables
```sql
create table if not exists public.sync_state (
  key text primary key,
  value text not null
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  chain text not null,
  tx_hash text not null,
  block_number bigint not null,
  block_time timestamptz not null,
  pool_address text not null,
  side text not null default 'unknown',
  clanker_amount numeric null,
  quote_symbol text null,
  quote_amount numeric null,
  maker text null,
  status text not null default 'pending',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists trades_tx_hash_unique on public.trades (tx_hash);
```

Add the RPC the dashboard expects for treasury balances (flows-based; not on-chain balances):

```sql
create or replace function public.get_treasury_balances(addr text)
returns table(
  token_address text,
  token_symbol text,
  amount numeric
)
language sql
stable
as $$
  with base as (
    select
      lower(maker) as maker,
      clanker_amount,
      quote_amount,
      quote_symbol,
      side
    from public.trades
    where maker = lower(addr)
  )
  select null::text as token_address,
         'CLANKER'::text as token_symbol,
         coalesce(sum(case when lower(side) = 'buy' then clanker_amount else -clanker_amount end), 0) as amount
  from base
  where clanker_amount is not null

  union all

  select null::text,
         coalesce(quote_symbol, 'QUOTE'),
         coalesce(sum(case when lower(side) = 'sell' then quote_amount else -quote_amount end), 0)
  from base
  where quote_amount is not null
  group by quote_symbol;
$$;

grant execute on function public.get_treasury_balances(text) to anon, authenticated;
```

Optional: 30d flow history (for charts) — still trades-based, not on-chain balances.

```sql
create or replace function public.get_wallet_flow_history(addr text, days_back int default 30)
returns table(
  bucket date,
  clanker_net numeric,
  quote_symbol text,
  quote_net numeric
)
language sql
stable
as $$
  with base as (
    select
      date_trunc('day', block_time)::date as bucket,
      lower(maker) as maker,
      side,
      clanker_amount,
      quote_amount,
      quote_symbol
    from public.trades
    where maker = lower(addr)
      and block_time >= (now() - (days_back || ' days')::interval)
  )
  select
    bucket,
    coalesce(sum(case when lower(side) = 'buy' then clanker_amount else -clanker_amount end), 0) as clanker_net,
    quote_symbol,
    coalesce(sum(case when lower(side) = 'sell' then quote_amount else -quote_amount end), 0) as quote_net
  from base
  group by bucket, quote_symbol
  order by bucket asc;
$$;

grant execute on function public.get_wallet_flow_history(text, int) to anon, authenticated;
```

## Find pool addresses (Base)

Prereq: set `BASESCAN_API_KEY` in `.env`.

Examples:
```bash
# Quick search vs USDC and WETH across presets (Uniswap V3, Aerodrome, V2-style)
npm run find-pools -- --token=0xYourToken

# Force a preset (amm): base-v3 | aerodrome | base-v2
npm run find-pools -- --token=0xYourToken --preset=base-v3

# Custom factory/topic (V2-style PairCreated topic default shown)
npm run find-pools -- --factory=0xFactory --topic0=0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9 --token0=0xTokenA --token1=0xTokenB
```
Outputs pool addresses with block numbers and (for V3) fee tier; for Aerodrome, stable flag is shown.

## Treasury / buyback helper

Set in `.env`:
- `TREASURY_ADDRESS=0x...` (e.g., 0x8D4aB2A3E89EadfDC729204adF863A0Bfc7746F6)
- `TREASURY_TOKENS=0xTokenA,0xTokenB,...` (ERC20s to check balances)
- `BUYBACK_ADDRESS=0x1195B555885C313614AF705D97db22881D2fbABD` for UI highlighting.

CLI balances and recent trades:
```bash
npm run treasury
```
Shows native + listed token balances and recent trades where `maker` matches TREASURY_ADDRESS.

## Alchemy webhooks (Notify API)

List webhooks:
```bash
npm run alchemy:webhooks -- list
```

Create a webhook using env defaults:
```bash
ALCHEMY_WEBHOOK_URL=https://your-url
ALCHEMY_WEBHOOK_TYPE=ADDRESS_ACTIVITY
ALCHEMY_WEBHOOK_ADDRESSES=0x123,0x456
ALCHEMY_WEBHOOK_NETWORK=BASE_MAINNET
ALCHEMY_WEBHOOK_TOKEN=your_notify_token
npm run alchemy:webhooks -- create
```

Or pass a raw JSON body:
```bash
npm run alchemy:webhooks -- create --body ./webhook.json
```

## What to fill in next
- Provide a pool address and whether it is V2 or V3 so we can decode side/amounts.
- For V3/Aerodrome, swap topics differ; update `SWAP_TOPIC` and parser accordingly.
