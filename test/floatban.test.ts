/**
 * Determinism lint (LOG [003]/[006]): the sim source must never call the banned
 * nondeterministic/float APIs. This is a source-level guard so a future change
 * can't quietly reintroduce Math.sqrt or Math.random into the lockstep core.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BANNED = [
  /\bMath\.random\b/,
  /\bMath\.sqrt\b/,
  /\bMath\.sin\b/,
  /\bMath\.cos\b/,
  /\bMath\.tan\b/,
  /\bMath\.atan2?\b/,
  /\bMath\.pow\b/,
  /\bMath\.exp\b/,
  /\bMath\.log\b/,
  /\bMath\.hypot\b/,
  /\bMath\.cbrt\b/,
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bperformance\.now\b/,
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
      const text = readFileSync(file, "utf8");
      for (const re of BANNED) {
        expect(text).not.toMatch(re);
      }
    });
  }
});
