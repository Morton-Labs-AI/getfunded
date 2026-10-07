import { expect, test } from "@playwright/test";

test("landing page renders the tagline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Find the funders who already fund work like yours.",
  );
});

test("styleguide renders", async ({ page }) => {
  await page.goto("/dev/styleguide");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Styleguide");
});
