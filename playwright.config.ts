import { defineConfig, devices } from "@playwright/test";
const origin = process.env.BSM_BASE_URL ?? "http://127.0.0.1:18123";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  reporter: "list",
  use: { baseURL: origin, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.BSM_CHROME_PATH
          ? { executablePath: process.env.BSM_CHROME_PATH }
          : {},
      },
    },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    {
      name: "chromium-mobile-layout",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.BSM_CHROME_PATH
          ? { executablePath: process.env.BSM_CHROME_PATH }
          : {},
      },
    },
    ...(process.env.BSM_EDGE_PATH
      ? [
          {
            name: "edge-desktop",
            use: {
              ...devices["Desktop Edge"],
              launchOptions: { executablePath: process.env.BSM_EDGE_PATH },
            },
          },
        ]
      : []),
  ],
  webServer: process.env.BSM_BASE_URL
    ? undefined
    : {
        command: ".venv/bin/python -m backend.app",
        url: `${origin}/api/v1/health`,
        reuseExistingServer: false,
        env: {
          API_HOST: "127.0.0.1",
          API_PORT: new URL(origin).port,
          PUBLIC_URL: origin,
          ALLOWED_ORIGINS: origin,
          GOOGLE_WEB_CLIENT_ID: "browser-test.apps.googleusercontent.com",
          ENABLE_API_DOCS: "false",
        },
      },
});
