import "dotenv/config";
import { AbiCoder, ethers } from "ethers";

const log = {
  info: (...args) => console.log(new Date().toISOString(), "[info]", ...args),
  warn: (...args) => console.warn(new Date().toISOString(), "[warn]", ...args),
  error: (...args) => console.error(new Date().toISOString(), "[error]", ...args)
};

const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;
if (!BASESCAN_API_KEY) {
  log.error("Missing BASESCAN_API_KEY in .env");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

// Common Base tokens
const QUOTES = {
  USDC: "0x833589fcd6edb6e08f4c7c38d5c0e3e0b3b7a78f",
  WETH: "0x4200000000000000000000000000000000000006"
};

const TOPICS = {
  V2_PAIR_CREATED: "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9",
  V3_POOL_CREATED: "0x783cca1c0412dd0d695e784568c96da2e9c22ff92e4e13b096f8f5b5f5f92e2",
  SOLIDLY_PAIR_CREATED: "0x6f4c707f2d0b4fc1f2edbbf9f3e2adaf5bcd890968ea3ea6f09d7a7b7306c3f9"
};

const PRESETS = {
  "base-v2": {
    factory: "0x8ff8c430e550af0059e6b7a3bf9ef1dcea4abbc7", // Uniswap V2-style Base factory (example community fork)
    topic0: TOPICS.V2_PAIR_CREATED,
    decode: (coder, logItem) => {
      const [pair] = coder.decode(["address", "uint256"], logItem.data);
      return { pair, extra: {} };
    },
    label: "Uniswap V2-style"
  },
  "base-v3": {
    factory: "0x33128a8fc17869897dce68ed026d694621f6fdfd",
    topic0: TOPICS.V3_POOL_CREATED,
    decode: (coder, logItem) => {
      const [fee, tickSpacing, pool] = coder.decode(["uint24", "int24", "address"], logItem.data);
      return { pair: pool, extra: { fee: Number(fee), tickSpacing: Number(tickSpacing) } };
    },
    label: "Uniswap V3"
  },
  aerodrome: {
    factory: "0x420dd381b31aef6683db6b902084c7c5c62433f0",
    topic0: TOPICS.SOLIDLY_PAIR_CREATED,
    decode: (coder, logItem) => {
      const [stable, pair] = coder.decode(["bool", "address", "uint256"], logItem.data);
      return { pair, extra: { stable: Boolean(stable) } };
    },
    label: "Aerodrome (Solidly)"
  }
};

const coder = new AbiCoder();
const apiBase = "https://api.basescan.org/api";

const padAddr = (addr) => {
  const chk = ethers.getAddress(addr);
  return "0x" + chk.slice(2).toLowerCase().padStart(64, "0");
};

async function fetchLogs(config, topic1, topic2) {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: "0",
    toBlock: "latest",
    address: config.factory,
    topic0: config.topic0,
    topic1,
    topic2,
    apikey: BASESCAN_API_KEY
  });

  const url = `${apiBase}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "1") {
    throw new Error(data.message || "basescan error");
  }
  return data.result || [];
}

async function searchPair(config, tokenA, tokenB) {
  const t0 = padAddr(tokenA);
  const t1 = padAddr(tokenB);
  const results = [];

  for (const [topic1, topic2] of [
    [t0, t1],
    [t1, t0]
  ]) {
    try {
      const logs = await fetchLogs(config, topic1, topic2);
      for (const logItem of logs) {
        const { pair, extra } = config.decode(coder, logItem);
        results.push({
          pair,
          blockNumber: Number(logItem.blockNumber),
          txHash: logItem.transactionHash,
          token0: ethers.getAddress(`0x${logItem.topics[1].slice(26)}`),
          token1: ethers.getAddress(`0x${logItem.topics[2].slice(26)}`),
          extra
        });
      }
    } catch (e) {
      log.warn(`[${config.label}] No logs for pair ${tokenA}/${tokenB} (topic1=${topic1}, topic2=${topic2}):`, e?.message || e);
    }
  }

  return Object.values(
    results.reduce((acc, r) => {
      acc[r.pair.toLowerCase()] = r;
      return acc;
    }, {})
  ).sort((a, b) => a.blockNumber - b.blockNumber);
}

async function main() {
  const presetName = args.preset || args.amm;
  const targetToken = args.token;
  const token0 = args.token0;
  const token1 = args.token1;
  const factoryOverride = args.factory;
  const topic0Override = args.topic0;

  if (!targetToken && !(token0 && token1) && !presetName) {
    log.error("Provide --token=<erc20> (will search vs USDC/WETH across presets) or both --token0 and --token1 with --preset/--factory.");
    process.exit(1);
  }

  const presetsToSearch = presetName
    ? [presetName]
    : ["base-v3", "aerodrome", "base-v2"];

  const tokensToCheck = [];

  if (token0 && token1) {
    tokensToCheck.push([token0, token1]);
  } else if (targetToken) {
    tokensToCheck.push([targetToken, QUOTES.USDC]);
    tokensToCheck.push([targetToken, QUOTES.WETH]);
  }

  const reports = [];

  for (const name of presetsToSearch) {
    const baseConfig = PRESETS[name];
    if (!baseConfig && !(factoryOverride && topic0Override)) {
      log.warn(`Preset ${name} not known; skip (or supply --factory and --topic0).`);
      continue;
    }

    const config = baseConfig
      ? { ...baseConfig }
      : { factory: factoryOverride, topic0: topic0Override, decode: (coder, logItem) => ({ pair: coder.decode(["address", "uint256"], logItem.data)[0], extra: {} }), label: "custom" };

    // Normalize factory address checksum
    try {
      config.factory = ethers.getAddress(config.factory);
    } catch (e) {
      log.warn(`[${config.label}] invalid factory address: ${config.factory}`);
      continue;
    }

    for (const [a, b] of tokensToCheck) {
      let na;
      let nb;
      try {
        na = ethers.getAddress(a);
        nb = ethers.getAddress(b);
      } catch (e) {
        log.warn(`[${config.label}] invalid token address (${a} or ${b}):`, e?.message || e);
        continue;
      }
      try {
        const rows = await searchPair(config, na, nb);
        if (rows.length) {
          rows.forEach((r) =>
            reports.push({ ...r, amm: config.label, inputPair: `${na}/${nb}` })
          );
        }
      } catch (e) {
        log.warn(`[${config.label}] search error for ${na}/${nb}:`, e?.message || e);
      }
    }
  }

  if (!reports.length) {
    log.warn("No pools found. Verify tokens, presets, or try specifying --factory and --topic0 directly.");
    process.exit(1);
  }

  log.info("Found pools:");
  reports
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .forEach((r) => {
      console.log(
        `amm=${r.amm} pair=${r.pair} block=${r.blockNumber} token0=${r.token0} token1=${r.token1} tx=${r.txHash}` +
          (r.extra?.fee !== undefined ? ` fee=${r.extra.fee}` : "") +
          (r.extra?.stable !== undefined ? ` stable=${r.extra.stable}` : "") +
          ` input_pair=${r.inputPair}`
      );
    });
}

main().catch((e) => {
  log.error("Fatal", e?.message || e);
  process.exit(1);
});
