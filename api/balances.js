const CLANKER_DEFAULT = "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb";
const WETH_DEFAULT = "0x4200000000000000000000000000000000000006";
const USDC_DEFAULT = "0x833589fcd6edb6e08f4c7c32d4f71b54b5b0e4d";
const BASESCAN_BASE = process.env.BASESCAN_API_BASE || "https://api.basescan.org/api";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBalance(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`basescan http ${res.status}`);
  const json = await res.json();
  if (json.status !== "1") throw new Error(json.result || "basescan error");
  return json.result;
}

function formatBalance(raw, decimals) {
  const big = BigInt(raw || "0");
  const denom = BigInt(10) ** BigInt(decimals);
  const whole = big / denom;
  const frac = big % denom;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export default async function handler(req, res) {
  try {
    const address = (req.query?.address || process.env.TREASURY_ADDRESS || "").trim();
    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }
    const apiKey = process.env.BASESCAN_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "BASESCAN_API_KEY missing" });
    }

    const tokenMeta = [
      { symbol: "CLANKER", address: process.env.CLANKER_TOKEN || CLANKER_DEFAULT, decimals: 18 },
      { symbol: "WETH", address: process.env.WETH_TOKEN || WETH_DEFAULT, decimals: 18 },
      { symbol: "USDC", address: process.env.USDC_TOKEN || USDC_DEFAULT, decimals: 6 }
    ];

    const filterSymbols = (req.query?.symbols || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const tokens = filterSymbols.length
      ? tokenMeta.filter((t) => filterSymbols.includes(t.symbol))
      : tokenMeta;

    const nativeUrl = `${BASESCAN_BASE}?module=account&action=balance&address=${address}&tag=latest&apikey=${apiKey}`;
    const nativeRaw = await fetchBalance(nativeUrl);

    const tokenBalances = [];
    for (const t of tokens) {
      // throttle slightly to avoid hammering BaseScan
      await sleep(50);
      const url = `${BASESCAN_BASE}?module=account&action=tokenbalance&contractaddress=${t.address}&address=${address}&tag=latest&apikey=${apiKey}`;
      try {
        const raw = await fetchBalance(url);
        tokenBalances.push({
          symbol: t.symbol,
          address: t.address,
          decimals: t.decimals,
          balanceRaw: raw,
          balance: formatBalance(raw, t.decimals)
        });
      } catch (e) {
        tokenBalances.push({ symbol: t.symbol, address: t.address, decimals: t.decimals, error: e.message || "error" });
      }
    }

    return res.status(200).json({
      address,
      native: {
        balanceRaw: nativeRaw,
        balance: formatBalance(nativeRaw, 18),
        decimals: 18
      },
      tokens: tokenBalances
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "error" });
  }
}
