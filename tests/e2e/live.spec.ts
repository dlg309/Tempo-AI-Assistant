import { test, expect } from "@playwright/test";
// Opt-in. Use a disposable Supabase project with the migration applied.
test("live Supabase authentication and persistence smoke test", async ({
  page,
}) => {
  if (!process.env.TEMPO_TEST_EMAIL || !process.env.TEMPO_TEST_PASSWORD)
    throw new Error(
      "Set TEMPO_TEST_EMAIL/PASSWORD for a disposable migrated Supabase project.",
    );
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.TEMPO_TEST_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.TEMPO_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for your day." }),
  ).toBeVisible();
  const onboarding = page.getByRole("button", { name: "Use defaults for now" });
  if (await onboarding.isVisible()) await onboarding.click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const title = `Live integration ${Date.now()}`;
  await page.getByLabel("Task title").fill(title);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Tasks", exact: true })
    .click();
  await page.getByRole("button", { name: `Edit ${title}` }).click();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete task & blocks" }).click();
  await expect(page.getByRole("button", { name: `Edit ${title}` })).toHaveCount(
    0,
  );
});
