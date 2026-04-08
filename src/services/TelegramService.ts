import { Logger } from "../logging/logger";
import { withRetry } from "../utils/retry";

interface TelegramServiceOptions {
  botToken: string;
  chatId: string;
  dryRun: boolean;
  maxRetries: number;
  retryDelayMs: number;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id: number;
  };
}

export class TelegramService {
  private readonly options: TelegramServiceOptions;
  private readonly logger: Logger;

  constructor(options: TelegramServiceOptions, logger: Logger) {
    this.options = options;
    this.logger = logger.child({ module: "TelegramService" });
  }

  async sendMessage(message: string): Promise<void> {
    if (this.options.dryRun) {
      this.logger.info({ message }, "DRY_RUN enabled: message not sent to Telegram");
      return;
    }

    await withRetry(
      async () => {
        const response = await fetch(`https://api.telegram.org/bot${this.options.botToken}/sendMessage`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            chat_id: this.options.chatId,
            text: message,
            parse_mode: "HTML",
            disable_web_page_preview: true
          })
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Telegram HTTP ${response.status}: ${body}`);
        }

        const data = (await response.json()) as TelegramApiResponse;
        if (!data.ok) {
          throw new Error(data.description ?? "Telegram API returned ok=false");
        }
      },
      {
        retries: this.options.maxRetries,
        initialDelayMs: this.options.retryDelayMs,
        onRetry: (attempt, error, delayMs) => {
          this.logger.warn(
            {
              attempt,
              delayMs,
              error: error.message
            },
            "Telegram send failed, retrying"
          );
        }
      }
    );
  }
}
