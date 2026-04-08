import { NormalizedPost } from "../types/post";
import { AppDatabase } from "../db/sqlite";

export class SeenPostRepository {
  constructor(private readonly db: AppDatabase) {}

  async has(postId: string): Promise<boolean> {
    const row = await this.db.get<{ id: string }>("SELECT id FROM seen_posts WHERE id = ?", postId);
    return Boolean(row?.id);
  }

  async filterUnseen(posts: NormalizedPost[]): Promise<NormalizedPost[]> {
    if (posts.length === 0) {
      return posts;
    }

    const ids = posts.map((post) => post.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.all<{ id: string }[]>(`SELECT id FROM seen_posts WHERE id IN (${placeholders})`, ids);
    const seen = new Set(rows.map((row) => row.id));

    return posts.filter((post) => !seen.has(post.id));
  }

  async markSeen(post: NormalizedPost): Promise<void> {
    await this.db.run(
      `
        INSERT OR IGNORE INTO seen_posts (
          id,
          account_handle,
          post_type,
          original_author_handle,
          text,
          translated_text,
          url,
          created_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      post.id,
      post.accountHandle,
      post.postType,
      post.originalAuthorHandle ?? null,
      post.text,
      post.translatedText ?? null,
      post.url,
      post.createdAt,
      JSON.stringify(post.rawPayload)
    );
  }

  async markManySeen(posts: NormalizedPost[]): Promise<void> {
    if (posts.length === 0) {
      return;
    }

    await this.db.exec("BEGIN");
    try {
      for (const post of posts) {
        await this.markSeen(post);
      }
      await this.db.exec("COMMIT");
    } catch (error) {
      await this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
