import "dotenv/config";

const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;
const BASESCAN_API_URL = process.env.BASESCAN_API_URL || "https://api.basescan.org/api";

if (!BASESCAN_API_KEY) {
  console.error("Missing BASESCAN_API_KEY in .env");
  process.exit(1);
}

const wallet = process.argv[2];
if (!wallet) {
  console.log("Usage: node scripts/basescan_wallet_snapshot.mjs <wallet> [--maxTokens=50]");
  process.exit(1);
}

const maxTokensArg = process.argv.find((a) => a?.startsWith("--maxTokens="));
const maxTokens = maxTokensArg ? Number(maxTokensArg.split("=")[1]) : 50;

function isHexAddress(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(x);
}

if (!isHexAddress(wallet)) {
  console.error("Invalid wallet address:", wallet);
  process.exit(1);
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} | ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 300)}`);
  }
}

async function getErc20Transfers() {
  const url =
    `${BASESCAN_API_URL}` +
    `?module=account&action=tokentx` +
    `&address=${encodeURIComponent(wallet)}` +
    `&startblock=0&endblock=99999999` +
    `&page=1&offset=10000` +
    `&sort=desc` +
    `&apikey=${encodeURIComponent(BASESCAN_API_KEY)}`;

  const data = await fetchJson(url);

  if (data?.message === "No transactions found") return [];

  if (data?.status !== "1") {
    throw new Error(`BaseScan tokentx error: ${data?.message || "Unknown"} | result=${JSON.stringify(data?.result)}`);
  }

  return Array.isArray(data?.result) ? data.result : [];
}

async function tokenBalance(contract) {
  const url =
    `${BASESCAN_API_URL}` +
    `?chainid=${encodeURIComponent(CHAIN_ID)}` +
    `&module=account&action=tokenbalance` +
    `&contractaddress=${encodeURIComponent(contract)}` +
    `&address=${encodeURIComponent(wallet)}` +
    `&tag=latest` +
    `&apikey=${encodeURIComponent(BASESCAN_API_KEY)}`;

  const data = await fetchJson(url);

  if (data?.status !== "1") {
    throw new Error(`BaseScan tokenbalance error: ${data?.message || "Unknown"} | result=${JSON.stringify(data?.result)}`);
  }

  return data.result;
}

async function run() {
  const transfers = await getErc20Transfers();

  const tokenMap = new Map();
  for (const tx of transfers) {
    const ca = tx.contractAddress;
    if (isHexAddress(ca) && !tokenMap.has(ca)) {
      tokenMap.set(ca, {
        contract: ca,
        symbol: tx.tokenSymbol || null,
        name: tx.tokenName || null,
        decimals: tx.tokenDecimal != null ? Number(tx.tokenDecimal) : null,
      });
      if (tokenMap.size >= maxTokens) break;
    }
  }

  const tokens = Array.from(tokenMap.values());

  const balances = [];
  for (const t of tokens) {
    try {
      const raw = await tokenBalance(t.contract);
      if (BigInt(raw) !== 0n) {
        balances.push({ ...t, raw });
      }
    } catch (e) {
      balances.push({ ...t, error: e.message });
    }
  }

  console.log(
    JSON.stringify(
      {
        wallet,
        discoveredTokens: tokens.length,
        nonZeroOrErrored: balances.length,
        balances,
      },
      null,
      2
    )
  );
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
