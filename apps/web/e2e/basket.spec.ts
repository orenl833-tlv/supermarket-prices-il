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

test("shares the list as a link that opens the same list elsewhere", async ({ page, browser }) => {
  await add(page, "חלב");
  await add(page, "לחם");
  await page.locator(".basket-item").nth(1).getByRole("radio", { name: "חובה" }).click();
  await page.getByRole("button", { name: "שיתוף" }).click();
  const link = await page.getByLabel("קישור לרשימה").inputValue();
  expect(link).toMatch(/\?list=\d+-1-n-0,\d+-1-m-0$/);

  // Someone else opens it: a fresh browser context, empty storage.
  const other = await browser.newContext();
  const theirs = await other.newPage();
  await theirs.goto(link);
  await expect(theirs.locator(".basket-item")).toHaveCount(2);
  await expect(theirs.locator(".basket-item").nth(1).getByRole("radio", { name: "חובה" })).toHaveAttribute("aria-checked", "true");
  await expect(theirs).toHaveURL(/\/$/); // the parameter is dropped after import
  await other.close();
});

test("warns when a chain's prices are out of date", async ({ page }) => {
  await add(page, "חלב");
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();

  const fresh = page.locator(".plan", { hasText: "זולה דיזנגוף" });
  const stale = page.locator(".plan", { hasText: "יקרה דיזנגוף" });
  await expect(stale).toContainText("המחירים של יקרה עודכנו לפני 3 ימים");
  await expect(fresh).not.toContainText("עודכנו");
});

test("copies the chosen plan as a shopping list", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Force the clipboard path: headless Chromium may expose a share sheet.
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await add(page, "חלב");
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  await page.locator(".plan.best").getByRole("button", { name: "שליחת רשימת קנייה" }).click();
  await expect(page.locator(".plan.best").getByRole("button", { name: "הרשימה הועתקה" })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("🛒 זולה זולה דיזנגוף");
  expect(text).toContain('סה"כ');
});

test("shows what the pipeline loaded per chain", async ({ page }) => {
  const panel = page.locator(".data-panel");
  await expect(panel.locator("summary")).toContainText("2 רשתות");
  await panel.locator("summary").click();
  await expect(panel.getByRole("row")).toHaveCount(3); // header + two chains
  await expect(panel.getByRole("rowheader").first()).toHaveText("זולה");
});

test("adds a typed comma-separated list in one go", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("חלב, לחם, קוויאר");
  const preview = page.getByLabel("רשימה שהוקלדה");
  await expect(preview.getByRole("listitem")).toHaveCount(3);
  await expect(preview).toContainText("לא נמצא"); // קוויאר
  await preview.getByRole("button", { name: "הוספת 2 מוצרים לרשימה" }).click();
  await expect(page.locator(".basket-item")).toHaveCount(2);
});

test("lets each item of a typed list be changed or left out", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("חלב, לחם");
  const preview = page.getByLabel("רשימה שהוקלדה");
  await preview.getByLabel("לחם").selectOption({ label: "לא להוסיף" });
  await preview.getByRole("button", { name: "הוספת 1 מוצרים לרשימה" }).click();
  await expect(page.locator(".basket-item")).toHaveCount(1);
  await expect(page.locator(".basket-item")).toContainText("חלב");
});

test("shows the address that 'my location' resolved to", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.0775, longitude: 34.7755, accuracy: 25 });
  // The address lookup goes to OpenStreetMap; the test answers it itself.
  await page.route("**/api/reverse?*", (route) => route.fulfill({ json: { address: "דיזנגוף 50, לב העיר" } }));
  await page.getByRole("button", { name: "המיקום שלי" }).click();
  await expect(page.getByText("זוהתה הכתובת דיזנגוף 50, לב העיר · דיוק של כ-25 מ'")).toBeVisible();
  await expect(page.getByLabel("מאיפה יוצאים")).toContainText("המיקום שלי: דיזנגוף 50, לב העיר");
});

test("suggests completing a 2+1 deal, and takes it up in one tap", async ({ page }) => {
  await add(page, "לחם");
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  const best = page.locator(".plan.best");
  await expect(best.getByRole("heading")).toHaveText("זולה זולה דיזנגוף");
  // One loaf asked: 2+1 is only suggested; two more loaves cost 7.
  const suggestion = best.getByRole("button", { name: /עוד 2 ב-.*7.*2\+1 לחם אחיד/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  // The basket now has 3 loaves, the comparison runs again, and 3 cost 14.
  await expect(page.locator(".plan.best .price strong")).toContainText("14.00");
  await expect(page.locator(".plan.best")).toContainText("מבצע");
  await expect(page.locator(".plan.best")).toContainText("× 3");
});

test("adds a list typed with spaces", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("חלב לחם");
  const preview = page.getByLabel("רשימה שהוקלדה");
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await preview.getByRole("button", { name: "הוספת 2 מוצרים לרשימה" }).click();
  await expect(page.locator(".basket-item")).toHaveCount(2);
});

test("sorts search results by price per unit on request", async ({ page }) => {
  await page.getByLabel("מה צריך לקנות?").fill("ביצים");
  await expect(page.locator(".result")).toHaveCount(2);
  await page.getByRole("radio", { name: 'הכי זול לק"ג/ליטר' }).click();
  await expect(page.getByRole("radio", { name: 'הכי זול לק"ג/ליטר' })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".result").first()).toContainText("ביצים L ארוזות"); // 12 for 12 before 12 for 13
});

test("offers deals the basket unlocks with a minimum purchase, and adds one in a tap", async ({ page }) => {
  await add(page, "חלב");
  await add(page, "לחם");
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  const best = page.locator(".plan.best");
  await expect(best.getByRole("heading")).toHaveText("זולה זולה דיזנגוף");
  const unlocked = best.locator(".unlocked");
  await expect(unlocked).toContainText("ביצים L ארוזות");
  await expect(unlocked).toContainText("ביצים ב-6 מעל 10");
  await unlocked.getByRole("button", { name: "הוספה" }).click();
  await expect(page.locator(".basket-item")).toHaveCount(3);
  // Compared again: milk 6.50 + bread 7 = 13.50 reaches the minimum, so the eggs cost 6.
  await expect(page.locator(".plan.best .price strong")).toContainText("19.50");
});

test("says what club membership would save, and applies club deals for members", async ({ page }) => {
  await add(page, "חלב");
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  const best = page.locator(".plan.best");
  await expect(best.locator(".price strong")).toContainText("6.50");
  await expect(best).toContainText("אם היית חבר מועדון בזולה, היית חוסך");
  await expect(best.locator(".club-saving")).toContainText("1.50");

  await page.getByRole("button", { name: /מועדון/ }).click();
  await page.getByRole("switch", { name: "זולה" }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /מועדון/ })).toContainText("1"); // one club marked
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  await expect(page.locator(".plan.best .price strong")).toContainText("5.00");
  await expect(page.locator(".plan.best .club-saving")).toHaveCount(0);
});

test("compares home delivery: online prices plus the delivery fee", async ({ page }) => {
  await add(page, "חלב");
  await add(page, "לחם");
  await page.getByRole("radio", { name: "משלוח הביתה" }).click();
  await expect(page.getByText("יקרה: משלוח ₪20, מינימום הזמנה ₪10")).toBeVisible();
  await page.getByRole("button", { name: "איפה הכי זול?" }).click();
  const best = page.locator(".plan.best");
  await expect(best.getByRole("heading")).toHaveText("יקרה יקרה אונליין");
  await expect(best).toContainText("דמי משלוח");
  await expect(best.locator(".price strong")).toContainText("35.00"); // 7 + 8 online, plus 20 delivery
  await expect(page.locator(".results-map")).toHaveCount(0);
});

test("shows a product's price history per chain, with an ended promotion", async ({ page }) => {
  await add(page, "חלב");
  await page.getByRole("button", { name: "היסטוריית מחיר" }).click();

  const history = page.locator(".history");
  await expect(history.getByRole("img", { name: /מחיר חלב/ })).toBeVisible();
  await expect(history.locator(".price-line")).toHaveCount(2); // one line per chain
  await expect(history.locator(".promo-line")).toHaveCount(1); // 2 for 14 at יקרה, 18-22.11
  // Milk at יקרה went from 7.50 to 7.90.
  await expect(history.locator(".history-legend li", { hasText: "יקרה" })).toContainText(/7\.90.*\(\+5%\)/);
  await expect(history).toContainText("הזול ביותר היום: זולה");

  await history.getByText("הצגה כטבלה").click();
  await expect(history.locator(".history-table")).toContainText("2 ב-14 חלב");
});
