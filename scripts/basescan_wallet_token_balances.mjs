import "dotenv/config";

const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;
const BASESCAN_API_URL = process.env.BASESCAN_API_URL || "https://api.etherscan.io/v2/api";
const CHAIN_ID = process.env.BASE_CHAIN_ID || "8453";
const CLANKER_TOKEN = (process.env.CLANKER_TOKEN || "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb").toLowerCase();
const BNKR_TOKEN = (process.env.BNKR_ADDRESS || "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b").toLowerCase();

// Known decimals to format output when --decimals is omitted.
const KNOWN_DECIMALS = {
  [CLANKER_TOKEN]: 18,
  [BNKR_TOKEN]: 18
};

if (!BASESCAN_API_KEY) {
  console.error("Missing BASESCAN_API_KEY in .env");
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("Usage:");
  console.log("  node scripts/basescan_wallet_token_balances.mjs <wallet> <tokenContract1> [tokenContract2 ...] [--decimals=18]");
  process.exit(1);
}

const wallet = args[0];
const decimalsArg = args.find((a) => a.startsWith("--decimals="));
const defaultDecimals = decimalsArg ? Number(decimalsArg.split("=")[1]) : null;
const tokenContracts = args.filter((a) => !a.startsWith("--")).slice(1);

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

console.log("Fetching balances for wallet", wallet, "and tokens", tokenContracts);

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatUnits(raw, decimals) {
  const s = BigInt(raw).toString();
  if (decimals === 0) return s;
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;

  const pad = decimals - digits.length + 1;
  const whole = pad > 0 ? "0" : digits.slice(0, -decimals);
  const frac = pad > 0 ? "0".repeat(pad) + digits : digits.slice(-decimals);

  const fracTrim = frac.replace(/0+$/, "");
  const out = fracTrim.length ? `${whole}.${fracTrim}` : whole;
  return neg ? `-${out}` : out;
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
    const msg = data?.message || "Unknown error";
    const result = data?.result ? ` | result=${data.result}` : "";
    throw new Error(`BaseScan error: ${msg}${result}`);
  }

  return data.result;
}

async function run() {
  const out = [];

  for (const contract of tokenContracts) {
    try {
      const raw = await tokenBalance(contract);
      const dec = defaultDecimals ?? KNOWN_DECIMALS[contract.toLowerCase()] ?? null;
      out.push({
        wallet,
        token: contract,
        raw,
        formatted: dec == null ? null : formatUnits(raw, dec),
        decimalsUsed: dec,
      });
    } catch (e) {
      out.push({
        wallet,
        token: contract,
        error: e.message,
      });
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

run();
