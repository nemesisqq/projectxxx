import { AppDatabase } from "./sqlite";

export async function initializeDatabase(db: AppDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS seen_posts (
      id TEXT PRIMARY KEY,
      account_handle TEXT NOT NULL,
      post_type TEXT NOT NULL,
      original_author_handle TEXT,
      text TEXT NOT NULL,
      translated_text TEXT,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_seen_posts_account_handle
      ON seen_posts(account_handle);

    CREATE TABLE IF NOT EXISTS account_state (
      account_handle TEXT PRIMARY KEY,
      bootstrapped_at TEXT NOT NULL
    );
  `);
}
