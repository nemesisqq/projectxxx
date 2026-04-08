import dotenv from "dotenv";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

dotenv.config();

async function main(): Promise<void> {
  const storageStatePath = process.env.X_STORAGE_STATE_PATH?.trim() || "./data/x-storage-state.json";
  const resolvedStorageState = path.resolve(storageStatePath);
  await mkdir(path.dirname(resolvedStorageState), { recursive: true });

  const cdpUrl = process.env.X_CDP_URL?.trim() || "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(
        "No browser contexts found via CDP. Open a Chromium-based browser with --remote-debugging-port first."
      );
    }

    const pages = context.pages();
    const xPage = pages.find((page) => page.url().includes("x.com")) ?? pages[0];
    if (!xPage) {
      throw new Error("No pages found in browser context.");
    }

    await xPage.bringToFront();
    await xPage.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await xPage.waitForTimeout(2000);

    await context.storageState({ path: resolvedStorageState });
    // eslint-disable-next-line no-console
    console.log(`Saved X session to: ${resolvedStorageState}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
