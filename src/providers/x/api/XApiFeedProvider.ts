import { Logger } from "../../../logging/logger";
import { NormalizedPost, PostType } from "../../../types/post";
import { withRetry } from "../../../utils/retry";
import { XFeedProvider, XFetchOptions } from "../XFeedProvider";
import {
  XApiMedia,
  XApiTweet,
  XApiUser,
  XApiUserLookupResponse,
  XApiUserTweetsResponse
} from "./types";

export interface XApiFeedProviderOptions {
  bearerToken: string;
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

export class XApiFeedProvider implements XFeedProvider {
  private readonly options: XApiFeedProviderOptions;
  private readonly logger: Logger;
  private readonly baseUrl: URL;
  private readonly userIdCache = new Map<string, string>();

  constructor(options: XApiFeedProviderOptions, logger: Logger) {
    this.options = options;
    this.logger = logger.child({ module: "XApiFeedProvider" });
    this.baseUrl = new URL(options.baseUrl);
  }

  async fetchLatestPosts(accountHandle: string, options: XFetchOptions): Promise<NormalizedPost[]> {
    const handle = accountHandle.toLowerCase();
    const userId = await this.resolveUserId(handle);

    const params = new URLSearchParams();
    params.set("max_results", String(Math.max(5, Math.min(100, options.limit))));
    if (!options.includeReplies) {
      params.set("exclude", "replies");
    }
    params.set(
      "tweet.fields",
      "id,author_id,created_at,text,referenced_tweets,attachments,in_reply_to_user_id,note_tweet"
    );
    params.set(
      "expansions",
      "attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,referenced_tweets.id.attachments.media_keys"
    );
    params.set("user.fields", "id,username");
    params.set("media.fields", "media_key,type,url,preview_image_url,variants");

    const payload = await this.requestJson<XApiUserTweetsResponse>(
      `/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`
    );
    const data = payload.data ?? [];

    const includeTweets = new Map<string, XApiTweet>((payload.includes?.tweets ?? []).map((t) => [t.id, t]));
    const includeUsers = new Map<string, XApiUser>((payload.includes?.users ?? []).map((u) => [u.id, u]));
    const includeMedia = new Map<string, XApiMedia>(
      (payload.includes?.media ?? []).map((m) => [m.media_key, m])
    );

    const posts = data
      .map((tweet) => this.normalizeTweet(tweet, handle, includeTweets, includeUsers, includeMedia))
      .filter((post): post is NormalizedPost => Boolean(post))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, options.limit);

    return posts;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  private async resolveUserId(handle: string): Promise<string> {
    const cached = this.userIdCache.get(handle);
    if (cached) {
      return cached;
    }

    const payload = await this.requestJson<XApiUserLookupResponse>(
      `/2/users/by/username/${encodeURIComponent(handle)}?user.fields=id,username`
    );

    const userId = payload.data?.id;
    if (!userId) {
      const details = payload.errors?.map((error) => error.detail ?? error.message ?? error.title).join("; ");
      throw new Error(`Failed to resolve user id for @${handle}${details ? `: ${details}` : ""}`);
    }

    this.userIdCache.set(handle, userId);
    return userId;
  }

  private normalizeTweet(
    tweet: XApiTweet,
    accountHandle: string,
    includeTweets: Map<string, XApiTweet>,
    includeUsers: Map<string, XApiUser>,
    includeMedia: Map<string, XApiMedia>
  ): NormalizedPost | null {
    const referenced = tweet.referenced_tweets ?? [];
    const retweetRef = referenced.find((item) => item.type === "retweeted");
    const quoteRef = referenced.find((item) => item.type === "quoted");
    const replyRef = referenced.find((item) => item.type === "replied_to");

    let postType: PostType = "post";
    if (retweetRef) {
      postType = "repost";
    } else if (quoteRef) {
      postType = "quote";
    } else if (replyRef || tweet.in_reply_to_user_id) {
      postType = "reply";
    }

    const sourceTweet = retweetRef ? includeTweets.get(retweetRef.id) ?? tweet : tweet;
    const text = extractTweetText(sourceTweet);

    const targetRefId = retweetRef?.id ?? quoteRef?.id;
    const targetTweet = targetRefId ? includeTweets.get(targetRefId) : undefined;
    const originalAuthorHandle =
      targetTweet?.author_id ? includeUsers.get(targetTweet.author_id)?.username?.toLowerCase() : undefined;

    const url =
      postType === "repost" && retweetRef
        ? `https://x.com/${originalAuthorHandle ?? accountHandle}/status/${retweetRef.id}`
        : `https://x.com/${accountHandle}/status/${tweet.id}`;

    const mediaSourceTweet = sourceTweet;
    const mediaUrls = collectMediaUrls(mediaSourceTweet, includeMedia);

    return {
      id: tweet.id,
      accountHandle,
      postType,
      originalAuthorHandle,
      text,
      translatedText: null,
      url,
      createdAt: toIso(tweet.created_at),
      mediaUrls,
      rawPayload: {
        tweet,
        sourceTweet,
        targetTweet
      }
    };
  }

  private async requestJson<T>(pathWithQuery: string): Promise<T> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
          const url = new URL(pathWithQuery, this.baseUrl);
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${this.options.bearerToken}`,
              "User-Agent": "x-telegram-monitor/1.0"
            },
            signal: controller.signal
          });

          const body = await response.text();
          if (!response.ok) {
            throw new Error(`X API HTTP ${response.status}: ${body}`);
          }

          return JSON.parse(body) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        retries: this.options.retries,
        initialDelayMs: this.options.retryDelayMs,
        onRetry: (attempt, error, delayMs) => {
          this.logger.warn({ attempt, delayMs, error: error.message }, "X API request failed, retrying");
        }
      }
    );
  }
}

function extractTweetText(tweet: XApiTweet): string {
  return tweet.note_tweet?.note_tweet_results?.result?.text?.trim() || tweet.text?.trim() || "";
}

function toIso(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function collectMediaUrls(tweet: XApiTweet, mediaMap: Map<string, XApiMedia>): string[] {
  const urls = new Set<string>();
  for (const mediaKey of tweet.attachments?.media_keys ?? []) {
    const media = mediaMap.get(mediaKey);
    if (!media) {
      continue;
    }

    if (media.url) {
      urls.add(media.url);
    } else if (media.preview_image_url) {
      urls.add(media.preview_image_url);
    } else if (Array.isArray(media.variants) && media.variants.length > 0) {
      const bestVariant = [...media.variants]
        .filter((variant) => Boolean(variant.url))
        .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
      if (bestVariant?.url) {
        urls.add(bestVariant.url);
      }
    }
  }

  return Array.from(urls);
}
