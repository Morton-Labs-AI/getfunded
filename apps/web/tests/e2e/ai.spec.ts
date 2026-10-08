/**
 * AI surface smoke: runs against `npm run start` (port 3050) with
 * AI_MODE=mock. No account and no model call: these check the doors, not the
 * rooms. Signed-out visitors are sent to sign in; the AI routes refuse a
 * request that does not come from the site before they do anything else.
 */
import { expect, test } from "@playwright/test";

test("/app/ask sends a signed-out visitor to sign in and remembers where they were", async ({ page }) => {
  await page.goto("/app/ask");
  await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Fask/);
});

for (const path of ["/api/ai/filter", "/api/ai/fit", "/api/ai/ask", "/api/ai/research", "/api/ai/draft", "/api/ai/feedback"]) {
  test(`POST ${path} from another site is refused with a JSON 403 before any work`, async ({ request }) => {
    const res = await request.post(path, {
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      data: { sentence: "foundations in Oregon" },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("bad_origin");
  });
}

test("POST /api/ai/filter without a session is a JSON 401, never a redirect", async ({ request }) => {
  const res = await request.post("/api/ai/filter", {
    headers: { "content-type": "application/json", origin: "http://localhost:3050" },
    data: { sentence: "foundations in Oregon" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error.code).toBe("sign_in_required");
});
