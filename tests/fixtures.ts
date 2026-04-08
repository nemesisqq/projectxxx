import { NormalizedPost } from "../src/types/post";

export function createPost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    id: "1",
    accountHandle: "karpathy",
    postType: "post",
    text: "Hello world",
    translatedText: "Привет мир",
    url: "https://x.com/karpathy/status/1",
    createdAt: "2026-04-08T09:00:00.000Z",
    mediaUrls: [],
    rawPayload: { source: "test" },
    ...overrides
  };
}
