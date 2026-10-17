import { defineConfig, devices } from "@playwright/test";

/**
 * The product's own runner. casefile never runs it: it ingests the JUnit report
 * this writes (`casefile ingest junit results/junit.xml`).
 */
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "https://www.npmjs.com" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: [["list"], ["junit", { outputFile: "results/junit.xml" }]],
  retries: 0,
});
