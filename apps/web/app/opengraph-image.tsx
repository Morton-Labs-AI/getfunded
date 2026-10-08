import fs from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { site } from "@/lib/site";

/**
 * The site-wide Open Graph card, drawn with next/og. Satori cannot read CSS
 * custom properties, so the colours are parsed out of app/globals.css at
 * build time: the tokens stay the single source of truth and no literal
 * colour lives in this file. If the stylesheet cannot be read, the card
 * falls back to named CSS colours.
 */

export const alt = `${site.name}: ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Palette = {
  canvas: string;
  surface: string;
  ink: string;
  ink3: string;
  primary: string;
  primaryTint: string;
  border: string;
  source: string;
  ai: string;
};

const FALLBACK: Palette = {
  canvas: "white",
  surface: "white",
  ink: "black",
  ink3: "gray",
  primary: "darkgreen",
  primaryTint: "honeydew",
  border: "lightgray",
  source: "teal",
  ai: "indigo",
};

/** Read `--name: value;` pairs from the light `:root` block of globals.css. */
function readTokens(): Palette {
  try {
    const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const tokens = new Map<string, string>();
    for (const match of root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens.set(match[1], match[2].trim());
    const get = (name: string, fallback: string) => {
      const v = tokens.get(name);
      return v && !v.startsWith("var(") ? v : fallback;
    };
    return {
      canvas: get("canvas", FALLBACK.canvas),
      surface: get("surface", FALLBACK.surface),
      ink: get("ink", FALLBACK.ink),
      ink3: get("ink-3", FALLBACK.ink3),
      primary: get("primary", FALLBACK.primary),
      primaryTint: get("primary-tint", FALLBACK.primaryTint),
      border: get("border", FALLBACK.border),
      source: get("source", FALLBACK.source),
      ai: get("ai", FALLBACK.ai),
    };
  } catch {
    return FALLBACK;
  }
}

export default function OpenGraphImage() {
  const c = readTokens();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: c.canvas,
          color: c.ink,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M28 4A20 20 0 0 1 8 24A20 20 0 0 1 28 4Z" fill={c.primary} />
            <path d="M8 24 4 28" stroke={c.primary} strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{site.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
            {site.tagline}
          </div>
          <div style={{ fontSize: 30, color: c.ink3, maxWidth: 960, lineHeight: 1.3 }}>
            Open fundraising database for nonprofits, built from public IRS filings. Every fact has a source. AI is always
            labelled.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
          <div
            style={{
              display: "flex",
              padding: "8px 16px",
              borderRadius: 8,
              background: c.primaryTint,
              color: c.primary,
              border: `2px solid ${c.border}`,
              fontWeight: 600,
            }}
          >
            Free search
          </div>
          <div style={{ display: "flex", padding: "8px 16px", borderRadius: 8, color: c.source, border: `2px solid ${c.border}` }}>
            Verified from filings
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 16px",
              borderRadius: 8,
              color: c.ai,
              border: `2px dashed ${c.border}`,
            }}
          >
            AI labelled
          </div>
          <div style={{ marginLeft: "auto", color: c.ink3 }}>{site.url.replace(/^https?:\/\//, "")}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
