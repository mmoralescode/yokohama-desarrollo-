import {defineConfig, devices} from "@playwright/test";

// Uses the running LOCAL demo. Never point these mutation tests at real units.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Cold Next compilation and local Windows/OneDrive I/O can exceed a minute.
  timeout: 120_000,
  expect: {timeout: 45_000},
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
