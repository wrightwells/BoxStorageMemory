import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const source = JSON.parse(
  readFileSync("fixtures/contracts/valid-inventory.json", "utf8"),
);
test.beforeEach(async ({ page }, testInfo) => {
  if (
    process.env.BSM_UI_VARIANT === "persistent-navigation" ||
    process.env.BSM_PHOTO_VARIANT === "photo-recognition"
  ) {
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({
        json: {
          experimentId: "NAV-001",
          enabled: true,
          rolloutPercentage: 0,
          forceVariant: "persistent-navigation",
          measurementEnabled: false,
          photoRecognition:
            process.env.BSM_PHOTO_VARIANT === "photo-recognition"
              ? {
                  enabled: true,
                  rolloutPercentage: 0,
                  forceVariant: "photo-recognition",
                }
              : undefined,
        },
      }),
    );
  } else if (
    !testInfo.title.startsWith("approved baseline and contextual Add")
  ) {
    // Existing control/regression workflows keep their explicit prior layout.
    // Promotion checks below use the real operator configuration.
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({
        json: {
          experimentId: "NAV-001",
          enabled: true,
          baselineVariant: "persistent-navigation",
          rolloutPercentage: 0,
          forceVariant: null,
          measurementEnabled: false,
        },
      }),
    );
  }
});
const BOX = source.box.id;
const SECOND = "9a46f128-1b5a-42ad-a240-b9015cff9ca7";
async function mockGoogle(page: Page) {
  const inventory = structuredClone(source);
  const empty = {
    schemaVersion: 1,
    box: {
      ...inventory.box,
      id: SECOND,
      number: "BOX-0002",
      name: "Spare Box",
      nfcIds: [],
    },
    items: [],
  };
  const files = [
    {
      id: "library",
      name: "Synthetic browser library",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root"],
      version: "1",
    },
    {
      id: "box-folder",
      name: "BOX-0001 Electrical Box",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["library"],
      version: "1",
    },
    {
      id: "empty-folder",
      name: "BOX-0002 Spare Box",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["library"],
      version: "1",
    },
    {
      id: "index-file",
      name: "box-storage-index.json",
      mimeType: "application/json",
      parents: ["library"],
      version: "1",
    },
    {
      id: "inventory-file",
      name: "inventory.json",
      mimeType: "application/json",
      parents: ["box-folder"],
      version: "1",
    },
    {
      id: "empty-inventory",
      name: "inventory.json",
      mimeType: "application/json",
      parents: ["empty-folder"],
      version: "1",
    },
  ];
  files.push({
    id: "photo-file",
    name: inventory.items[0].images[0],
    mimeType: "image/jpeg",
    parents: ["box-folder"],
    version: "1",
  });
  const index = {
    schemaVersion: 1,
    updated: inventory.box.modified,
    boxes: [
      {
        boxId: BOX,
        boxNumber: inventory.box.number,
        name: inventory.box.name,
        location: inventory.box.location,
        driveFolderId: "box-folder",
        nfcIds: inventory.box.nfcIds,
      },
      {
        boxId: SECOND,
        boxNumber: empty.box.number,
        name: empty.box.name,
        location: empty.box.location,
        driveFolderId: "empty-folder",
        nfcIds: [],
      },
    ],
  };
  await page.addInitScript(() => {
    const browser = window as unknown as { policyErrors: string[] };
    browser.policyErrors = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      browser.policyErrors.push(event.violatedDirective),
    );
  });
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google={accounts:{oauth2:{initTokenClient:function(options){return {requestAccessToken:function(){options.callback({access_token:'synthetic-browser-token',expires_in:3600,scope:'https://www.googleapis.com/auth/drive'});}};},hasGrantedAllScopes:function(){return true;},revoke:function(token,done){fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:'token='+encodeURIComponent(token)}).then(function(){done({successful:true});});}}}};`,
    }),
  );
  await page.route("https://oauth2.googleapis.com/revoke", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "",
    }),
  );
  await page.route("https://www.googleapis.com/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    expect(request.method()).toBe("GET");
    if (
      url.pathname.endsWith("/photo-file") &&
      url.searchParams.get("alt") === "media"
    ) {
      await route.fulfill({
        contentType: "image/jpeg",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: readFileSync("tests/browser/photo.jpg"),
      });
      return;
    } // This browse-only fixture never submits mutations.
    let document: unknown;
    if (url.pathname.endsWith("/about"))
      document = {
        user: {
          permissionId: "browser-fixture-account",
          displayName: "Synthetic account",
          emailAddress: "",
        },
      };
    else if (url.pathname.endsWith("/files")) {
      const q = url.searchParams.get("q") ?? "";
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      document = {
        files: files.filter(
          (file) =>
            file.parents.includes(parent ?? "") &&
            (!q.includes("mimeType =") ||
              file.mimeType === "application/vnd.google-apps.folder"),
        ),
      };
    } else {
      const id = url.pathname.split("/").pop();
      if (url.searchParams.get("alt") === "media")
        document =
          id === "index-file"
            ? index
            : id === "inventory-file"
              ? inventory
              : empty;
      else document = files.find((file) => file.id === id);
    }
    await route.fulfill({
      status: document ? 200 : 404,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(document ?? { error: { code: 404 } }),
    });
  });
  page.on("request", (request) => {
    if (request.url().startsWith(new URL(page.url()).origin + "/api/"))
      expect(request.headers().authorization).toBeUndefined();
  });
  return { inventory, files };
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page
    .getByLabel("Google Drive folder ID (including shared folders)")
    .fill("library");
  await page.getByRole("button", { name: "Use folder ID" }).click();
  await expect(
    page.getByRole("heading", { name: "Library folder", exact: true }),
  ).toBeVisible();
}
test("strict policies support login, browse/search/edit/label/recovery and clear results on sign-out", async ({
  page,
}) => {
  // This workflow now also visits the item photo manager and returns to editing.
  test.setTimeout(45000);
  const fixture = await mockGoogle(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto("/login");
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Account and folder settings" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Browse folders" }),
  ).toHaveCount(0);
  await page.getByLabel("Group boxes by location").check();
  await expect(
    page.getByRole("region", { name: source.box.location, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Group boxes by location").uncheck();
  await page.getByLabel("Find a box number").fill("box-1");
  await page.getByRole("button", { name: "Open box", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "BOX-0001 · Electrical Box" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Box inventory items" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByLabel("Search boxes and items").fill("10 metre");
  await page
    .getByRole("link", { name: "13A Extension Lead", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/box/${BOX}/item/${source.items[0].id}$`),
  );
  await expect(
    page.getByRole("link", { name: "Back to box", exact: true }),
  ).toHaveAttribute("href", `/box/${BOX}`);
  await expect(
    page.getByRole("link", { name: "Back to library", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".item-photo img")).toBeVisible();
  expect(
    await page
      .locator(".item-photo img")
      .evaluate((image) => (image as HTMLImageElement).naturalWidth),
  ).toBe(32);
  const photoAction = page.getByRole("link", {
    name: "Manage photographs",
    exact: true,
  });
  await expect(photoAction.locator("svg")).toHaveCount(0);
  await expect(photoAction.locator("img")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "QR label", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Manage NFC tags", exact: true }),
  ).toHaveCount(0);
  const titles = await page.locator(".record-title").evaluateAll((elements) =>
    elements.map((element) => ({
      size: getComputedStyle(element).fontSize,
      weight: getComputedStyle(element).fontWeight,
    })),
  );
  expect(titles).toHaveLength(2);
  expect(titles[0]).toEqual(titles[1]);
  expect(Number(titles[0].weight)).toBeGreaterThanOrEqual(700);
  await photoAction.click();
  await expect(
    page.getByLabel("Choose photographs (up to 20, 25 MiB each)"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to item", exact: true }).click();
  await page.getByRole("link", { name: "Edit box and items" }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("table", { name: "Inventory items" }),
  ).toBeVisible();
  await expect(page.getByLabel("Item name", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(BOX);
  await expect(page.getByLabel("Notes", { exact: true })).not.toBeVisible();
  await page
    .getByText("Description, tags, notes and photos", { exact: true })
    .click();
  await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add photo", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/box/${BOX}/item/${source.items[0].id}/photos$`),
  );
  await expect(
    page.getByLabel("Choose photographs (up to 20, 25 MiB each)"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to item", exact: true }).click();
  await page
    .getByRole("link", { name: "Edit box and items", exact: true })
    .click();
  await page.getByLabel("Box name", { exact: true }).fill("Updated box draft");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
  await page.getByLabel("Box name", { exact: true }).fill("Electrical Box");
  await page
    .getByRole("link", { name: "Back to library", exact: true })
    .click();
  await page.locator(`a[href="/box/${BOX}"]`).first().click();
  await page.getByRole("link", { name: "QR label", exact: true }).click();
  await expect(page.locator(".qr-label--above img")).toBeVisible();
  await expect(page.locator(".qr-label--left img")).toBeVisible();
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  for (const layout of ["above", "left"] as const) {
    const label = page.locator(`.qr-label--${layout}`);
    const other = page.locator(
      `.qr-label--${layout === "above" ? "left" : "above"}`,
    );
    await expect(label).toHaveText("BOX-0001");
    await expect(
      page.getByRole("region", { name: `Number ${layout} QR code` }),
    ).toHaveCSS("border-top-style", "solid");
    await page
      .getByRole("button", {
        name: `Print label: number ${layout}`,
        exact: true,
      })
      .click();
    for (const media of ["screen", "print"] as const) {
      await page.emulateMedia({ media });
      const number = await label.locator("h3").boundingBox();
      const code = await label.locator("img").boundingBox();
      expect(number!.width).toBeCloseTo(code!.width, 1);
      if (layout === "above") expect(number!.x).toBeCloseTo(code!.x, 1);
      else expect(number!.x + number!.width).toBeLessThan(code!.x);
      if (media === "print") {
        await expect(other).toBeHidden();
        await expect(label.locator("img")).toBeVisible();
        await expect(page.locator(".site-header")).toHaveCSS(
          "visibility",
          "hidden",
        );
      }
    }
    await page.emulateMedia({ media: "screen" });
  }
  await expect(page.locator("body")).not.toContainText(BOX);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Preview rebuilt index" }).click();
  await expect(
    page.getByText("No duplicate or unavailable records were found."),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(BOX);
  fixture.inventory.items[0].notes = "External unique note";
  fixture.files.find((f) => f.id === "inventory-file")!.version = "2";
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByLabel("Search boxes and items").fill("External unique");
  await page.getByRole("button", { name: "Refresh search" }).click();
  await expect(
    page.getByRole("link", { name: "13A Extension Lead", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: "Account setup" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { policyErrors: string[] }).policyErrors,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  const storage = await page.evaluate(() => ({
    local: Object.values(localStorage).join(""),
    session: Object.values(sessionStorage).join(""),
  }));
  expect(storage.local + storage.session).not.toContain(
    "synthetic-browser-token",
  );
  expect(storage.local + storage.session).not.toContain("Extension Lead");
});
test("camera denial and invalid labels preserve fallback; valid QR survives login", async ({
  page,
}) => {
  await mockGoogle(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
      configurable: true,
    }),
  );
  await page.goto("/scan");
  await page.getByRole("button", { name: "Start QR camera" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Camera access is unavailable",
  );
  await page
    .getByLabel("QR label URL")
    .fill(`https://wrong.example/box/${BOX}`);
  await page.getByRole("button", { name: "Open QR label" }).click();
  await expect(page).toHaveURL(/\/scan$/);
  await page
    .getByLabel("QR label URL")
    .fill(new URL(`/box/${BOX}`, page.url()).href);
  await page.getByRole("button", { name: "Open QR label" }).click();
  await page.getByRole("link", { name: "Account setup" }).click();
  await connect(page);
  await page.getByRole("link", { name: "Open requested record" }).click();
  await expect(
    page.getByRole("heading", { name: "BOX-0001 · Electrical Box" }),
  ).toBeVisible();
  await page.goto("/box/9a46f128-1b5a-42ad-a240-b9015cff9caf");
  // Reload loses the in-memory grant; reconnect uses only the saved account-scoped root.
  await page.getByRole("link", { name: "Account setup" }).click();
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await page.getByRole("link", { name: "Open requested record" }).click();
  await expect(page.getByRole("alert")).toContainText("not indexed");
});
test("responsive layout and keyboard fallback have accessible navigation", async ({
  page,
}) => {
  await mockGoogle(page);
  await page.goto("/scan");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.getByLabel("QR label URL").focus();
  await expect(page.getByLabel("QR label URL")).toBeFocused();
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});

test("revocation uses only Google's allowed endpoint and ends local access", async ({
  page,
}) => {
  await mockGoogle(page);
  await page.goto("/login");
  await connect(page);
  await page.getByRole("button", { name: "Revoke Google access" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { policyErrors: string[] }).policyErrors,
    ),
  ).toEqual([]);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`responsive pages fit a ${width}px viewport`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const fixture = await mockGoogle(page);
    fixture.inventory.box.description = "Storage-description-".repeat(30);
    const fits = async () => {
      await expect(page.locator("main")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      for (const link of await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link")
        .all()) {
        const bounds = await link.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
    };
    const capture = async (name: string) => {
      if (process.env.BSM_VISUAL_DIR)
        await page.screenshot({
          path: `${process.env.BSM_VISUAL_DIR}/${width}-${name}.png`,
          fullPage: true,
        });
    };
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: "Sign in with Google" }),
    ).toBeVisible();
    await fits();
    await connect(page);
    await fits();
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /BOX-0001 Electrical Box/ }),
    ).toBeVisible();
    await fits();
    await capture("library");
    await page.locator(`a[href="/box/${BOX}"]`).first().click();
    await expect(
      page.getByRole("table", { name: "Box inventory items" }),
    ).toBeVisible();
    await fits();
    const table = page.getByRole("table", { name: "Box inventory items" });
    const photoAction = table.getByRole("link", {
      name:
        process.env.BSM_PHOTO_VARIANT === "photo-recognition"
          ? "Open item: 13A Extension Lead"
          : "Manage photographs",
      exact: true,
    });
    await photoAction.scrollIntoViewIfNeeded();
    await expect(photoAction).toBeVisible();
    if (process.env.BSM_PHOTO_VARIANT === "photo-recognition")
      await expect(photoAction.getByRole("img")).toHaveJSProperty(
        "naturalWidth",
        32,
      );
    await capture("box");
    await page.getByRole("link", { name: "QR label", exact: true }).click();
    await expect(page.locator(".qr-label--above img")).toBeVisible();
    await expect(page.locator(".qr-label--left img")).toBeVisible();
    await fits();
    await capture("qr-labels");
    await page.getByRole("link", { name: "Back to box", exact: true }).click();
    await page
      .getByRole("link", { name: "Manage NFC tags", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Manage NFC tags", exact: true }),
    ).toBeVisible();
    await fits();
    await page.getByRole("link", { name: "Back to box", exact: true }).click();
    await page
      .getByRole("link", { name: "13A Extension Lead", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "13A Extension Lead", exact: true }),
    ).toBeVisible();
    await fits();
    await page
      .getByRole("link", { name: "Manage photographs", exact: true })
      .click();
    await expect(
      page.getByLabel("Choose photographs (up to 20, 25 MiB each)"),
    ).toBeVisible();
    await fits();
    await capture("photos");
    await page.getByRole("link", { name: "Back to item", exact: true }).click();
    await page
      .getByRole("link", { name: "Edit box and items", exact: true })
      .click();
    await expect(page.getByLabel("Box name", { exact: true })).toBeVisible();
    await page
      .getByText("Description, tags, notes and photos", { exact: true })
      .click();
    await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
    await fits();
    await capture("editor");
    await page
      .getByRole("link", { name: "Back to library", exact: true })
      .click();
    await page.getByRole("link", { name: "Add", exact: true }).click();
    await expect(page.getByLabel("Box name", { exact: true })).toBeVisible();
    await fits();
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.getByLabel("Search boxes and items").fill("10 metre");
    await expect(
      page.getByRole("link", { name: "13A Extension Lead", exact: true }),
    ).toBeVisible();
    await fits();
    await page.goto("/scan");
    await expect(page.getByLabel("QR label URL")).toBeVisible();
    await fits();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await fits();
    await page.getByRole("link", { name: "Box Storage", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Open library", exact: true }),
    ).toBeVisible();
    await fits();
    await capture("home");
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`operation spinner keeps moving with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await mockGoogle(page);
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/health", async (route) => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          version: "1.0.0",
          apiVersion: "v1",
        }),
      });
    });
    try {
      await page.goto("/");
      const spinner = page.locator(".service-status .spinner");
      await expect(spinner).toBeVisible();
      expect(
        await spinner.evaluate((element) => {
          const animation = element.getAnimations()[0];
          return (
            animation?.playState === "running" &&
            Number(animation.effect?.getComputedTiming().duration) > 0
          );
        }),
      ).toBe(true);
      const before = await spinner.evaluate(
        (element) => element.getAnimations()[0].currentTime,
      );
      await expect
        .poll(() =>
          spinner.evaluate(
            (element) => element.getAnimations()[0]?.currentTime,
          ),
        )
        .not.toBe(before);
      release();
      await expect(
        page.getByText("Service available", { exact: true }),
      ).toBeVisible();
      await expect(spinner).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("NAV-001 runtime kill preserves a dirty inventory editor", async ({
  page,
}) => {
  await mockGoogle(page);
  let enabled = true;
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({
      json: {
        experimentId: "NAV-001",
        enabled,
        rolloutPercentage: 0,
        forceVariant: null,
        measurementEnabled: false,
      },
    }),
  );
  await page.clock.install();
  await page.goto("/login?ui=persistent-navigation");
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByLabel("Find a box number").fill("box-1");
  await page.getByRole("button", { name: "Open box", exact: true }).click();
  await page
    .getByRole("link", { name: "Edit box and items", exact: true })
    .click();
  await page
    .getByLabel("Box name", { exact: true })
    .fill("Unsaved navigation experiment draft");
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
  enabled = false;
  await page.clock.runFor(15000);
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "control",
  );
  await expect(page.getByLabel("Box name", { exact: true })).toHaveValue(
    "Unsaved navigation experiment draft",
  );
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
});

for (const restoring of [false, true]) {
  test(`CTX-001 ${restoring ? "restores" : "control clears"} search context on return`, async ({
    page,
  }) => {
    const fixture = await mockGoogle(page);
    fixture.inventory.items[0].description =
      "Long search result description. ".repeat(200);
    let enabled = true;
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({
        json: {
          experimentId: "NAV-001",
          enabled: true,
          baselineVariant: "persistent-navigation",
          rolloutPercentage: 0,
          forceVariant: null,
          measurementEnabled: false,
          searchContext: {
            enabled,
            rolloutPercentage: restoring ? 100 : 0,
            forceVariant: null,
          },
        },
      }),
    );
    await page.clock.install();
    await page.goto("/login");
    await connect(page);
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await page.getByLabel("Search boxes and items").fill("13A");
    const result = page.getByRole("link", {
      name: "13A Extension Lead",
      exact: true,
    });
    await expect(result).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 150));
    const previousScroll = await page.evaluate(() => window.scrollY);
    await result.click();
    await expect(
      page.getByRole("heading", { name: "13A Extension Lead" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await expect(page.getByLabel("Search boxes and items")).toHaveValue(
      restoring ? "13A" : "",
    );
    if (restoring) {
      await page.clock.runFor(50);
      await expect(result).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(previousScroll);
      enabled = false;
      await page.clock.runFor(15000);
      await expect(page.locator("html")).toHaveAttribute(
        "data-search-context",
        "control",
      );
      await expect(page.getByLabel("Search boxes and items")).toHaveValue(
        "13A",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-ui-variant",
        "persistent-navigation",
      );
      await result.click();
      await page.getByRole("link", { name: "Search", exact: true }).click();
      await expect(page.getByLabel("Search boxes and items")).toHaveValue("");
    }
  });
}

test("CTX-001 forgets search context on sign-out and reconnect", async ({
  page,
}) => {
  await mockGoogle(page);
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({
      json: {
        experimentId: "NAV-001",
        enabled: true,
        baselineVariant: "persistent-navigation",
        rolloutPercentage: 0,
        forceVariant: null,
        measurementEnabled: false,
        searchContext: {
          enabled: true,
          rolloutPercentage: 100,
          forceVariant: null,
        },
      },
    }),
  );
  await page.goto("/login");
  await connect(page);
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByLabel("Search boxes and items").fill("13A");
  await page
    .getByRole("link", { name: "13A Extension Lead", exact: true })
    .click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Library folder", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByLabel("Search boxes and items")).toHaveValue("");
  await page.getByLabel("Search boxes and items").fill("13A");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Change library folder", exact: true })
    .click();
  await page
    .getByLabel("Google Drive folder ID (including shared folders)")
    .fill("box-folder");
  await page
    .getByRole("button", { name: "Use folder ID", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Library folder", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByLabel("Search boxes and items")).toHaveValue("");
});

for (const preview of [false, true]) {
  test(`IMG-001 ${preview ? "shows thumbnails with independent rollback" : "control keeps photo icons"}`, async ({
    page,
  }) => {
    await mockGoogle(page);
    let enabled = true;
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({
        json: {
          experimentId: "NAV-001",
          enabled: true,
          baselineVariant: "persistent-navigation",
          rolloutPercentage: 0,
          forceVariant: null,
          measurementEnabled: false,
          photoRecognition: {
            enabled,
            rolloutPercentage: preview ? 100 : 0,
            forceVariant: null,
          },
        },
      }),
    );
    await page.addInitScript(() => {
      const original = URL.revokeObjectURL.bind(URL);
      (window as unknown as { releasedPhotos: number }).releasedPhotos = 0;
      URL.revokeObjectURL = (value) => {
        (window as unknown as { releasedPhotos: number }).releasedPhotos++;
        original(value);
      };
    });
    await page.clock.install();
    await page.goto("/login");
    await connect(page);
    await page.getByRole("link", { name: "Library", exact: true }).click();
    await page.getByLabel("Find a box number").fill("box-1");
    await page.getByRole("button", { name: "Open box", exact: true }).click();
    const table = page.getByRole("table", { name: "Box inventory items" });
    await expect(table).toBeVisible();
    if (!preview) {
      await expect(table.getByRole("img")).toHaveCount(0);
      await expect(
        table.getByRole("link", { name: "Manage photographs", exact: true }),
      ).toBeVisible();
      return;
    }
    const thumbnail = table.getByRole("link", {
      name: "Open item: 13A Extension Lead",
      exact: true,
    });
    await thumbnail.scrollIntoViewIfNeeded();
    const image = thumbnail.getByRole("img", {
      name: "Photograph of 13A Extension Lead",
    });
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty("naturalWidth", 32);
    const bounds = await thumbnail.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await thumbnail.focus();
    await expect(thumbnail).toBeFocused();
    enabled = false;
    await page.clock.runFor(15000);
    await expect(table.getByRole("img")).toHaveCount(0);
    await expect(
      table.getByRole("link", { name: "Manage photographs", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { releasedPhotos: number }).releasedPhotos,
      ),
    ).toBeGreaterThan(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-variant",
      "persistent-navigation",
    );
  });
}
test("IMG-001 keeps item navigation available when a preview fails and retries", async ({
  page,
}) => {
  await mockGoogle(page);
  let fail = true;
  await page.route(
    "https://www.googleapis.com/drive/v3/files/photo-file?*",
    async (route) => {
      if (fail)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":{"code":503}}',
        });
      else await route.fallback();
    },
  );
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({
      json: {
        experimentId: "NAV-001",
        enabled: true,
        baselineVariant: "persistent-navigation",
        rolloutPercentage: 0,
        forceVariant: null,
        measurementEnabled: false,
        photoRecognition: {
          enabled: true,
          rolloutPercentage: 100,
          forceVariant: null,
        },
      },
    }),
  );
  await page.goto("/login");
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByLabel("Find a box number").fill("box-1");
  await page.getByRole("button", { name: "Open box", exact: true }).click();
  const thumbnail = page.getByRole("link", {
    name: "Open item: 13A Extension Lead",
    exact: true,
  });
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(
    page.getByText("Photograph unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(thumbnail).toHaveAttribute(
    "href",
    `/box/${BOX}/item/${source.items[0].id}`,
  );
  fail = false;
  await page
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await expect(thumbnail.getByRole("img")).toHaveJSProperty("naturalWidth", 32);
  await thumbnail.click();
  await expect(
    page.getByRole("heading", { name: "13A Extension Lead" }),
  ).toBeVisible();
});

test("IMG-001 waits for viewport entry and releases previews on exit", async ({
  page,
}) => {
  await mockGoogle(page);
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/files/photo-file?") &&
      request.url().includes("alt=media")
    )
      reads++;
  });
  await page.addInitScript(() => {
    const callbacks: Array<(visible: boolean) => void> = [];
    (
      window as unknown as { setPreviewVisible: (visible: boolean) => void }
    ).setPreviewVisible = (visible) =>
      callbacks.forEach((callback) => callback(visible));
    window.IntersectionObserver = class {
      private callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        callbacks.push((visible) =>
          this.callback(
            [{ target, isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      disconnect() {}
      unobserve() {}
    } as unknown as typeof IntersectionObserver;
  });
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({
      json: {
        experimentId: "NAV-001",
        enabled: true,
        baselineVariant: "persistent-navigation",
        rolloutPercentage: 0,
        forceVariant: null,
        measurementEnabled: false,
        photoRecognition: {
          enabled: true,
          rolloutPercentage: 100,
          forceVariant: null,
        },
      },
    }),
  );
  await page.goto("/login");
  await connect(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByLabel("Find a box number").fill("box-1");
  await page.getByRole("button", { name: "Open box", exact: true }).click();
  const thumbnail = page.getByRole("link", {
    name: "Open item: 13A Extension Lead",
    exact: true,
  });
  await expect(thumbnail).toBeVisible();
  expect(reads).toBe(0);
  await page.evaluate(() =>
    (
      window as unknown as { setPreviewVisible: (visible: boolean) => void }
    ).setPreviewVisible(true),
  );
  await expect(thumbnail.getByRole("img")).toHaveJSProperty("naturalWidth", 32);
  expect(reads).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as { setPreviewVisible: (visible: boolean) => void }
    ).setPreviewVisible(false),
  );
  await expect(thumbnail.getByRole("img")).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { setPreviewVisible: (visible: boolean) => void }
    ).setPreviewVisible(true),
  );
  await expect(thumbnail.getByRole("img")).toHaveJSProperty("naturalWidth", 32);
  expect(reads).toBe(2);
});

test("REF-001 reference layout has working sections, search and a single focused new item", async ({
  page,
}) => {
  await mockGoogle(page);
  let enabled = true;
  await page.route("**/api/v1/ui-experiments", (route) =>
    route.fulfill({
      json: {
        experimentId: "NAV-001",
        enabled: true,
        baselineVariant: "persistent-navigation",
        rolloutPercentage: 0,
        forceVariant: null,
        measurementEnabled: false,
        referenceLayout: {
          enabled,
          rolloutPercentage: 100,
          forceVariant: null,
        },
      },
    }),
  );
  await page.clock.install();
  await page.goto("/login");
  await connect(page);
  await page.getByRole("link", { name: "Boxes", exact: true }).click();
  await page.getByLabel("Find a box number").fill("box-1");
  await page.getByRole("button", { name: "Open box", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Electrical Box", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Box Library", exact: true }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Box inventory items" });
  await expect(table.getByRole("columnheader")).toHaveText([
    "Item",
    "Photo",
    "Description",
    "Quantity",
    "Location",
    "Actions",
  ]);
  await expect(
    page.getByRole("tab", { name: "Items (1)", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Items (1)", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Details", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("link", { name: "QR label", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Open Drive folder", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://drive.google.com/drive/folders/box-folder",
  );
  await expect(
    page.getByRole("tab", { name: "History", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Items (1)", exact: true }).click();
  await page.getByRole("link", { name: "Add Item", exact: true }).click();
  await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(2);
  const newest = page.getByLabel("Item name", { exact: true }).last();
  await expect(newest).toBeFocused();
  await newest.fill("New reference-layout draft");
  enabled = false;
  await page.clock.runFor(15000);
  await expect(page.locator("html")).toHaveAttribute(
    "data-reference-layout",
    "control",
  );
  await expect(newest).toHaveValue("New reference-layout draft");
  await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute(
    "data-ui-variant",
    "persistent-navigation",
  );
  page.on("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Reload current records", exact: true })
    .click();
  await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(1);
});

for (const width of [320, 390, 768, 1440]) {
  test(`REF-001 reference layout fits ${width}px and submits real global search`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockGoogle(page);
    await page.route("**/api/v1/ui-experiments", (route) =>
      route.fulfill({
        json: {
          experimentId: "NAV-001",
          enabled: true,
          baselineVariant: "persistent-navigation",
          rolloutPercentage: 0,
          forceVariant: null,
          measurementEnabled: false,
          referenceLayout: {
            enabled: true,
            rolloutPercentage: 100,
            forceVariant: null,
          },
        },
      }),
    );
    await page.goto("/login");
    await connect(page);
    await page.getByRole("link", { name: "Boxes", exact: true }).click();
    await page.getByLabel("Find a box number").fill("box-1");
    await page.getByRole("button", { name: "Open box", exact: true }).click();
    const thumbnail = page.getByRole("link", {
      name: "Open item: 13A Extension Lead",
      exact: true,
    });
    await thumbnail.scrollIntoViewIfNeeded();
    await expect(thumbnail.getByRole("img")).toHaveJSProperty(
      "naturalWidth",
      32,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const button of await page
      .locator(
        '.reference-primary-actions a, .reference-row-actions a, [role="tab"]',
      )
      .all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    if (process.env.BSM_VISUAL_DIR)
      await page.screenshot({
        path: `${process.env.BSM_VISUAL_DIR}/${width}-reference-box.png`,
        fullPage: true,
      });
    await page
      .getByLabel("Search library query", { exact: true })
      .fill("10 metre");
    await page
      .getByRole("search", { name: "Search library", exact: true })
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await expect(
      page.getByLabel("Search boxes and items", { exact: true }),
    ).toHaveValue("10 metre");
    await expect(
      page.getByRole("link", { name: "13A Extension Lead", exact: true }),
    ).toBeVisible();
  });
}

for (const width of [320, 768, 1440]) {
  test(`approved baseline and contextual Add buttons work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockGoogle(page);
    await page.addInitScript(() =>
      sessionStorage.setItem("bsm:REF-001:variant", "control"),
    );
    await page.goto("/login");
    await connect(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-reference-layout",
      "reference-box",
    );
    const nav = page.getByRole("navigation", {
      name: "Main navigation",
      exact: true,
    });
    await expect(
      nav.getByRole("link", { name: "Scan", exact: true }),
    ).toHaveCount(0);
    await nav.getByRole("link", { name: "Boxes", exact: true }).click();
    await expect(
      nav.getByRole("link", { name: "Add", exact: true }),
    ).toHaveCount(0);
    const tools = page.getByRole("region", { name: "Tools", exact: true });
    await expect(
      tools.getByRole("button", { name: "Refresh library", exact: true }),
    ).toBeVisible();
    await expect(
      tools.getByRole("heading", { name: "Index recovery", exact: true }),
    ).toBeVisible();
    await tools
      .getByRole("button", { name: "Refresh library", exact: true })
      .click();
    await expect(page.getByLabel("Find a box number")).toBeVisible();
    await tools
      .getByRole("button", { name: "Preview rebuilt index", exact: true })
      .click();
    await expect(
      tools.getByRole("status").filter({ hasText: "valid inventories" }),
    ).toBeVisible();
    await expect(page.locator(".box-card-icon")).toHaveCount(2);
    if (process.env.BSM_VISUAL_DIR)
      await page.screenshot({
        path: `${process.env.BSM_VISUAL_DIR}/${width}-library.png`,
        fullPage: true,
      });
    const libraryAdd = page.getByRole("link", { name: "Add", exact: true });
    await expect(libraryAdd).toHaveAttribute("href", "/library/new");
    await libraryAdd.click();
    await expect(
      page.getByRole("heading", { name: "Create box", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Box name", { exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Boxes", exact: true }).click();
    await page.getByLabel("Find a box number").fill("box-1");
    await page.getByRole("button", { name: "Open box", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Electrical Box", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Add", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".reference-box-icon")).toHaveCount(1);
    await expect(page.locator(".reference-folder")).toHaveCount(0);
    await page.getByRole("link", { name: "QR label", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Box QR label", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printInvoked = "true";
      };
    });
    for (const layout of ["above", "left"] as const) {
      await expect(page.locator(`.qr-label--${layout} img`)).toBeVisible();
      await page
        .getByRole("button", {
          name: `Print label: number ${layout}`,
          exact: true,
        })
        .click();
      await expect(page.locator(`.qr-label--${layout}`)).toHaveClass(
        /print-target/,
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-print-invoked",
        "true",
      );
    }
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Electrical Box", exact: true }),
    ).toBeVisible();
    const add = page.getByRole("link", { name: "Add Item", exact: true });
    await expect(add).toHaveAttribute("href", /\/box\/[^/]+\/edit$/);
    await add.click();
    await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(2);
    await expect(
      page.getByLabel("Item name", { exact: true }).last(),
    ).toBeFocused();
    page.on("dialog", (dialog) => void dialog.accept());
    await page
      .getByRole("button", { name: "Reload current records", exact: true })
      .click();
    await expect(page.getByLabel("Item name", { exact: true })).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
