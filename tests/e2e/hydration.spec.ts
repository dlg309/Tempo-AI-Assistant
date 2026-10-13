import { test, expect, type Page } from "@playwright/test";

async function injectExtensionAttributes(page: Page, childMismatch = false) {
  // Intercepted documents have no remote-address metadata. Chromium needs this
  // scoped permission to load the actual loopback chunks/HMR during this test.
  await page
    .context()
    .grantPermissions(["local-network-access"], {
      origin: "http://127.0.0.1:3000",
    });
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|server rendered HTML|server-rendered HTML/i.test(
        message.text(),
      )
    )
      warnings.push(message.text());
  });
  // Deliver the same DOM mutations that an extension makes before hydration,
  // without adding scripts/children or needing a real browser extension.
  await page.route("**/api/workspace**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Test configuration state.",
        configuration: true,
      }),
    }),
  );
  await page.route("**/*", async (route) => {
    if (
      !route.request().isNavigationRequest() ||
      route.request().resourceType() !== "document"
    )
      return route.fallback();
    const response = await route.fetch();
    let html = await response.text();
    html = html
      .replace(
        "<html ",
        '<html suppresshydrationwarning="true" data-qb-installed="true" ',
      )
      .replace(
        /<body(?=[\s>])/,
        '<body data-new-gr-c-s-check-loaded="14.1336.0" data-gr-ext-installed="" data-gr-agent-presence-bridge-connection-id="extension-test-connection"',
      );
    if (childMismatch)
      html = html.replace(
        /<form(?=[\s>])/,
        '<form data-extension-child-probe="true"',
      );
    await route.fulfill({ response, body: html });
  });
  return warnings;
}

for (const path of ["/", "/login"]) {
  test(`extension root attributes do not cause hydration warnings on ${path}`, async ({
    page,
  }) => {
    const warnings = await injectExtensionAttributes(page);
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute(
      "data-qb-installed",
      "true",
    );
    await expect(page.locator("body")).toHaveAttribute(
      "data-new-gr-c-s-check-loaded",
      "14.1336.0",
    );
    if (path === "/login") {
      await page
        .getByRole("button", { name: "Create an account", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Start your Tempo" }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "Your workspace is almost ready." }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Your workspace is almost ready." }),
      ).toBeVisible();
    }
    expect(warnings).toEqual([]);
  });
}

test("hydration diagnostics still detect mismatched application descendants", async ({
  page,
}) => {
  const warnings = await injectExtensionAttributes(page, true);
  await page.goto("/login");
  await expect(page.locator("form")).toHaveAttribute(
    "data-extension-child-probe",
    "true",
  );
  await expect
    .poll(() =>
      warnings.some((message) =>
        message.includes("data-extension-child-probe"),
      ),
    )
    .toBe(true);
});
