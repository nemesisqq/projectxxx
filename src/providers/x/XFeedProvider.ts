import { NormalizedPost } from "../../types/post";

export interface XFetchOptions {
  includeReplies: boolean;
  limit: number;
}

export interface XFeedProvider {
  fetchLatestPosts(accountHandle: string, options: XFetchOptions): Promise<NormalizedPost[]>;
  close(): Promise<void>;
}
