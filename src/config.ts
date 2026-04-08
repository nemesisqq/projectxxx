import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const RawEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  POLL_INTERVAL_SECONDS: z.string().optional(),
  X_ACCOUNTS: z.string().optional(),
  INCLUDE_REPOSTS: z.string().optional(),
  INCLUDE_QUOTES: z.string().optional(),
  INCLUDE_REPLIES: z.string().optional(),
  SEND_ORIGINAL_TEXT: z.string().optional(),
  SEND_TRANSLATION: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  DRY_RUN: z.string().optional(),
  SQLITE_PATH: z.string().optional(),
  X_PROVIDER: z.string().optional(),
  X_FETCH_LIMIT: z.string().optional(),
  X_BOOTSTRAP_LIMIT: z.string().optional(),
  X_BROWSER_CHANNEL: z.string().optional(),
  X_BROWSER_EXECUTABLE_PATH: z.string().optional(),
  X_STORAGE_STATE_PATH: z.string().optional(),
  X_CDP_URL: z.string().optional(),
  X_HEADLESS: z.string().optional(),
  X_NAVIGATION_TIMEOUT_MS: z.string().optional(),
  X_FETCH_TIMEOUT_MS: z.string().optional(),
  X_API_BEARER_TOKEN: z.string().optional(),
  X_API_BASE_URL: z.string().optional(),
  X_API_TIMEOUT_MS: z.string().optional(),
  X_API_RETRIES: z.string().optional(),
  X_API_RETRY_DELAY_MS: z.string().optional(),
  TELEGRAM_MAX_RETRIES: z.string().optional(),
  TELEGRAM_RETRY_DELAY_MS: z.string().optional(),
  TRANSLATION_ENABLED: z.string().optional(),
  TRANSLATION_PROVIDER: z.string().optional(),
  TRANSLATION_MODEL_PATH: z.string().optional(),
  TRANSLATION_TOKENIZER_PATH: z.string().optional(),
  TRANSLATION_SOURCE_LANG: z.string().optional(),
  TRANSLATION_TARGET_LANG: z.string().optional(),
  TRANSLATION_TIMEOUT_MS: z.string().optional(),
  TRANSLATION_RETRIES: z.string().optional(),
  TRANSLATION_RETRY_DELAY_MS: z.string().optional(),
  TRANSLATION_SKIP_IF_RUSSIAN: z.string().optional(),
  TRANSLATION_SERVICE_URL: z.string().optional(),
  TRANSLATION_PYTHON_BIN: z.string().optional(),
  TRANSLATION_AUTO_START: z.string().optional(),
  TRANSLATION_STARTUP_TIMEOUT_MS: z.string().optional(),
  TRANSLATION_SERVICE_SCRIPT_PATH: z.string().optional()
});

export interface AppConfig {
  telegram: {
    botToken: string;
    chatId: string;
    maxRetries: number;
    retryDelayMs: number;
  };
  translation: {
    enabled: boolean;
    provider: "ctranslate2";
    modelPath: string;
    tokenizerPath: string;
    sourceLang: string;
    targetLang: string;
    timeoutMs: number;
    retries: number;
    retryDelayMs: number;
    skipIfRussian: boolean;
    serviceUrl: string;
    pythonBin: string;
    autoStart: boolean;
    startupTimeoutMs: number;
    serviceScriptPath: string;
  };
  pollIntervalSeconds: number;
  xAccounts: string[];
  includeReposts: boolean;
  includeQuotes: boolean;
  includeReplies: boolean;
  sendOriginalText: boolean;
  sendTranslation: boolean;
  logLevel: string;
  dryRun: boolean;
  sqlitePath: string;
  xProvider: "playwright" | "x_api";
  xFetchLimit: number;
  xBootstrapLimit: number;
  xBrowserChannel?: string;
  xBrowserExecutablePath?: string;
  xStorageStatePath?: string;
  xCdpUrl?: string;
  xHeadless: boolean;
  xNavigationTimeoutMs: number;
  xFetchTimeoutMs: number;
  xApi: {
    bearerToken: string;
    baseUrl: string;
    timeoutMs: number;
    retries: number;
    retryDelayMs: number;
  };
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBoolean(value: string | undefined, fallback: boolean, fieldName: string): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`${fieldName} must be boolean-like (true/false/1/0/yes/no/on/off), got "${value}"`);
}

function parsePositiveInt(value: string | undefined, fallback: number, fieldName: string, min = 1): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const raw = value.trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${fieldName} must be an integer >= ${min}, got "${value}"`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${fieldName} must be an integer >= ${min}, got "${value}"`);
  }

  return parsed;
}

function parseAccounts(value: string | undefined): string[] {
  const raw = value && value.trim() !== "" ? value : "bcherny,karpathy";
  const accounts = raw
    .split(",")
    .map((part) => part.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);

  if (accounts.length === 0) {
    throw new Error("X_ACCOUNTS must contain at least one account handle");
  }

  return Array.from(new Set(accounts));
}

function assertLocalhostUrl(rawUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`TRANSLATION_SERVICE_URL must be a valid URL, got "${rawUrl}"`);
  }

  if (!["127.0.0.1", "localhost"].includes(parsedUrl.hostname)) {
    throw new Error("TRANSLATION_SERVICE_URL must point to localhost/127.0.0.1 for local-only operation");
  }
}

export function loadConfig(): AppConfig {
  const parsed = RawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Environment validation failed: ${message}`);
  }

  const env = parsed.data;
  const xProvider = (env.X_PROVIDER ?? "playwright").trim().toLowerCase();
  if (xProvider !== "playwright" && xProvider !== "x_api") {
    throw new Error(`Unsupported X_PROVIDER "${env.X_PROVIDER}". Supported: playwright, x_api`);
  }

  const translationProvider = (env.TRANSLATION_PROVIDER ?? "ctranslate2").trim().toLowerCase();
  if (translationProvider !== "ctranslate2") {
    throw new Error(
      `Unsupported TRANSLATION_PROVIDER "${env.TRANSLATION_PROVIDER}". Supported: ctranslate2`
    );
  }

  const translationEnabled = parseBoolean(env.TRANSLATION_ENABLED, true, "TRANSLATION_ENABLED");
  const translationModelPath = env.TRANSLATION_MODEL_PATH?.trim() || "./models/ct2-opus-en-ru";
  const translationTokenizerPath = env.TRANSLATION_TOKENIZER_PATH?.trim() || translationModelPath;
  const translationServiceUrl = env.TRANSLATION_SERVICE_URL?.trim() || "http://127.0.0.1:8765";
  assertLocalhostUrl(translationServiceUrl);
  const xApiBearerToken = env.X_API_BEARER_TOKEN?.trim() || "";
  const xApiBaseUrl = env.X_API_BASE_URL?.trim() || "https://api.x.com";
  const xCdpUrl = env.X_CDP_URL?.trim() || undefined;

  if (translationEnabled && translationModelPath === "") {
    throw new Error("TRANSLATION_MODEL_PATH is required when TRANSLATION_ENABLED=true");
  }

  if (xProvider === "x_api" && xApiBearerToken === "") {
    throw new Error("X_API_BEARER_TOKEN is required when X_PROVIDER=x_api");
  }

  try {
    // Validate URL early to fail-fast on bad config.
    // eslint-disable-next-line no-new
    new URL(xApiBaseUrl);
  } catch {
    throw new Error(`X_API_BASE_URL must be a valid URL, got "${xApiBaseUrl}"`);
  }

  if (xCdpUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(xCdpUrl);
    } catch {
      throw new Error(`X_CDP_URL must be a valid URL, got "${xCdpUrl}"`);
    }
  }

  return {
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      maxRetries: parsePositiveInt(env.TELEGRAM_MAX_RETRIES, 4, "TELEGRAM_MAX_RETRIES"),
      retryDelayMs: parsePositiveInt(env.TELEGRAM_RETRY_DELAY_MS, 1_500, "TELEGRAM_RETRY_DELAY_MS")
    },
    translation: {
      enabled: translationEnabled,
      provider: "ctranslate2",
      modelPath: translationModelPath,
      tokenizerPath: translationTokenizerPath,
      sourceLang: env.TRANSLATION_SOURCE_LANG?.trim() || "en",
      targetLang: env.TRANSLATION_TARGET_LANG?.trim() || "ru",
      timeoutMs: parsePositiveInt(env.TRANSLATION_TIMEOUT_MS, 12_000, "TRANSLATION_TIMEOUT_MS", 500),
      retries: parsePositiveInt(env.TRANSLATION_RETRIES, 2, "TRANSLATION_RETRIES", 0),
      retryDelayMs: parsePositiveInt(
        env.TRANSLATION_RETRY_DELAY_MS,
        500,
        "TRANSLATION_RETRY_DELAY_MS",
        100
      ),
      skipIfRussian: parseBoolean(env.TRANSLATION_SKIP_IF_RUSSIAN, true, "TRANSLATION_SKIP_IF_RUSSIAN"),
      serviceUrl: translationServiceUrl,
      pythonBin: env.TRANSLATION_PYTHON_BIN?.trim() || "python",
      autoStart: parseBoolean(env.TRANSLATION_AUTO_START, true, "TRANSLATION_AUTO_START"),
      startupTimeoutMs: parsePositiveInt(
        env.TRANSLATION_STARTUP_TIMEOUT_MS,
        15_000,
        "TRANSLATION_STARTUP_TIMEOUT_MS",
        1000
      ),
      serviceScriptPath:
        env.TRANSLATION_SERVICE_SCRIPT_PATH?.trim() || "./translator/ctranslate2_service.py"
    },
    pollIntervalSeconds: parsePositiveInt(env.POLL_INTERVAL_SECONDS, 45, "POLL_INTERVAL_SECONDS", 5),
    xAccounts: parseAccounts(env.X_ACCOUNTS),
    includeReposts: parseBoolean(env.INCLUDE_REPOSTS, true, "INCLUDE_REPOSTS"),
    includeQuotes: parseBoolean(env.INCLUDE_QUOTES, true, "INCLUDE_QUOTES"),
    includeReplies: parseBoolean(env.INCLUDE_REPLIES, false, "INCLUDE_REPLIES"),
    sendOriginalText: parseBoolean(env.SEND_ORIGINAL_TEXT, true, "SEND_ORIGINAL_TEXT"),
    sendTranslation: parseBoolean(env.SEND_TRANSLATION, true, "SEND_TRANSLATION"),
    logLevel: env.LOG_LEVEL?.trim().toLowerCase() || "info",
    dryRun: parseBoolean(env.DRY_RUN, false, "DRY_RUN"),
    sqlitePath: env.SQLITE_PATH?.trim() || "./data/state.db",
    xProvider: xProvider as AppConfig["xProvider"],
    xFetchLimit: parsePositiveInt(env.X_FETCH_LIMIT, 20, "X_FETCH_LIMIT"),
    xBootstrapLimit: parsePositiveInt(env.X_BOOTSTRAP_LIMIT, 20, "X_BOOTSTRAP_LIMIT"),
    xBrowserChannel: env.X_BROWSER_CHANNEL?.trim() || "msedge",
    xBrowserExecutablePath: env.X_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
    xStorageStatePath: env.X_STORAGE_STATE_PATH?.trim() || undefined,
    xCdpUrl,
    xHeadless: parseBoolean(env.X_HEADLESS, true, "X_HEADLESS"),
    xNavigationTimeoutMs: parsePositiveInt(env.X_NAVIGATION_TIMEOUT_MS, 45_000, "X_NAVIGATION_TIMEOUT_MS", 1000),
    xFetchTimeoutMs: parsePositiveInt(env.X_FETCH_TIMEOUT_MS, 12_000, "X_FETCH_TIMEOUT_MS", 1000),
    xApi: {
      bearerToken: xApiBearerToken,
      baseUrl: xApiBaseUrl,
      timeoutMs: parsePositiveInt(env.X_API_TIMEOUT_MS, 15_000, "X_API_TIMEOUT_MS", 1000),
      retries: parsePositiveInt(env.X_API_RETRIES, 2, "X_API_RETRIES", 0),
      retryDelayMs: parsePositiveInt(env.X_API_RETRY_DELAY_MS, 1_000, "X_API_RETRY_DELAY_MS", 100)
    }
  };
}
