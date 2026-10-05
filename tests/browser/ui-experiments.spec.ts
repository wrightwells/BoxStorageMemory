import { test, expect } from "@playwright/test";

const flags = {
  experimentId: "NAV-001",
  enabled: true,
  rolloutPercentage: 0,
  forceVariant: null,
  measurementEnabled: false,
};
for (const width of [320, 390, 768, 1024, 1440]) {
  test(`NAV-001 preserves control and keeps B navigation reachable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({ json: flags }),
    );
    await page.goto("/?ui=control");
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "control",
    );
    await expect(page.locator("header")).toHaveClass("site-header");
    await expect(page.locator(".service-status .spinner")).toHaveCount(0);
    const baseline = await page.screenshot();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "control",
    );
    await expect(page.locator(".service-status .spinner")).toHaveCount(0);
    expect(await page.screenshot()).toEqual(baseline);
    await page.evaluate(() => {
      document.querySelector("main")!.style.minHeight = "2200px";
      window.scrollTo(0, 1600);
    });
    const controlNavigation = await page
      .getByRole("link", { name: "Search", exact: true })
      .boundingBox();
    expect(controlNavigation!.y + controlNavigation!.height).toBeLessThan(0);
    await page.goto("/?ui=persistent-navigation");
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "persistent-navigation",
    );
    await page.evaluate(() => {
      document.querySelector("main")!.style.minHeight = "2200px";
      window.scrollTo(0, 1600);
    });
    for (const link of await page
      .getByRole("navigation")
      .getByRole("link")
      .all()) {
      const bounds = await link.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(780);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("link", { name: "Search", exact: true }).focus();
    await expect(
      page.getByRole("link", { name: "Search", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "persistent-navigation",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "persistent-navigation",
    );
  });
}
test("runtime rollback keeps an open form and withdraws measurement", async ({
  page,
}) => {
  let enabled = true;
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({ json: { ...flags, enabled, measurementEnabled: true } }),
  );
  await page.clock.install();
  await page.goto("/scan?ui=persistent-navigation&ux_measure=1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
  const input = page.getByLabel("QR label URL");
  await input.fill("https://example.com/box/draft");
  await page.evaluate(() => {
    window.boxStorageUx!.startTask();
    window.boxStorageUx!.finishTask(true);
  });
  expect(
    await page.evaluate(
      () => window.boxStorageUx!.summary().counts.taskCompleted,
    ),
  ).toBe(1);
  enabled = false;
  await page.clock.runFor(15000);
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "control",
  );
  await expect(input).toHaveValue("https://example.com/box/draft");
  expect(await page.evaluate(() => window.boxStorageUx)).toBeUndefined();
});
test("slow flags leave A usable; failed flags fail closed even with a saved preview", async ({
  page,
}) => {
  await page.route("**/api/v1/ui-experiments", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ status: 503, body: "Unavailable" });
  });
  await page.goto("/?ui=persistent-navigation");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator("header")).toHaveClass("site-header");
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "control",
  );
});

test("blocked session storage retains assignment in memory across rollout changes", async ({
  page,
}) => {
  let rollout = 100;
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({ json: { ...flags, rolloutPercentage: rollout } }),
  );
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
  rollout = 0;
  await page.clock.runFor(15000);
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
});

test("approved persistent navigation overrides legacy assignment and retains rollback preview", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("bsm:NAV-001:variant", "control"),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-search-context",
    "control",
  );
  await page.goto("/?ui=control");
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "control",
  );
});
