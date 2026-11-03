/**
 * Determinism lint (LOG [003]/[006]): the sim source must never call the banned
 * nondeterministic/float APIs. This is a source-level guard so a future change
 * can't quietly reintroduce Math.sqrt or Math.random into the lockstep core.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Allowlist model (VERIFY [009] finding 5): a denylist of specific Math
// methods missed log2/asin/fround/etc. Instead: ANY Math.* call is banned
// unless it's one of the five exactly-specified integer-safe operations the
// codebase is allowed to use (LOG [003]); `**` is Math.pow by another name;
// Date/performance in any form are wall clocks; parseFloat/toFixed invite
// float round-trips.
const MATH_ALLOWED = /^(floor|imul|abs|min|max|round)$/;
const BANNED = [
  /\*\*/,
  /\bDate\b/,
  /\bperformance\s*\./,
  /\bparseFloat\b/,
  /\btoFixed\b/,
  /\bMath\.random\b/, // subsumed by the allowlist scan; kept as belt-and-braces
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
}

const files: string[] = [];
walk("src", files);

describe("float/nondeterminism ban in src/", () => {
  it("finds the sim sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} is clean`, () => {
      // Scan code only: comments may legitimately *name* banned APIs when
      // documenting why they're avoided (and `/**` contains `**`).
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const re of BANNED) {
        expect(text, `banned pattern ${re} in ${file}`).not.toMatch(re);
      }
      for (const m of text.matchAll(/\bMath\.(\w+)/g)) {
        expect(m[1], `banned Math.${m[1]} in ${file}`).toMatch(MATH_ALLOWED);
      }
    });
  }
});
