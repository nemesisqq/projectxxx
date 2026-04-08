import { loadConfig } from "../src/config";
import { createLogger } from "../src/logging/logger";
import { createTranslationProvider } from "../src/translation/TranslationProviderFactory";

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const translationProvider = createTranslationProvider(config, logger);

  const sampleText =
    process.argv.slice(2).join(" ") ||
    "New model update is live! Read more: https://x.com/karpathy/status/123 @karpathy #ai";

  try {
    await translationProvider.initialize();
    const result = await translationProvider.translate(sampleText);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          input: sampleText,
          output: result.translatedText,
          skipped: result.skipped,
          failed: result.failed,
          reason: result.failureReason
        },
        null,
        2
      )
    );
  } finally {
    await translationProvider.close();
  }
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
