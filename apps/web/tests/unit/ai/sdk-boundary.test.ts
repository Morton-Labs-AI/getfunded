// @vitest-environment node
/**
 * The cost-control boundary (docs/ARCHITECTURE.md "Metering"): exactly one
 * module imports the Anthropic SDK. This scans lib/ and app/ with fs so a new
 * import anywhere else fails CI, not code review.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd());
const ALLOWED = new Set(["lib/ai/client.ts"]);
const SDK = "@anthropic-ai/sdk";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

function importsSdk(source: string): boolean {
  const patterns = [
    new RegExp(`from\\s+["']${SDK}(/[^"']*)?["']`),
    new RegExp(`import\\s*\\(\\s*["']${SDK}(/[^"']*)?["']\\s*\\)`),
    new RegExp(`require\\s*\\(\\s*["']${SDK}(/[^"']*)?["']\\s*\\)`),
    new RegExp(`import\\s+["']${SDK}(/[^"']*)?["']`),
  ];
  return patterns.some((re) => re.test(source));
}

describe("only lib/ai/client.ts imports @anthropic-ai/sdk", () => {
  const files = [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "app"))];

  it("scans a real tree", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => relative(ROOT, f) === "lib/ai/client.ts")).toBe(true);
  });

  it("the client imports it, nothing else does", () => {
    const offenders: string[] = [];
    let clientImports = false;
    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      const source = readFileSync(file, "utf8");
      if (!importsSdk(source)) continue;
      if (ALLOWED.has(rel)) clientImports = true;
      else offenders.push(rel);
    }
    expect(clientImports).toBe(true);
    expect(offenders, `these files must call the model through meter() instead: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the regex catches the import shapes it should", () => {
    expect(importsSdk('import Anthropic from "@anthropic-ai/sdk";')).toBe(true);
    expect(importsSdk("import type { Tool } from '@anthropic-ai/sdk/resources/messages'")).toBe(true);
    expect(importsSdk('const a = await import("@anthropic-ai/sdk")')).toBe(true);
    expect(importsSdk('const a = require("@anthropic-ai/sdk")')).toBe(true);
    expect(importsSdk('import "@anthropic-ai/sdk/shims/node"')).toBe(true);
    expect(importsSdk('// mentions @anthropic-ai/sdk in a comment only')).toBe(false);
    expect(importsSdk('import x from "@anthropic-ai/sdk-lookalike"')).toBe(false);
  });
});
