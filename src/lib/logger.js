// Shared scoped logger with optional debug output.

/**
 * Create a scoped logger with ISO timestamps and level prefixes.
 * @param {string} scope
 */
export function createLogger(scope = "app") {
  const label = String(scope || "app");

  const isDebugEnabled = () => {
    const raw = process.env.DEBUG;
    if (!raw) return false;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "1" || normalized === "true") return true;
    return String(raw)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .includes(label);
  };

  const write = (level, method, args) => {
    const ts = new Date().toISOString();
    const prefix = `${ts} [${label}] ${level}`;
    // eslint-disable-next-line no-console
    console[method](prefix, ...args);
  };

  return {
    info: (...args) => write("info", "log", args),
    warn: (...args) => write("warn", "warn", args),
    error: (...args) => write("error", "error", args),
    debug: (...args) => {
      if (!isDebugEnabled()) return;
      write("debug", "log", args);
    }
  };
}
