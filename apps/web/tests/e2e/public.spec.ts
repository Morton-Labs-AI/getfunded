/**
 * Public surface smoke: runs against `npm run start` (port 3050) with
 * AI_MODE=mock. No account, no key, no model call. Each test asserts what a
 * visitor sees, not implementation details, so it survives copy changes.
 */
import { expect, test } from "@playwright/test";

test("landing page renders the tagline and a search form", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("funders");
  await expect(page.locator('form[role="search"] input[name="q"]').first()).toBeVisible();
});

test("/search?q=foundation renders results or the empty state", async ({ page }) => {
  const res = await page.goto("/search?q=foundation");
  expect(res?.status()).toBe(200);
  const main = page.locator("main");
  await expect(main).toBeVisible();
  // The query stays in the search box.
  await expect(main.locator('input[name="q"]').first()).toHaveValue(/foundation/i);
  // Either at least one result row or a plain-language empty state.
  const results = main.locator("article, table tbody tr, [data-slot='search-result'], ol li, ul li").first();
  const empty = main.getByText(/no (funders|results|matches)/i).first();
  await expect(results.or(empty)).toBeVisible();
  // The honesty rule: nothing on a search page calls a funder "closed".
  await expect(main).not.toContainText(/\bclosed\b/i);
});

test("/pricing shows the five plans", async ({ page }) => {
  const res = await page.goto("/pricing");
  expect(res?.status()).toBe(200);
  for (const name of ["Free", "Starter", "Pro", "Team", "Enterprise"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  // The internal Unlimited plan (self-install) is never offered for sale. Limit
  // values such as "Members: Unlimited" on Team and Enterprise are fine.
  await expect(page.locator("[data-plan='unlimited']")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Unlimited", exact: true })).toHaveCount(0);
});

test("/funder/<bad id> is a 404", async ({ page }) => {
  const res = await page.goto("/funder/not-a-real-funder-id");
  expect(res?.status()).toBe(404);
});

test("the public API refuses requests without a key", async ({ request }) => {
  const res = await request.get("/api/v1/search?q=foundation");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe("unauthorized");
  expect(res.headers()["www-authenticate"]).toContain("Bearer");
});

test("the OpenAPI document is served", async ({ request }) => {
  const res = await request.get("/api/v1/openapi.json");
  expect(res.status()).toBe(200);
  const doc = await res.json();
  expect(doc.openapi).toBe("3.1.0");
  expect(Object.keys(doc.paths)).toContain("/api/v1/search");
});

test("/admin is hidden from visitors", async ({ page }) => {
  const res = await page.goto("/admin");
  // Signed out: the proxy sends visitors to sign in.
  expect(page.url()).toContain("/signin");
  expect(res?.status()).toBe(200);
});
