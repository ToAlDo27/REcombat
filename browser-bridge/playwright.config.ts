import { defineConfig } from "@playwright/test"
import { fileURLToPath } from "node:url"

export default defineConfig({
  testDir: "../tests/bridge-browser",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "../test-results-bridge",
  webServer: {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    command:
      "npx vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: !process.env.CI,
  },
})
