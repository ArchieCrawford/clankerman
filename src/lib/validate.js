// Basic environment and value validation helpers.

import { AppError } from "./errors.js";

/**
 * Check if a value looks like an EVM address.
 * @param {string} value
 */
export function isAddress(value) {
  if (typeof value !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

/**
 * Require an environment variable or throw.
 * @param {string} name
 * @param {string} [value]
 */
export function requireEnv(name, value = process.env[name]) {
  if (value == null || String(value).trim() === "") {
    throw new AppError(`${name} missing`, { status: 500, code: "ENV_MISSING" });
  }
  return String(value);
}

/**
 * Read an optional environment variable.
 * @param {string} name
 * @param {string} [fallback]
 */
export function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") return fallback;
  return String(value);
}

/**
 * Convert value to integer with fallback.
 * @param {string|number|undefined|null} value
 * @param {number} fallback
 */
export function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalize address strings to lowercase.
 * @param {string} value
 * @param {string} [fallback]
 */
export function toLowerAddress(value, fallback = "") {
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  return trimmed.toLowerCase();
}
