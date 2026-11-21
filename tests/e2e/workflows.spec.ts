import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectToast, login, openDialog, PASSWORD, signup, uniqueEmail } from "./helpers";

/**
 * Critical workflows, end to end, as two real users (an admin and an invited executive):
 * register → organization → project & units → invite → lead (+ duplicate check) → assign →
 * status update → site visit → AI insight → booking → payment → revenue report.
 */
test.describe.serial("critical sales workflow", () => {
  const adminEmail = uniqueEmail("admin");
  const execEmail = uniqueEmail("exec");
  let admin: Page;
  let exec: Page;
  let leadUrl = "";
  let bookingUrl = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    admin = await (await browser.newContext()).newPage();
    exec = await (await browser.newContext()).newPage();
  });

  test("register and create an organization", async () => {
    await signup(admin, { name: "Asha Rao", org: "Greenfield Developers", email: adminEmail });
    await expect(admin.getByRole("heading", { level: 1 })).toContainText("Asha");
    await expect(admin.getByText("Greenfield Developers").first()).toBeVisible();
    await expect(admin.getByText("Set up your workspace")).toBeVisible();
  });

  test("rejects a wrong password and signs in with the right one", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await login(page, adminEmail, "wrong-password-1");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
    await login(page, adminEmail);
    await page.waitForURL(/\/dashboard/);
  });

  test("add a project and generate its inventory", async () => {
    await admin.goto("/projects");
    const dialog = await openDialog(admin, /New project/, "New project");
    await dialog.getByLabel("Project name").fill("Skyline Residences");
    await dialog.getByLabel("Location").fill("Baner, Pune");
    await dialog.getByLabel("Property type").selectOption("Apartment");
    await dialog.getByLabel("Price from (₹)").fill("8000000");
    await dialog.getByLabel("Price to (₹)").fill("12000000");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await admin.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(admin.getByRole("heading", { name: /Skyline Residences/ })).toBeVisible();

    const gen = await openDialog(admin, /Generate units/, "Generate units");
    await gen.getByLabel("Tower / block").fill("A");
    await gen.getByLabel("Configuration").fill("2BHK");
    await gen.getByLabel("From floor").fill("1");
    await gen.getByLabel("To floor").fill("3");
    await gen.getByLabel("Units per floor").fill("4");
    await gen.getByLabel("Carpet area (sq ft)").fill("850");
    await gen.getByLabel("Base price (₹)").fill("8500000");
    await gen.getByLabel("Floor rise per floor (₹)").fill("50000");
    await gen.getByRole("button", { name: "Generate" }).click();
    await expectToast(admin, "12 units created");
    await expect(admin.getByText("A-101")).toBeVisible();
  });

  test("invite a sales executive who accepts the invitation", async () => {
    await admin.goto("/settings/users");
    const dialog = await openDialog(admin, /Invite/, "Invite a team member");
    await dialog.getByLabel("Email").fill(execEmail);
    await dialog.getByLabel("Name").fill("Ravi Kumar");
    await dialog.getByLabel("Role").selectOption("sales_executive");
    await dialog.getByRole("button", { name: "Create invitation" }).click();
    const link = await dialog.locator("code").first().textContent();
    expect(link).toContain("/invite/");

    await exec.goto(link!);
    await expect(exec.getByRole("heading", { name: /Join Greenfield Developers/ })).toBeVisible();
    await exec.getByLabel("Choose a password").fill(PASSWORD);
    await exec.getByRole("button", { name: /Create account/ }).click();
    await exec.waitForURL(/\/dashboard/);
    // Executives don't see admin-only navigation.
    await expect(exec.getByRole("link", { name: "Users & Roles" })).toHaveCount(0);
    await expect(exec.getByRole("link", { name: "Lead Management" })).toBeVisible();
  });

  test("create a lead, detect a duplicate, and see an explainable AI score", async () => {
    await admin.goto("/leads");
    let dialog = await openDialog(admin, /New lead/, "New lead");
    await dialog.getByLabel("Full name").fill("Priya Sharma");
    await dialog.getByLabel("Phone").fill("98765 43210");
    await dialog.getByLabel("Email").fill("priya@example.test");
    await dialog.getByLabel("Budget up to (₹)").fill("9000000");
    await dialog.getByLabel("Preferred project").selectOption({ label: "Skyline Residences" });
    await dialog.getByLabel("Buying timeline").selectOption("within_3_months");
    await dialog.getByRole("button", { name: "Create lead" }).click();
    await admin.waitForURL(/\/leads\/[0-9a-f-]{36}$/);
    leadUrl = admin.url();
    await expect(admin.getByRole("heading", { name: /Priya Sharma/ })).toBeVisible();
    await expect(admin.getByText("Why this score")).toBeVisible();
    await expect(admin.getByText(/fits \d+ available units?/)).toBeVisible();
    await expect(admin.getByText("Suggested next action")).toBeVisible();

    await admin.goto("/leads");
    dialog = await openDialog(admin, /New lead/, "New lead");
    await dialog.getByLabel("Full name").fill("Priya S.");
    await dialog.getByLabel("Phone").fill("+91 9876543210");
    await dialog.getByRole("button", { name: "Create lead" }).click();
    await expect(dialog.getByText("Possible duplicate")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
  });

  test("assign the lead to the executive", async () => {
    await admin.goto("/leads?q=Priya");
    await admin.getByRole("checkbox", { name: "Select Priya Sharma" }).check();
    await admin.getByLabel("Assign to").selectOption({ label: "Ravi Kumar" });
    await admin.getByRole("button", { name: "Apply" }).click();
    await expectToast(admin, "1 lead assigned");
    await expect(admin.getByRole("row", { name: /Priya Sharma/ })).toContainText("Ravi Kumar");
  });

  test("executive sees only their lead, logs a call and updates the status", async () => {
    await exec.goto("/leads");
    await expect(exec.getByRole("link", { name: "Priya Sharma" })).toBeVisible();
    await exec.getByRole("link", { name: "Priya Sharma" }).click();
    await exec.waitForURL(leadUrl);

    await exec.getByLabel("Type", { exact: true }).selectOption("call");
    await exec.getByLabel("Outcome").selectOption("Interested");
    await exec.getByLabel("Summary").fill("Discussed 2BHK options on higher floors");
    await exec.getByRole("button", { name: "Save activity" }).click();
    await expectToast(exec, "Activity logged");
    await expect(exec.getByText("Discussed 2BHK options on higher floors")).toBeVisible();

    await exec.getByLabel("Stage").selectOption("qualified");
    await exec.getByRole("button", { name: "Update stage" }).click();
    await expectToast(exec, "Stage updated");
    await expect(exec.getByText(/Contacted → Qualified/)).toBeVisible();
  });

  test("executive schedules a site visit", async () => {
    await exec.goto(leadUrl);
    const dialog = await openDialog(exec, /Site visit/, "Schedule site visit");
    await dialog.getByLabel("Project").selectOption({ label: "Skyline Residences" });
    await dialog.getByRole("button", { name: "Schedule visit" }).click();
    await expectToast(exec, "Site visit scheduled");
    await exec.goto("/site-visits");
    await expect(exec.getByRole("row", { name: /Priya Sharma/ })).toContainText("Skyline Residences");
  });

  test("generate AI insights from live data", async () => {
    await admin.goto("/insights");
    await expect(admin.getByRole("heading", { name: "AI Insights" })).toBeVisible();
    await admin.getByRole("button", { name: "Refresh insights" }).click();
    await expect(admin.getByText(/insights? · generated/)).toBeVisible();
    // The AI assistant explains clearly when no API key is configured instead of failing silently.
    await expect(admin.getByText(/needs an Anthropic API key/)).toBeVisible();
  });

  test("record a booking with a payment plan", async () => {
    await admin.goto(`/bookings/new?lead=${leadUrl.split("/").pop()}`);
    await admin.getByLabel("Unit").selectOption({ index: 1 });
    await expect(admin.getByLabel("Agreement value (₹)")).not.toHaveValue("");
    await admin.getByLabel("Agreement value (₹)").fill("8600000");
    await admin.getByLabel("Booking amount (₹)").fill("860000");
    await admin.getByLabel("Payment plan").selectOption("clp");
    await admin.getByLabel("Reference / UTR").fill("UTR-E2E-1");
    await admin.getByRole("button", { name: "Record booking" }).click();
    await admin.waitForURL(/\/bookings\/[0-9a-f-]{36}$/);
    bookingUrl = admin.url();
    await expect(admin.getByText("Payment milestones")).toBeVisible();
    await expect(admin.getByRole("row", { name: /Booking/ }).first()).toContainText("Paid");

    await admin.goto(leadUrl);
    await expect(admin.getByText("Booked", { exact: true }).first()).toBeVisible();
  });

  test("record a payment and update outstanding balances", async () => {
    await admin.goto(bookingUrl);
    const dialog = await openDialog(admin, /Record payment/, "Record payment");
    await dialog.getByLabel("Amount (₹)").fill("1720000");
    await dialog.getByLabel("Method").selectOption("bank_transfer");
    await dialog.getByLabel("Reference / UTR / cheque no.").fill("NEFT-E2E-2");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expectToast(admin, "Payment recorded");
    await expect(admin.getByRole("cell", { name: "NEFT-E2E-2" })).toBeVisible();
    await expect(admin.getByText("₹25.80 L").first()).toBeVisible(); // 8.6 L + 17.2 L received
  });

  test("generate revenue reports as CSV and PDF", async () => {
    await admin.goto("/reports");
    const [csv] = await Promise.all([admin.waitForEvent("download"), admin.locator('a[href^="/api/reports/revenue?"][href*="format=csv"]').click()]);
    const csvText = await (await csv.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
    expect(csvText).toContain("Booked revenue (actual),8600000");
    expect(csvText).toContain("Skyline Residences");

    const [pdf] = await Promise.all([admin.waitForEvent("download"), admin.locator('a[href^="/api/reports/revenue?"][href*="format=pdf"]').click()]);
    const pdfBytes = await (await pdf.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks));
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("dashboard reflects the recorded business", async () => {
    await admin.goto("/dashboard");
    const kpis = admin.getByRole("region", { name: "Key metrics" });
    await expect(kpis.getByText("Bookings").locator("..")).toContainText("1");
    await expect(kpis).toContainText("₹86.00 L");
  });

  test("executives cannot open reports or settings", async () => {
    await exec.goto("/reports");
    await expect(exec.getByText("You don't have access")).toBeVisible();
    const res = await exec.request.get("/api/reports/revenue?format=csv");
    expect(res.status()).toBe(403);
    await exec.goto("/settings/users");
    await expect(exec.getByText("You don't have access")).toBeVisible();
  });

  test("sign out ends the session", async () => {
    await exec.getByRole("button", { name: /Ravi Kumar/ }).click();
    await exec.getByRole("menuitem", { name: "Sign out" }).click();
    await exec.waitForURL(/\/login/);
    await exec.goto("/dashboard");
    await exec.waitForURL(/\/login/);
  });
});
