import { expect, test } from "@playwright/test";
import { expectToast, openDialog, signup, uniqueEmail } from "./helpers";

/** Security regression tests against the running application. */
test.describe("security", () => {
  test("pages and APIs require authentication", async ({ page, request }) => {
    for (const path of ["/dashboard", "/leads", "/bookings", "/settings/users"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
    expect((await request.get("/api/leads/export")).status()).toBe(401);
    expect((await request.get("/api/reports/revenue")).status()).toBe(401);
    expect((await request.post("/api/v1/leads", { data: { name: "x", phone: "9999999999" } })).status()).toBe(401);
    expect((await request.post("/api/v1/leads", { headers: { Authorization: "Bearer ok_live_forged" }, data: { name: "x" } })).status()).toBe(401);
    expect((await request.get("/api/cron")).status()).toBe(401);
    expect((await request.get("/api/cron", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("sends security headers", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("session cookie is HttpOnly and SameSite", async ({ page }) => {
    await signup(page, { name: "Cookie Check", org: "Cookie Org", email: uniqueEmail("cookie") });
    const cookie = (await page.context().cookies()).find((c) => c.name.includes("oikos_session"));
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.secure).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain("oikos_session");
  });

  test("tenant isolation: another organization's records are not reachable by URL (IDOR)", async ({ browser }) => {
    const a = await (await browser.newContext()).newPage();
    const b = await (await browser.newContext()).newPage();
    await signup(a, { name: "Owner A", org: "Org A", email: uniqueEmail("orga") });
    await signup(b, { name: "Owner B", org: "Org B", email: uniqueEmail("orgb") });

    await a.goto("/projects");
    const dialog = await openDialog(a, /New project/, "New project");
    await dialog.getByLabel("Project name").fill("Secret Tower A");
    await dialog.getByLabel("Location").fill("Somewhere");
    await dialog.getByLabel("Property type").selectOption("Villa");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await a.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    const projectUrl = new URL(a.url()).pathname;

    await a.goto("/leads");
    const ld = await openDialog(a, /New lead/, "New lead");
    await ld.getByLabel("Full name").fill("Confidential Buyer");
    await ld.getByLabel("Phone").fill("9123400000");
    await ld.getByRole("button", { name: "Create lead" }).click();
    await a.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    const leadUrl = new URL(a.url()).pathname;

    for (const url of [projectUrl, leadUrl]) {
      await b.goto(url);
      await expect(b.getByRole("heading", { name: "Not found" })).toBeVisible();
      await expect(b.getByText(/Secret Tower A|Confidential Buyer/)).toHaveCount(0);
    }
    await b.goto("/leads?q=Confidential");
    await expect(b.getByText("Confidential Buyer")).toHaveCount(0);
    const csv = await (await b.request.get("/api/leads/export")).text();
    expect(csv).not.toContain("Confidential Buyer");
  });

  test("user input is rendered as text, not executed (XSS)", async ({ page }) => {
    await signup(page, { name: "Xss Tester", org: "Xss Org", email: uniqueEmail("xss") });
    let alerted = false;
    page.on("dialog", async (d) => {
      alerted = true;
      await d.dismiss();
    });
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    await page.goto("/leads");
    const dialog = await openDialog(page, /New lead/, "New lead");
    await dialog.getByLabel("Full name").fill(payload);
    await dialog.getByLabel("Phone").fill("9000011111");
    await dialog.getByLabel("Notes").fill(payload);
    await dialog.getByRole("button", { name: "Create lead" }).click();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("<img src=x");
    expect(await page.locator("img[src='x']").count()).toBe(0);
    expect(alerted).toBe(false);
  });

  test("SQL injection strings in search and filters are treated as data", async ({ page }) => {
    await signup(page, { name: "Sqli Tester", org: "Sqli Org", email: uniqueEmail("sqli") });
    for (const q of ["' OR 1=1 --", "%' ; DROP TABLE leads; --", "\\"]) {
      const res = await page.goto(`/leads?q=${encodeURIComponent(q)}&sort=${encodeURIComponent("name; drop table leads")}&stage=${encodeURIComponent("' or '1'='1")}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByText(/No leads match|No leads yet/)).toBeVisible();
    }
    // Invalid identifiers render the Not Found page (no error, no data). The status is 200
    // because the loading skeleton has already streamed when the page resolves to not-found.
    for (const path of ["/leads/not-a-uuid", "/leads/' OR '1'='1", "/bookings/00000000-0000-0000-0000-000000000000"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    }
  });

  test("sign-in is rate limited and accounts lock after repeated failures", async ({ page, browser }) => {
    const email = uniqueEmail("lock");
    await signup(page, { name: "Lock Tester", org: "Lock Org", email });
    const p = await (await browser.newContext()).newPage();
    for (let i = 0; i < 5; i++) {
      await p.goto("/login");
      await p.getByLabel("Work email").fill(email);
      await p.getByLabel("Password").fill(`wrong-password-${i}`);
      await p.getByRole("button", { name: "Sign in" }).click();
      await expect(p.getByText("Invalid email or password.")).toBeVisible();
    }
    await p.goto("/login");
    await p.getByLabel("Work email").fill(email);
    await p.getByLabel("Password").fill("Str0ng-passw0rd!");
    await p.getByRole("button", { name: "Sign in" }).click();
    await expect(p.getByText(/temporarily locked/)).toBeVisible();
  });

  test("lead capture API validates input and enforces the API key", async ({ page, request }) => {
    await signup(page, { name: "Api Owner", org: "Api Org", email: uniqueEmail("api") });
    await page.goto("/settings/integrations");
    const dialog = await openDialog(page, /New key/, "Create API key");
    await dialog.getByLabel("Name").fill("E2E");
    await dialog.getByRole("button", { name: "Create key" }).click();
    const key = (await dialog.locator("code").first().textContent())!;
    expect(key).toMatch(/^ok_live_/);
    await dialog.getByRole("button", { name: "Close" }).click();

    const auth = { Authorization: `Bearer ${key}` };
    expect((await request.post("/api/v1/leads", { headers: auth, data: { phone: "123" } })).status()).toBe(422);
    expect((await request.post("/api/v1/leads", { headers: { ...auth, "Content-Type": "text/plain" }, data: "hello" })).status()).toBe(415);
    const created = await request.post("/api/v1/leads", { headers: auth, data: { name: "Api Lead", phone: "+91 90000 22222", source: "website" } });
    expect(created.status()).toBe(201);
    const again = await request.post("/api/v1/leads", { headers: auth, data: { name: "Api Lead", phone: "9000022222" } });
    expect(again.status()).toBe(200);
    expect((await again.json()).merged).toBe(true);

    // Revoked keys stop working.
    await page.reload();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Revoke" }).first().click();
    await expectToast(page, "API key revoked");
    expect((await request.post("/api/v1/leads", { headers: auth, data: { name: "x", phone: "9000033333" } })).status()).toBe(401);
  });

  test("webhooks reject unsigned or forged requests", async ({ request }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    expect((await request.post(`/api/webhooks/whatsapp/${fakeId}`, { data: { entry: [] } })).status()).toBe(404);
    expect((await request.get(`/api/webhooks/whatsapp/${fakeId}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`)).status()).toBe(403);
    expect((await request.post(`/api/webhooks/google-leads/not-a-uuid`, { data: {} })).status()).toBe(404);
  });
});
