import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";

export type AppDatabase = Database<sqlite3.Database, sqlite3.Statement>;

export async function createDatabase(filename: string): Promise<AppDatabase> {
  const inMemory = filename === ":memory:" || filename.startsWith("file::memory:");
  const targetFilename = inMemory ? filename : path.resolve(filename);

  if (!inMemory) {
    const dir = path.dirname(targetFilename);
    await mkdir(dir, { recursive: true });
  }

  const db = await open({
    filename: targetFilename,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA busy_timeout = 5000;");
  await db.exec("PRAGMA foreign_keys = ON;");

  return db;
}
