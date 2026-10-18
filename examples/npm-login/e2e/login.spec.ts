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

// The page blocks an empty submit by disabling Sign In, so there is nothing to
// click (#76).
test("blocks an empty submit in the browser", async ({ page }) => {
  await expect(page.getByLabel("Username")).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeDisabled();
  await expect(page).toHaveURL(/\/login$/);
});

test("masks the password and shows it on request", async ({ page }) => {
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  // The page sets type="input", not "text". Browsers show an unknown type as
  // text, and the `type` property then reads "text" (#76).
  await expect.poll(() => password.evaluate((input: HTMLInputElement) => input.type)).toBe("text");
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
