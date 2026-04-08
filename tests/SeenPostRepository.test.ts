import assert from "node:assert/strict";
import { initializeDatabase } from "../src/db/init";
import { createDatabase } from "../src/db/sqlite";
import { SeenPostRepository } from "../src/repositories/SeenPostRepository";
import { createPost } from "./fixtures";

export async function runSeenPostRepositoryTests(): Promise<void> {
  const db = await createDatabase(":memory:");
  await initializeDatabase(db);
  const repo = new SeenPostRepository(db);

  const first = createPost({ id: "100" });
  const second = createPost({ id: "200" });

  await repo.markSeen(first);
  const unseen = await repo.filterUnseen([first, second]);
  assert.equal(unseen.length, 1);
  assert.equal(unseen[0]?.id, "200");

  const duplicate = createPost({ id: "dup" });
  await repo.markSeen(duplicate);
  await repo.markSeen(duplicate);

  const rows = await db.get<{ total: number }>("SELECT COUNT(*) as total FROM seen_posts WHERE id = ?", duplicate.id);
  assert.equal(rows?.total, 1);

  await db.close();
}
