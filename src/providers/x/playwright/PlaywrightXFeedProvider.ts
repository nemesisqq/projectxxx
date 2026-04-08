import { Browser, BrowserContext, chromium } from "playwright-core";
import { access } from "node:fs/promises";
import path from "node:path";
import { Logger } from "../../../logging/logger";
import { NormalizedPost, PostType } from "../../../types/post";
import { XFeedProvider, XFetchOptions } from "../XFeedProvider";
import { PROFILE_TWEET_SELECTOR, TIMELINE_RESPONSE_PATTERNS } from "./selectors";
import { RawTweet, RawTweetLegacy } from "./types";

export interface PlaywrightProviderOptions {
  browserChannel?: string;
  browserExecutablePath?: string;
  storageStatePath?: string;
  cdpUrl?: string;
  headless: boolean;
  navigationTimeoutMs: number;
  fetchTimeoutMs: number;
}

export class PlaywrightXFeedProvider implements XFeedProvider {
  private browser?: Browser;
  private ownsBrowserProcess = false;
  private readonly options: PlaywrightProviderOptions;
  private readonly logger: Logger;

  constructor(options: PlaywrightProviderOptions, logger: Logger) {
    this.options = options;
    this.logger = logger.child({ module: "PlaywrightXFeedProvider" });
  }

  async fetchLatestPosts(accountHandle: string, options: XFetchOptions): Promise<NormalizedPost[]> {
    const browser = await this.getBrowser();
    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    };

    if (this.options.storageStatePath) {
      const resolved = path.resolve(this.options.storageStatePath);
      try {
        await access(resolved);
        contextOptions.storageState = resolved;
      } catch {
        this.logger.warn(
          { storageStatePath: resolved },
          "X storage state path is configured but file is missing"
        );
      }
    }

    const useCdpContext = Boolean(this.options.cdpUrl);
    const context = useCdpContext ? this.getCdpContext(browser) : await browser.newContext(contextOptions);
    const shouldCloseContext = !useCdpContext;

    const page = await context.newPage();
    const tweets = new Map<string, RawTweet>();
    const normalizedHandle = accountHandle.toLowerCase();

    page.on("response", async (response) => {
      try {
        if (!this.isTimelineResponse(response.url())) {
          return;
        }

        const contentType = response.headers()["content-type"] ?? "";
        if (!contentType.includes("application/json")) {
          return;
        }

        const payload = await response.json();
        for (const tweet of this.extractTimelineTweets(payload)) {
          tweets.set(tweet.rest_id, tweet);
        }
      } catch (error) {
        this.logger.debug(
          { accountHandle: normalizedHandle, error: this.toError(error).message },
          "Failed to parse timeline response"
        );
      }
    });

    try {
      await page.goto(`https://x.com/${normalizedHandle}`, {
        waitUntil: "domcontentloaded",
        timeout: this.options.navigationTimeoutMs
      });

      try {
        await page.waitForSelector(PROFILE_TWEET_SELECTOR, { timeout: this.options.fetchTimeoutMs });
      } catch {
        const pageUrl = page.url();
        let pageTitle = "";
        try {
          pageTitle = await page.title();
        } catch {
          pageTitle = "";
        }

        this.logger.warn(
          { accountHandle: normalizedHandle, pageUrl, pageTitle },
          "Tweet selector not found within timeout"
        );
      }

      await page.waitForTimeout(2000);
    } finally {
      await this.safeClosePage(page, normalizedHandle);
      if (shouldCloseContext) {
        await this.safeCloseContext(context, normalizedHandle);
      }
    }

    const posts = Array.from(tweets.values())
      .map((tweet) => this.toNormalizedPost(tweet, normalizedHandle))
      .filter((post): post is NormalizedPost => Boolean(post));

    const unique = new Map<string, NormalizedPost>();
    for (const post of posts) {
      unique.set(post.id, post);
    }

    return Array.from(unique.values())
      .filter((post) => options.includeReplies || post.postType !== "reply")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, options.limit);
  }

  async close(): Promise<void> {
    if (this.browser && this.ownsBrowserProcess) {
      await this.browser.close();
    }
    this.browser = undefined;
    this.ownsBrowserProcess = false;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (this.options.cdpUrl) {
      this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
      this.ownsBrowserProcess = false;
      this.logger.info({ cdpUrl: this.options.cdpUrl }, "Connected to browser over CDP");
      return this.browser;
    }

    this.browser = await chromium.launch({
      headless: this.options.headless,
      channel: this.options.browserChannel,
      executablePath: this.options.browserExecutablePath
    });
    this.ownsBrowserProcess = true;

    return this.browser;
  }

  private getCdpContext(browser: Browser): BrowserContext {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("No browser contexts found for CDP session. Open browser with remote debugging first.");
    }
    return context;
  }

  private async safeClosePage(page: { close: () => Promise<void> }, accountHandle: string): Promise<void> {
    try {
      await page.close();
    } catch (error) {
      const message = this.toError(error).message;
      const isAlreadyClosed =
        message.includes("Target page, context or browser has been closed") ||
        message.includes("Browser has been closed");

      if (isAlreadyClosed) {
        this.logger.debug({ accountHandle }, "Page already closed");
        return;
      }

      this.logger.warn({ accountHandle, error: message }, "Failed to close page cleanly");
    }
  }

  private async safeCloseContext(context: BrowserContext, accountHandle: string): Promise<void> {
    try {
      await context.close();
    } catch (error) {
      const message = this.toError(error).message;
      const isAlreadyClosed =
        message.includes("Target page, context or browser has been closed") ||
        message.includes("Browser has been closed");

      if (isAlreadyClosed) {
        this.logger.debug({ accountHandle }, "Browser context already closed");
        return;
      }

      this.logger.warn(
        { accountHandle, error: message },
        "Failed to close browser context cleanly"
      );
    }
  }

  private isTimelineResponse(url: string): boolean {
    return TIMELINE_RESPONSE_PATTERNS.some((pattern) => url.includes(pattern));
  }

  private extractTimelineTweets(payload: unknown): RawTweet[] {
    const tweets: RawTweet[] = [];

    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          visit(item);
        }
        return;
      }

      const record = node as Record<string, unknown>;
      if ("tweet_results" in record) {
        const tweet = this.unwrapTweet((record.tweet_results as { result?: unknown })?.result);
        if (tweet) {
          tweets.push(tweet);
        }
      }

      for (const value of Object.values(record)) {
        visit(value);
      }
    };

    visit(payload);

    const deduplicated = new Map<string, RawTweet>();
    for (const tweet of tweets) {
      deduplicated.set(tweet.rest_id, tweet);
    }
    return Array.from(deduplicated.values());
  }

  private unwrapTweet(input: unknown): RawTweet | null {
    if (!input || typeof input !== "object") {
      return null;
    }

    const node = input as Record<string, unknown>;
    if (typeof node.rest_id === "string" && this.looksLikeTweet(node)) {
      return node as unknown as RawTweet;
    }

    if ("tweet" in node) {
      return this.unwrapTweet(node.tweet);
    }

    if ("result" in node) {
      return this.unwrapTweet(node.result);
    }

    return null;
  }

  private looksLikeTweet(node: Record<string, unknown>): boolean {
    const legacy = node.legacy;
    if (!legacy || typeof legacy !== "object") {
      return false;
    }

    const candidate = legacy as Record<string, unknown>;
    return typeof candidate.created_at === "string" || typeof candidate.full_text === "string";
  }

  private toNormalizedPost(tweet: RawTweet, accountHandle: string): NormalizedPost | null {
    const authorHandle = this.extractScreenName(tweet.core?.user_results?.result);
    if (!authorHandle || authorHandle !== accountHandle) {
      return null;
    }

    const retweetTarget = this.unwrapTweet(
      tweet.retweeted_status_result?.result ?? tweet.legacy.retweeted_status_result?.result
    );
    const quoteTarget = this.unwrapTweet(tweet.quoted_status_result?.result);
    const isReply = Boolean(tweet.legacy.in_reply_to_status_id_str);

    let postType: PostType = "post";
    if (retweetTarget) {
      postType = "repost";
    } else if (quoteTarget || tweet.legacy.is_quote_status) {
      postType = "quote";
    } else if (isReply) {
      postType = "reply";
    }

    const sourceForText = retweetTarget ?? tweet;
    const sourceLegacy = sourceForText.legacy;
    const createdAt = this.parseDateToIso(tweet.legacy.created_at);

    const originalAuthorHandle =
      this.extractScreenName(retweetTarget?.core?.user_results?.result) ??
      this.extractScreenName(quoteTarget?.core?.user_results?.result);

    const fallbackUrl = `https://x.com/${authorHandle}/status/${tweet.rest_id}`;
    const repostUrl =
      retweetTarget && originalAuthorHandle
        ? `https://x.com/${originalAuthorHandle}/status/${retweetTarget.rest_id}`
        : fallbackUrl;

    const postText = sourceLegacy.full_text?.trim() ?? "";

    return {
      id: tweet.rest_id,
      accountHandle: authorHandle,
      postType,
      originalAuthorHandle: postType === "post" || postType === "reply" ? undefined : originalAuthorHandle,
      text: postText,
      translatedText: null,
      url: postType === "repost" ? repostUrl : fallbackUrl,
      createdAt,
      mediaUrls: this.extractMediaUrls(sourceLegacy),
      rawPayload: tweet
    };
  }

  private extractScreenName(userResult: unknown): string | undefined {
    if (!userResult || typeof userResult !== "object") {
      return undefined;
    }

    const node = userResult as {
      legacy?: { screen_name?: string };
      core?: { screen_name?: string };
    };

    const raw = node.legacy?.screen_name ?? node.core?.screen_name;
    if (!raw) {
      return undefined;
    }
    return raw.toLowerCase();
  }

  private extractMediaUrls(legacy: RawTweetLegacy): string[] {
    const urls = new Set<string>();
    const media = [...(legacy.extended_entities?.media ?? []), ...(legacy.entities?.media ?? [])];
    for (const item of media) {
      const url = item.media_url_https ?? item.media_url;
      if (url) {
        urls.add(url);
      }
    }
    return Array.from(urls);
  }

  private parseDateToIso(value: string | undefined): string {
    if (!value) {
      return new Date().toISOString();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString();
    }
    return parsed.toISOString();
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }
}
