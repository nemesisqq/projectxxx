import { AppConfig } from "../../config";
import { Logger } from "../../logging/logger";
import { XApiFeedProvider } from "./api/XApiFeedProvider";
import { PlaywrightXFeedProvider } from "./playwright/PlaywrightXFeedProvider";
import { XFeedProvider } from "./XFeedProvider";

export function createXFeedProvider(config: AppConfig, logger: Logger): XFeedProvider {
  if (config.xProvider === "playwright") {
    return new PlaywrightXFeedProvider(
      {
        browserChannel: config.xBrowserChannel,
        browserExecutablePath: config.xBrowserExecutablePath,
        storageStatePath: config.xStorageStatePath,
        cdpUrl: config.xCdpUrl,
        headless: config.xHeadless,
        navigationTimeoutMs: config.xNavigationTimeoutMs,
        fetchTimeoutMs: config.xFetchTimeoutMs
      },
      logger
    );
  }

  if (config.xProvider === "x_api") {
    return new XApiFeedProvider(
      {
        bearerToken: config.xApi.bearerToken,
        baseUrl: config.xApi.baseUrl,
        timeoutMs: config.xApi.timeoutMs,
        retries: config.xApi.retries,
        retryDelayMs: config.xApi.retryDelayMs
      },
      logger
    );
  }

  const unreachable: never = config.xProvider;
  throw new Error(`Unsupported X provider: ${unreachable}`);
}
