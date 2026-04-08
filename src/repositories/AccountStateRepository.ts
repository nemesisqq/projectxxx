import { AppDatabase } from "../db/sqlite";

export class AccountStateRepository {
  constructor(private readonly db: AppDatabase) {}

  async getBootstrappedAt(accountHandle: string): Promise<string | null> {
    const row = await this.db.get<{ bootstrapped_at: string }>(
      "SELECT bootstrapped_at FROM account_state WHERE account_handle = ?",
      accountHandle.toLowerCase()
    );
    return row?.bootstrapped_at ?? null;
  }

  async isBootstrapped(accountHandle: string): Promise<boolean> {
    const bootstrappedAt = await this.getBootstrappedAt(accountHandle);
    return Boolean(bootstrappedAt);
  }

  async markBootstrapped(accountHandle: string, bootstrappedAt: string): Promise<void> {
    await this.db.run(
      `
      INSERT INTO account_state (account_handle, bootstrapped_at)
      VALUES (?, ?)
      ON CONFLICT(account_handle) DO UPDATE SET bootstrapped_at = excluded.bootstrapped_at
      `,
      accountHandle.toLowerCase(),
      bootstrappedAt
    );
  }
}
