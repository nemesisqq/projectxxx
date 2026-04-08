export type PostType = "post" | "repost" | "quote" | "reply";

export interface NormalizedPost {
  id: string;
  accountHandle: string;
  postType: PostType;
  originalAuthorHandle?: string;
  text: string;
  translatedText?: string | null;
  url: string;
  createdAt: string;
  mediaUrls: string[];
  rawPayload: unknown;
}
