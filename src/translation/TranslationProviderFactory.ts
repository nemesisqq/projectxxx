import { AppConfig } from "../config";
import { Logger } from "../logging/logger";
import { CTranslate2TranslationProvider } from "./providers/CTranslate2TranslationProvider";
import { TranslationProvider } from "./TranslationProvider";

export function createTranslationProvider(config: AppConfig, logger: Logger): TranslationProvider {
  if (config.translation.provider === "ctranslate2") {
    return new CTranslate2TranslationProvider(
      {
        enabled: config.translation.enabled,
        modelPath: config.translation.modelPath,
        tokenizerPath: config.translation.tokenizerPath,
        sourceLang: config.translation.sourceLang,
        targetLang: config.translation.targetLang,
        timeoutMs: config.translation.timeoutMs,
        retries: config.translation.retries,
        retryDelayMs: config.translation.retryDelayMs,
        skipIfRussian: config.translation.skipIfRussian,
        serviceUrl: config.translation.serviceUrl,
        pythonBin: config.translation.pythonBin,
        autoStart: config.translation.autoStart,
        startupTimeoutMs: config.translation.startupTimeoutMs,
        serviceScriptPath: config.translation.serviceScriptPath
      },
      logger
    );
  }

  const unreachable: never = config.translation.provider;
  throw new Error(`Unsupported translation provider: ${unreachable}`);
}
