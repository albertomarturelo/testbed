import { expect, test } from "@playwright/test";

// Front-end checks of the public sign-in page only. No test submits a username or
// a password: everything that needs an account is a manual case in casefile.

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
});

test("shows the sign-in form", async ({ page }) => {
  await expect(page).toHaveTitle("npm | Sign In");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("blocks an empty submit in the browser", async ({ page }) => {
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const missing = await page
    .getByLabel("Username")
    .evaluate((input: HTMLInputElement) => input.validity.valueMissing);
  expect(missing).toBe(true);
});

test("masks the password and shows it on request", async ({ page }) => {
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
});

test("moves through the form with the keyboard", async ({ page }) => {
  await page.getByLabel("Username").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
});

test("labels every field of the form", async ({ page }) => {
  const fields = page.locator("form input:not([type=hidden])");
  const count = await fields.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const labelled = await fields
      .nth(i)
      .evaluate((input: HTMLInputElement) => (input.labels?.length ?? 0) > 0);
    expect(labelled).toBe(true);
  }
});

test("links to password recovery and sign-up", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
    "href",
    "/forgot",
  );
  await expect(page.getByRole("link", { name: "Create Account" })).toHaveAttribute(
    "href",
    "/signup",
  );
});
