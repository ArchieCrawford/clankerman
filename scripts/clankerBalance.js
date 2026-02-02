import "dotenv/config";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_BASE_URL = process.env.ALCHEMY_BASE_URL || "https://base-mainnet.g.alchemy.com";
const RPC_URL = `${ALCHEMY_BASE_URL}/v2/${ALCHEMY_API_KEY}`;

const CLANKER_TOKEN = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb".toLowerCase();

if (!ALCHEMY_API_KEY) {
  throw new Error("Missing ALCHEMY_API_KEY");
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

async function getClankerBalance(wallet) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error("Invalid wallet address");
  }
  const result = await rpc("alchemy_getTokenBalances", [wallet, [CLANKER_TOKEN]]);
  const entry = result.tokenBalances?.[0];
  return BigInt(entry?.tokenBalance || "0").toString();
}

export async function fetchClankerSnapshot(wallet) {
  const metadata = await getTokenMetadata();
  const rawBalance = await getClankerBalance(wallet);
  const formatted = formatUnits(rawBalance, metadata.decimals);

  return {
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
}
