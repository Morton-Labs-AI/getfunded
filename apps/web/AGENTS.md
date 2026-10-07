<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## GetFunded working agreements

GetFunded (getfunded.ai) is an open-source fundraising database and AI-enriched funder research tool for nonprofits. This app is `apps/web`: Next.js 16 App Router, React 19, Tailwind v4 via `@tailwindcss/turbopack` (no PostCSS config), TypeScript strict.

### 1. Tokens only

- Every colour, radius, shadow and motion value is a CSS custom property in `app/globals.css`, defined on `:root` and re-defined under `.dark`, and mapped into Tailwind through `@theme inline`.
- **No literal hex, rgb or hsl outside `app/globals.css`** (the only exception is `app/icon.svg`, a brand asset). Components use utilities such as `bg-primary`, `text-ink-3`, `border-source-border`; one-off values use `var(--token)`.
- The default Tailwind palette is removed (`--color-*: initial`), so `text-red-500` is a build-time no-op, not a leak. If you need a colour that does not exist, add a token.
- Radii: 6px badges (`rounded-sm`), 8px controls (`rounded-md`), 10px cards (`rounded-lg`), 12px modals (`rounded-xl`). Motion: 150–200ms; `prefers-reduced-motion` disables all animation globally.
- Fonts: Inter (`font-sans`) for UI, Fraunces (`font-display`) for marketing headlines only, JetBrains Mono (`font-mono`) for numbers, EINs and SQL. Numbers always get `tnum`.

### 2. The three data classes

Every value shown on a funder surface belongs to exactly one class, and colour is never the only signal:

| Class | Meaning | Token | Non-colour signal | Primitive |
| --- | --- | --- | --- | --- |
| Source | Verified from public filings (IRS 990 / 990-PF, BMF) | `--source` (teal) | dotted underline, document glyph | `SourceChip`, `SourceValue`, `ProvenanceSeal` |
| AI | Machine-suggested, never a fact | `--ai` (violet, outside the brand palette) | dashed border, sparkle, the literal word "AI" | `AiBadge`, `AiCard`, `.data-ai` |
| Yours | The workspace's own data | `--yours` (brand green) | solid left rule | `YoursTag`, `YoursBlock`, `.data-yours` |

- Anything produced by a model (fit scores, summaries, suggested asks, drafted emails) renders inside `AiCard` or carries `AiBadge` with a `reason`. No exceptions, including in exports and emails.
- Sourced facts carry provenance (dataset, filing year, sha256 prefix, link) through `ProvenanceSeal` or the `SourceChip` popover slot.

### 3. Honesty copy rules

- Missing data renders `<Missing />` ("Not available", "Not verified", "No public data found") or its `bare` em dash. **Never "$0", never "N/A"** for a missing value. A real zero is "$0".
- Application posture renders `<Posture />`: "Accepts applications", "Funds preselected organizations only", "Not stated in filings". **The word "closed" never appears** — an absent statement is not a closed door.
- Money uses `formatMoney` / `<Money />` (em dash for null, true minus for negatives). EINs use `formatEin` (`12-3456789`).
- Do not invent numbers, dates, or names in UI copy or fixtures; use obviously-placeholder values in the styleguide.

### 4. Data access and privacy

- Database access is **server-only** (Server Components, Route Handlers, Server Actions). No `postgres` or service-role Supabase client in client components; browser code talks to our own endpoints.
- No private data in the repo: no real contact details, no customer workspace data, no API keys. `.env*` files are git-ignored; document required variables by name only.
- Public filings data is CC BY 4.0; code is Apache-2.0. Keep the footer license line accurate.

### 5. Quality bar

- `npm run check` (typecheck, lint, unit tests, build) must stay green on every change. Add a unit test when you add a formatter or a pure helper; add a Playwright smoke when you add a route.
- Dev server runs on port 3050 (`npm run dev`); Playwright targets the production build on the same port.
- New UI primitives go in `components/ui` (shadcn new-york style, data-slot attributes, no forwardRef). Data-honesty primitives go in `components/data`. Register anything new on `/dev/styleguide`.
- Read the Next.js docs in `node_modules/next/dist/docs/` before using an API you have not used in this repo; Cache Components are on, so `usePathname`/`useSearchParams` consumers sit under `<Suspense>`.
