import { loadConfig } from "./config";
import { initializeDatabase } from "./db/init";
import { createDatabase } from "./db/sqlite";
import { createLogger } from "./logging/logger";
import { createXFeedProvider } from "./providers/x/XProviderFactory";
import { AccountStateRepository } from "./repositories/AccountStateRepository";
import { SeenPostRepository } from "./repositories/SeenPostRepository";
import { MonitorService } from "./services/MonitorService";
import { TelegramService } from "./services/TelegramService";
import { createTranslationProvider } from "./translation/TranslationProviderFactory";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info(
    {
      accounts: config.xAccounts,
      pollIntervalSeconds: config.pollIntervalSeconds,
      includeReplies: config.includeReplies,
      includeReposts: config.includeReposts,
      includeQuotes: config.includeQuotes,
      dryRun: config.dryRun
    },
    "Starting X monitor"
  );

  const db = await createDatabase(config.sqlitePath);
  await initializeDatabase(db);

  const seenRepository = new SeenPostRepository(db);
  const accountStateRepository = new AccountStateRepository(db);
  const provider = createXFeedProvider(config, logger);
  const translationProvider = createTranslationProvider(config, logger);
  const telegramService = new TelegramService(
    {
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId,
      dryRun: config.dryRun,
      maxRetries: config.telegram.maxRetries,
      retryDelayMs: config.telegram.retryDelayMs
    },
    logger
  );

  const monitor = new MonitorService({
    config: {
      accounts: config.xAccounts,
      pollIntervalSeconds: config.pollIntervalSeconds,
      includeReposts: config.includeReposts,
      includeQuotes: config.includeQuotes,
      includeReplies: config.includeReplies,
      sendOriginalText: config.sendOriginalText,
      sendTranslation: config.sendTranslation,
      xFetchLimit: config.xFetchLimit,
      xBootstrapLimit: config.xBootstrapLimit
    },
    provider,
    seenRepository,
    accountStateRepository,
    translationProvider,
    telegramService,
    logger
  });

  await translationProvider.initialize();

  let stopRequested = false;
  const requestStop = (): void => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    logger.info("Shutdown signal received");
    monitor.stop();
  };

  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  try {
    await monitor.start();
  } finally {
    await translationProvider.close();
    await provider.close();
    await db.close();
    logger.info("Service stopped");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`Fatal startup error: ${message}`);
  process.exit(1);
});
