import "dotenv/config";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_BASE_URL = process.env.ALCHEMY_BASE_URL || "https://base-mainnet.g.alchemy.com";
const RPC_URL = `${ALCHEMY_BASE_URL}/v2/${ALCHEMY_API_KEY}`;

const CLANKER_TOKEN = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb".toLowerCase();

const wallet = process.argv[2];

if (!ALCHEMY_API_KEY) {
  console.error("Missing ALCHEMY_API_KEY");
  process.exit(1);
}

if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  console.error("Usage: node clanker_balance.mjs <wallet>");
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

function formatUnits(raw, decimals) {
  const s = BigInt(raw).toString();
  if (decimals === 0) return s;
  const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
  const frac = s.padStart(decimals + 1, "0").slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

async function getTokenMetadata() {
  const url = `${ALCHEMY_BASE_URL}/v2/${ALCHEMY_API_KEY}/getTokenMetadata?contract=${CLANKER_TOKEN}`;
  const res = await fetch(url);
  const j = await res.json();
  return {
    name: j.name,
    symbol: j.symbol,
    decimals: j.decimals,
    logo: j.logo
  };
}

async function getClankerBalance() {
  const result = await rpc("alchemy_getTokenBalances", [wallet, [CLANKER_TOKEN]]);
  const entry = result.tokenBalances[0];
  return BigInt(entry.tokenBalance || "0").toString();
}

async function run() {
  const metadata = await getTokenMetadata();
  const rawBalance = await getClankerBalance();
  const formatted = formatUnits(rawBalance, metadata.decimals);

  const output = {
    chain: "base",
    wallet: wallet.toLowerCase(),
    token: {
      address: CLANKER_TOKEN,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      logo: metadata.logo
    },
    balance: {
      raw: rawBalance,
      formatted
    },
    fetchedAt: new Date().toISOString()
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
