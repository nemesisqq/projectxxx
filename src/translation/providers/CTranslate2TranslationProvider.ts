import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { Logger } from "../../logging/logger";
import { withRetry } from "../../utils/retry";
import { sleep } from "../../utils/sleep";
import { TranslationProvider, TranslationResult } from "../TranslationProvider";

export interface CTranslate2TranslationProviderOptions {
  enabled: boolean;
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
}

interface TranslateResponsePayload {
  translated_text?: string;
  error?: string;
}

interface ProtectResult {
  text: string;
  placeholders: Map<string, string>;
}

export class CTranslate2TranslationProvider implements TranslationProvider {
  private readonly options: CTranslate2TranslationProviderOptions;
  private readonly logger: Logger;
  private readonly baseUrl: URL;
  private childProcess?: ChildProcessWithoutNullStreams;
  private startupPromise?: Promise<void>;
  private processManagedByProvider = false;

  constructor(options: CTranslate2TranslationProviderOptions, logger: Logger) {
    this.options = options;
    this.logger = logger.child({ module: "CTranslate2TranslationProvider" });
    this.baseUrl = new URL(options.serviceUrl);
  }

  async initialize(): Promise<void> {
    if (!this.options.enabled) {
      this.logger.info("Translation is disabled by configuration");
      return;
    }
    await this.ensureServiceReady();
  }

  async translate(text: string): Promise<TranslationResult> {
    const originalText = text ?? "";
    const trimmed = originalText.trim();

    if (!this.options.enabled) {
      return {
        originalText,
        translatedText: originalText,
        skipped: true,
        failed: false,
        failureReason: "TRANSLATION_ENABLED=false",
        provider: "ctranslate2"
      };
    }

    if (trimmed === "") {
      return {
        originalText,
        translatedText: "",
        skipped: true,
        failed: false,
        failureReason: "empty_text",
        provider: "ctranslate2"
      };
    }

    if (this.options.skipIfRussian && isMostlyRussian(trimmed)) {
      return {
        originalText,
        translatedText: originalText,
        skipped: true,
        failed: false,
        failureReason: "already_russian",
        provider: "ctranslate2"
      };
    }

    try {
      await this.ensureServiceReady();
      const protectedText = protectText(trimmed);

      const translated = await withRetry(
        async () => this.requestTranslation(protectedText.text),
        {
          retries: this.options.retries,
          initialDelayMs: this.options.retryDelayMs,
          onRetry: (attempt, error, delayMs) => {
            this.logger.warn(
              {
                attempt,
                delayMs,
                error: error.message
              },
              "Translation request failed, retrying"
            );
          }
        }
      );

      const restored = restoreText(translated, protectedText.placeholders).trim();

      if (!restored) {
        return {
          originalText,
          translatedText: null,
          skipped: false,
          failed: true,
          failureReason: "empty_translation_result",
          provider: "ctranslate2"
        };
      }

      return {
        originalText,
        translatedText: restored,
        skipped: false,
        failed: false,
        provider: "ctranslate2"
      };
    } catch (error) {
      const message = toError(error).message;
      this.logger.warn({ error: message }, "Translation failed, fallback to original text");
      return {
        originalText,
        translatedText: null,
        skipped: false,
        failed: true,
        failureReason: message,
        provider: "ctranslate2"
      };
    }
  }

  async close(): Promise<void> {
    if (!this.childProcess || !this.processManagedByProvider) {
      return;
    }

    if (!this.childProcess.killed) {
      this.childProcess.kill("SIGTERM");
      await sleep(300);
      if (!this.childProcess.killed) {
        this.childProcess.kill("SIGKILL");
      }
    }

    this.childProcess = undefined;
    this.startupPromise = undefined;
  }

  private async ensureServiceReady(): Promise<void> {
    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }

    this.startupPromise = this.startOrConnect();
    try {
      await this.startupPromise;
    } catch (error) {
      this.startupPromise = undefined;
      throw error;
    }
  }

  private async startOrConnect(): Promise<void> {
    if (await this.healthcheck()) {
      this.logger.info({ serviceUrl: this.options.serviceUrl }, "Connected to existing CTranslate2 service");
      return;
    }

    if (!this.options.autoStart) {
      throw new Error(
        `Translation service is unreachable at ${this.options.serviceUrl}. Enable TRANSLATION_AUTO_START or run service manually.`
      );
    }

    const scriptPath = path.resolve(this.options.serviceScriptPath);
    const modelPath = path.resolve(this.options.modelPath);
    const tokenizerPath = path.resolve(this.options.tokenizerPath);

    await access(scriptPath);
    await access(modelPath);
    await access(tokenizerPath);

    const host = this.baseUrl.hostname;
    const port = this.baseUrl.port || (this.baseUrl.protocol === "https:" ? "443" : "80");

    const env = {
      ...process.env,
      TRANSLATION_MODEL_PATH: modelPath,
      TRANSLATION_TOKENIZER_PATH: tokenizerPath,
      TRANSLATION_SOURCE_LANG: this.options.sourceLang,
      TRANSLATION_TARGET_LANG: this.options.targetLang,
      TRANSLATION_SERVICE_HOST: host,
      TRANSLATION_SERVICE_PORT: port,
      LOG_LEVEL: process.env.LOG_LEVEL ?? "info"
    };

    this.childProcess = spawn(this.options.pythonBin, [scriptPath], {
      env,
      stdio: "pipe"
    });
    this.processManagedByProvider = true;

    this.childProcess.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        this.logger.debug({ service: "ctranslate2", stdout: line }, "Translation service output");
      }
    });
    this.childProcess.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        this.logger.warn({ service: "ctranslate2", stderr: line }, "Translation service error output");
      }
    });

    const startupDeadline = Date.now() + this.options.startupTimeoutMs;
    while (Date.now() < startupDeadline) {
      if (this.childProcess.exitCode !== null) {
        throw new Error(`Translation service exited unexpectedly with code ${this.childProcess.exitCode}`);
      }
      if (await this.healthcheck()) {
        this.logger.info({ serviceUrl: this.options.serviceUrl }, "CTranslate2 translation service is ready");
        return;
      }
      await sleep(300);
    }

    throw new Error(
      `Timed out waiting for translation service startup after ${this.options.startupTimeoutMs}ms`
    );
  }

  private async requestTranslation(text: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs);

    try {
      const response = await fetch(new URL("/translate", this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          text,
          source_lang: this.options.sourceLang,
          target_lang: this.options.targetLang
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Translation service HTTP ${response.status}: ${body}`);
      }

      const payload = (await response.json()) as TranslateResponsePayload;
      if (typeof payload.translated_text !== "string") {
        throw new Error(payload.error ?? "Invalid translation response payload");
      }

      return payload.translated_text;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async healthcheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, Math.min(2000, this.options.timeoutMs));

    try {
      const response = await fetch(new URL("/health", this.baseUrl), {
        method: "GET",
        signal: controller.signal
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function protectText(text: string): ProtectResult {
  const placeholders = new Map<string, string>();
  let index = 0;

  const protectedText = text.replace(
    /(https?:\/\/[^\s]+|@[A-Za-z0-9_]{1,15}|#[\p{L}\p{N}_]+)/gu,
    (match: string) => {
      const key = `ZXPH${index}ZX`;
      placeholders.set(key, match);
      index += 1;
      return key;
    }
  );

  return {
    text: protectedText,
    placeholders
  };
}

function restoreText(text: string, placeholders: Map<string, string>): string {
  let output = text;
  for (const [key, value] of placeholders.entries()) {
    output = output.replace(new RegExp(key, "g"), value);
  }
  return output;
}

function isMostlyRussian(text: string): boolean {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cyrillic > 0 && cyrillic >= latin * 2;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
