import { Logger } from "../logging/logger";
import { XFeedProvider } from "../providers/x/XFeedProvider";
import { AccountStateRepository } from "../repositories/AccountStateRepository";
import { SeenPostRepository } from "../repositories/SeenPostRepository";
import { TranslationProvider } from "../translation/TranslationProvider";
import { NormalizedPost } from "../types/post";
import { sleep } from "../utils/sleep";
import { formatTelegramMessage } from "./TelegramFormatter";
import { TelegramService } from "./TelegramService";

export interface MonitorServiceConfig {
  accounts: string[];
  pollIntervalSeconds: number;
  includeReposts: boolean;
  includeQuotes: boolean;
  includeReplies: boolean;
  sendOriginalText: boolean;
  sendTranslation: boolean;
  xFetchLimit: number;
  xBootstrapLimit: number;
}

interface MonitorServiceDeps {
  config: MonitorServiceConfig;
  provider: XFeedProvider;
  seenRepository: SeenPostRepository;
  accountStateRepository: AccountStateRepository;
  translationProvider: TranslationProvider;
  telegramService: TelegramService;
  logger: Logger;
}

export class MonitorService {
  private readonly config: MonitorServiceConfig;
  private readonly provider: XFeedProvider;
  private readonly seenRepository: SeenPostRepository;
  private readonly accountStateRepository: AccountStateRepository;
  private readonly translationProvider: TranslationProvider;
  private readonly telegramService: TelegramService;
  private readonly logger: Logger;
  private running = false;

  constructor(deps: MonitorServiceDeps) {
    this.config = deps.config;
    this.provider = deps.provider;
    this.seenRepository = deps.seenRepository;
    this.accountStateRepository = deps.accountStateRepository;
    this.translationProvider = deps.translationProvider;
    this.telegramService = deps.telegramService;
    this.logger = deps.logger.child({ module: "MonitorService" });
  }

  stop(): void {
    this.running = false;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.bootstrapAccounts();

    while (this.running) {
      const cycleStart = Date.now();
      try {
        await this.runPollingCycle();
      } catch (error) {
        this.logger.error({ error: this.toError(error).message }, "Polling cycle failed");
      }

      const elapsedMs = Date.now() - cycleStart;
      const intervalMs = this.config.pollIntervalSeconds * 1000;
      const sleepMs = Math.max(0, intervalMs - elapsedMs);
      await sleep(sleepMs);
    }
  }

  private async bootstrapAccounts(): Promise<void> {
    for (const account of this.config.accounts) {
      await this.bootstrapAccountIfNeeded(account);
    }
  }

  private async runPollingCycle(): Promise<void> {
    for (const account of this.config.accounts) {
      try {
        const bootstrappedAt = await this.accountStateRepository.getBootstrappedAt(account);
        if (!bootstrappedAt) {
          await this.bootstrapAccountIfNeeded(account);
          continue;
        }

        const posts = await this.provider.fetchLatestPosts(account, {
          includeReplies: true,
          limit: this.config.xFetchLimit
        });

        const filtered = this.filterByConfig(posts);
        const unseen = await this.seenRepository.filterUnseen(filtered);
        const freshUnseen = this.filterOlderThanBootstrap(unseen, bootstrappedAt);
        const freshIds = new Set(freshUnseen.map((post) => post.id));
        const staleUnseen = unseen.filter((post) => !freshIds.has(post.id));

        if (staleUnseen.length > 0) {
          await this.seenRepository.markManySeen(staleUnseen);
        }

        const ordered = freshUnseen.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        this.logger.debug(
          {
            account,
            fetched: posts.length,
            filtered: filtered.length,
            unseen: unseen.length,
            staleSuppressed: staleUnseen.length
          },
          "Polling account"
        );

        for (const post of ordered) {
          await this.processPost(post);
        }
      } catch (error) {
        this.logger.error({ account, error: this.toError(error).message }, "Failed to process account cycle");
      }
    }
  }

  private async bootstrapAccountIfNeeded(account: string): Promise<void> {
    const bootstrapped = await this.accountStateRepository.isBootstrapped(account);
    if (bootstrapped) {
      return;
    }

    try {
      const posts = await this.provider.fetchLatestPosts(account, {
        includeReplies: true,
        limit: this.config.xBootstrapLimit
      });

      // Bootstrap should mark all currently visible content as seen to prevent historical flood,
      // even if specific post types are disabled in runtime config.
      await this.seenRepository.markManySeen(posts);
      await this.accountStateRepository.markBootstrapped(account, new Date().toISOString());
      this.logger.info(
        { account, totalFetched: posts.length, markedAsSeen: posts.length },
        "Bootstrap completed without Telegram sending"
      );
    } catch (error) {
      this.logger.error(
        { account, error: this.toError(error).message },
        "Bootstrap failed for account, will retry in next polling cycle"
      );
    }
  }

  private filterOlderThanBootstrap(posts: NormalizedPost[], bootstrappedAt: string): NormalizedPost[] {
    const bootstrapMs = Date.parse(bootstrappedAt);
    if (!Number.isFinite(bootstrapMs)) {
      return posts;
    }

    return posts.filter((post) => {
      const postMs = Date.parse(post.createdAt);
      if (!Number.isFinite(postMs)) {
        return true;
      }
      return postMs > bootstrapMs;
    });
  }

  private filterByConfig(posts: NormalizedPost[]): NormalizedPost[] {
    return posts.filter((post) => {
      if (post.postType === "reply" && !this.config.includeReplies) {
        return false;
      }
      if (post.postType === "repost" && !this.config.includeReposts) {
        return false;
      }
      if (post.postType === "quote" && !this.config.includeQuotes) {
        return false;
      }
      return true;
    });
  }

  private async processPost(post: NormalizedPost): Promise<void> {
    let translatedText: string | null = null;
    let translationFailed = false;

    if (this.config.sendTranslation) {
      const translation = await this.translationProvider.translate(post.text);
      translatedText = translation.translatedText;
      translationFailed = translation.failed;

      if (translationFailed && !translatedText) {
        translatedText = post.text;
      }
    }

    const enrichedPost: NormalizedPost = {
      ...post,
      translatedText
    };

    const message = formatTelegramMessage(enrichedPost, {
      sendOriginalText: this.config.sendOriginalText,
      sendTranslation: this.config.sendTranslation,
      translationFailed
    });

    await this.telegramService.sendMessage(message);
    await this.seenRepository.markSeen(enrichedPost);

    this.logger.info(
      {
        id: post.id,
        account: post.accountHandle,
        type: post.postType,
        translationFailed
      },
      "Post forwarded to Telegram"
    );
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
