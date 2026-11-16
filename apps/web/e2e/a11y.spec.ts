import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Accessibility: no serious or critical axe-core violations on the main screens. */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude(".results-map") // third-party map tiles and controls
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("the empty start page", async ({ page }) => {
  expect(await violations(page)).toEqual([]);
});

test("search results, basket and comparison results", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("ביצים");
  await page.locator(".result").first().waitFor();
  expect(await violations(page)).toEqual([]);

  await page.locator(".result").first().click();
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  await page.locator(".plan.best").waitFor();
  expect(await violations(page)).toEqual([]);

  // Dark mode has its own colours, so its contrast is checked separately.
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await violations(page)).toEqual([]);
});
