import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

const PAGES = ["/dashboard", "/leads", "/pipeline", "/follow-ups", "/site-visits", "/projects", "/inventory", "/bookings", "/payments", "/marketing", "/revenue", "/insights", "/reports", "/whatsapp", "/automation", "/notifications", "/settings/organization", "/settings/integrations", "/settings/security"];

test.describe("responsive layout", () => {
  for (const vp of [{ name: "mobile", width: 375, height: 812 }, { name: "tablet", width: 820, height: 1180 }]) {
    test(`no horizontal page overflow and working navigation on ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await signup(page, { name: "Mobile User", org: "Mobile Org", email: uniqueEmail(vp.name) });
      for (const path of PAGES) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
      }
      // The sidebar collapses into a drawer.
      await page.goto("/dashboard");
      await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
      await page.getByRole("button", { name: "Open navigation" }).click();
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await drawer.getByRole("link", { name: "Inventory" }).click();
      await expect(page).toHaveURL(/\/inventory/);
      await expect(drawer).toBeHidden();
    });
  }
});

test.describe("performance smoke", () => {
  test("key pages respond quickly on a warm server", async ({ page }) => {
    await signup(page, { name: "Perf User", org: "Perf Org", email: uniqueEmail("perf") });
    const timings: Record<string, number> = {};
    for (const path of ["/dashboard", "/leads", "/pipeline", "/revenue", "/marketing"]) {
      await page.goto(path); // warm
      const t0 = Date.now();
      const res = await page.goto(path, { waitUntil: "load" });
      timings[path] = Date.now() - t0;
      expect(res?.status()).toBe(200);
    }
    console.log("Page load timings (ms):", JSON.stringify(timings));
    for (const [path, ms] of Object.entries(timings)) expect(ms, `${path} took ${ms}ms`).toBeLessThan(5000);
  });
});
