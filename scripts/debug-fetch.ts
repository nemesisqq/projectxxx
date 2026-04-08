import { loadConfig } from "../src/config";
import { createLogger } from "../src/logging/logger";
import { createXFeedProvider } from "../src/providers/x/XProviderFactory";

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const provider = createXFeedProvider(config, logger);

  try {
    for (const account of config.xAccounts) {
      const posts = await provider.fetchLatestPosts(account, {
        includeReplies: true,
        limit: config.xFetchLimit
      });

      const lines = [
        `Account: @${account}`,
        `Detected posts: ${posts.length}`,
        JSON.stringify(posts, null, 2)
      ];

      // eslint-disable-next-line no-console
      console.log(lines.join("\n"));
    }
  } finally {
    await provider.close();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
