import { expect, test, type Page } from "@playwright/test";

/** Search for a product and add the first result to the basket. */
async function add(page: Page, query: string) {
  await page.getByLabel("מה צריך לקנות?").fill(query);
  await page.locator(".result").first().click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("finds the cheapest nearby store for a basket", async ({ page }) => {
  await add(page, "חלב");
  await add(page, "לחם");
  await expect(page.locator(".basket-item")).toHaveCount(2);

  await page.getByRole("button", { name: "איפה הכי זול?" }).click();

  const best = page.locator(".plan.best");
  await expect(best.getByRole("heading")).toHaveText("זולה זולה דיזנגוף");
  await expect(best.locator(".price strong")).toContainText("13.50"); // 6.50 + 7.00
  await expect(page.locator(".plan")).toHaveCount(2);
  // The map shows the starting point and both stores.
  await expect(page.locator(".results-map path.leaflet-interactive")).toHaveCount(3);
});

test("offers a close substitute where the exact product is missing", async ({ page }) => {
  await add(page, "ביצים L ארוזות"); // sold only by chain "זולה"
  await page.locator(".basket-item").getByRole("radio", { name: "חובה" }).click();

  await page.getByRole("button", { name: "איפה הכי זול?" }).click();

  // The other chain is still a valid plan, with its own eggs as a substitute.
  const other = page.locator(".plan", { hasText: "יקרה דיזנגוף" });
  await other.getByRole("button", { name: "פירוט לפי סופר" }).click();
  await expect(other.locator(".tag")).toHaveText("תחליף");
  await expect(other).toContainText("ביצים 12 יח גדול L");
});

test("keeps the basket after a reload", async ({ page }) => {
  await add(page, "חלב");
  await page.reload();
  await expect(page.locator(".basket-item")).toHaveCount(1);
});

test("opens the basket without a connection", async ({ page, context }) => {
  // The service worker caches the page once it is in control.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await add(page, "חלב");
  await context.setOffline(true);
  await page.reload();

  await expect(page.locator(".basket-item")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("אין חיבור לאינטרנט");
  await expect(page.getByRole("button", { name: "איפה הכי זול?" })).toBeDisabled();
  await context.setOffline(false);
});

test("adds a whole category, any brand, from the search", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("ביצים");
  await page.getByRole("button", { name: /ביצים, כל מותג/ }).click();

  const item = page.locator(".basket-item");
  await expect(item).toHaveCount(1);
  await expect(item.getByLabel("גם מותג אחר")).toBeChecked();
});
