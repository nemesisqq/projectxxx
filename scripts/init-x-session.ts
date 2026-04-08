import dotenv from "dotenv";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

dotenv.config();

async function main(): Promise<void> {
  const storageStatePath = process.env.X_STORAGE_STATE_PATH?.trim() || "./data/x-storage-state.json";
  const browserChannel = process.env.X_BROWSER_CHANNEL?.trim() || "msedge";
  const browserExecutablePath = process.env.X_BROWSER_EXECUTABLE_PATH?.trim() || undefined;
  const resolvedStorageState = path.resolve(storageStatePath);

  await mkdir(path.dirname(resolvedStorageState), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    channel: browserChannel,
    executablePath: browserExecutablePath
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  await page.goto("https://x.com/i/flow/login", {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });

  // eslint-disable-next-line no-console
  console.log("Opened X login page in the browser.");
  // eslint-disable-next-line no-console
  console.log("Sign in to your X account, then press Enter in this terminal.");

  const rl = readline.createInterface({ input, output });
  await rl.question("");
  rl.close();

  await context.storageState({ path: resolvedStorageState });

  // eslint-disable-next-line no-console
  console.log(`Saved X session to: ${resolvedStorageState}`);

  await context.close();
  await browser.close();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
