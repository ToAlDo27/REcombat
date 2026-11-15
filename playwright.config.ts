import { existsSync } from "node:fs"
import process from "node:process"
import { defineConfig } from "@playwright/test"

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 520, height: 950 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROME_PATH ?? (existsSync(chrome) ? chrome : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npx vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
  },
})
