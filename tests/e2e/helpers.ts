import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Str0ng-passw0rd!";

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.test`;
}

export async function signup(page: Page, opts: { name: string; org: string; email: string }) {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(opts.name);
  await page.getByLabel("Company name").fill(opts.org);
  await page.getByLabel("Work email").fill(opts.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/dashboard/);
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** Opens a dialog by its trigger button and returns the dialog locator. */
export async function openDialog(page: Page, trigger: string | RegExp, title: string) {
  await page.getByRole("button", { name: trigger }).first().click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}
