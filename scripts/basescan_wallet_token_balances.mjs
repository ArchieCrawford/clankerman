import "dotenv/config";

const CHAIN_ID = process.env.BASE_CHAIN_ID || "8453";

// Etherscan V2 unified endpoint (Base via chainid=8453)
const ETHERSCAN_API_KEY = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || null;
const ETHERSCAN_V2_URL = process.env.BASESCAN_API_URL || process.env.ETHERSCAN_V2_API_URL || "https://api.etherscan.io/v2/api";

// Alchemy (Base)
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || null;
const ALCHEMY_BASE_URL = process.env.ALCHEMY_BASE_URL || "https://base-mainnet.g.alchemy.com";

// RPC
const RPC_URL =
  process.env.RPC_URL ||
  (ALCHEMY_API_KEY ? `${ALCHEMY_BASE_URL}/v2/${ALCHEMY_API_KEY}` : null);

const RPC_OK = typeof RPC_URL === "string" && /^https?:\/\//.test(RPC_URL);

const CLANKER_TOKEN = (process.env.CLANKER_TOKEN || "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb").toLowerCase();
const BNKR_TOKEN = (process.env.BNKR_TOKEN || process.env.BNKR_ADDRESS || "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b").toLowerCase();

const KNOWN_DECIMALS = {
  [CLANKER_TOKEN]: 18,
  [BNKR_TOKEN]: 18,
};

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("Usage:");
  console.log("  node scripts/basescan_wallet_token_balances.mjs <wallet> <tokenContract1> [tokenContract2 ...] [--decimals=18]");
  process.exit(1);
}

const wallet = args[0];
const decimalsArg = args.find((a) => a.startsWith("--decimals="));
const defaultDecimals = decimalsArg ? Number(decimalsArg.split("=")[1]) : null;
const tokenContracts = args.filter((a) => !a.startsWith("--")).slice(1).map((a) => a.toLowerCase());

function isHexAddress(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(x);
}

if (!isHexAddress(wallet)) {
  console.error("Invalid wallet address:", wallet);
  process.exit(1);
}

for (const t of tokenContracts) {
  if (!isHexAddress(t)) {
    console.error("Invalid token contract address:", t);
    process.exit(1);
  }
}

console.log("wallet:", wallet);
console.log("tokens:", tokenContracts);
console.log("alchemy:", ALCHEMY_API_KEY ? `${ALCHEMY_BASE_URL}/v2/<key>` : "(missing)");
console.log("rpc:", RPC_OK ? RPC_URL : "(missing/invalid)");
console.log("etherscan_v2:", ETHERSCAN_V2_URL);
console.log("chainid:", CHAIN_ID);

async function fetchText(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}${text ? " | " + text.slice(0, 200) : ""}`);
  return text;
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  }
}

function formatUnits(raw, decimals) {
  const n = BigInt(raw);
  const neg = n < 0n;
  const s = (neg ? -n : n).toString();
  const d = Number(decimals);

  if (d === 0) return (neg ? "-" : "") + s;

  const pad = d - s.length + 1;
  const whole = pad > 0 ? "0" : s.slice(0, -d);
  const frac = pad > 0 ? "0".repeat(pad) + s : s.slice(-d);
  const fracTrim = frac.replace(/0+$/, "");
  const out = fracTrim.length ? `${whole}.${fracTrim}` : whole;
  return (neg ? "-" : "") + out;
}

// ---------- RPC helpers ----------
async function rpc(method, params) {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const j = await fetchJson(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j.result;
}

async function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

function hexToBigInt(h) {
  if (!h || h === "0x") return 0n;
  return BigInt(h);
}

function decodeUint256(hex) {
  return hexToBigInt(hex).toString();
}

async function fetchDecimalsRpc(contract) {
  if (!RPC_OK) return null;
  try {
    const res = await ethCall(contract, "0x313ce567"); // decimals()
    if (!res || res === "0x") return null;
    const dec = Number(hexToBigInt(res));
    return Number.isFinite(dec) ? dec : null;
  } catch {
    return null;
  }
}

async function fetchBalanceOfRpc(contract) {
  if (!RPC_OK) throw new Error("RPC not configured");
  const addr = wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const data = "0x70a08231" + addr; // balanceOf(address)
  const res = await ethCall(contract, data);
  return decodeUint256(res);
}

// ---------- Alchemy batch balances ----------
async function tokenBalancesAlchemy(contractList) {
  if (!ALCHEMY_API_KEY) return null;

  const url = `${ALCHEMY_BASE_URL}/v2/${ALCHEMY_API_KEY}`;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "alchemy_getTokenBalances",
    params: [wallet, contractList],
  };

  try {
    const j = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (j.error) return null;

    const arr = j.result?.tokenBalances;
    if (!Array.isArray(arr)) return null;

    const map = new Map();
    for (const it of arr) {
      const ca = (it.contractAddress || "").toLowerCase();
      const bal = it.tokenBalance ?? "0";
      map.set(ca, String(bal));
    }
    return map;
  } catch {
    return null;
  }
}

// ---------- Etherscan V2 tokenbalance fallback ----------
async function tokenBalanceEtherscanV2(contract) {
  if (!ETHERSCAN_API_KEY) throw new Error("Missing BASESCAN_API_KEY / ETHERSCAN_API_KEY for Etherscan V2 fallback");

  const url =
    `${ETHERSCAN_V2_URL}` +
    `?chainid=${encodeURIComponent(CHAIN_ID)}` +
    `&module=account&action=tokenbalance` +
    `&contractaddress=${encodeURIComponent(contract)}` +
    `&address=${encodeURIComponent(wallet)}` +
    `&tag=latest` +
    `&apikey=${encodeURIComponent(ETHERSCAN_API_KEY)}`;

  const data = await fetchJson(url);

  // Etherscan style: { status: "1", message: "OK", result: "..." }
  if (data?.status && data.status !== "1") {
    throw new Error(`Etherscan V2 error: ${data?.message || "NOTOK"} | result=${data?.result}`);
  }

  if (data?.result == null) throw new Error("Etherscan V2 returned null result");
  return String(data.result);
}

async function run() {
  const out = [];
  const decimalsCache = new Map();

  const alchemyMap = await tokenBalancesAlchemy(tokenContracts);

  for (const contract of tokenContracts) {
    const key = contract;

    try {
      // 1) Raw balance: Alchemy → RPC → Etherscan V2
      let raw = null;

      if (alchemyMap) {
        raw = alchemyMap.get(key) ?? "0";
      } else if (RPC_OK) {
        raw = await fetchBalanceOfRpc(contract);
      } else {
        raw = await tokenBalanceEtherscanV2(contract);
      }

      raw = raw == null ? "0" : String(raw);

      // 2) Decimals: CLI → known → cache → RPC
      let dec = defaultDecimals ?? null;

      if (dec == null) dec = KNOWN_DECIMALS[key] ?? null;
      if (dec == null && decimalsCache.has(key)) dec = decimalsCache.get(key);

      if (dec == null) {
        const rpcDec = await fetchDecimalsRpc(contract);
        if (rpcDec != null) {
          dec = rpcDec;
          decimalsCache.set(key, dec);
        }
      }

      const formatted = dec == null ? null : formatUnits(raw, dec);

      out.push({
        wallet,
        token: contract,
        raw,
        decimalsUsed: dec,
        formatted,
        source: alchemyMap ? "alchemy_getTokenBalances" : (RPC_OK ? "rpc_balanceOf" : "etherscan_v2_tokenbalance"),
      });
    } catch (e) {
      out.push({ wallet, token: contract, error: e.message });
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
