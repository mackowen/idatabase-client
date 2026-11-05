import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { PersistenceError } from "../src/errors.js";
import { defineMigration, runMigrations } from "../src/migrations.js";
import { WriteCoordinator } from "../src/write-coordinator.js";

const migrationSet = [
  defineMigration(
    1,
    "001-test-ledger",
    `CREATE TABLE schema_migrations (
       version INTEGER PRIMARY KEY,
       migration_id TEXT NOT NULL UNIQUE,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL
     ) STRICT;
     CREATE TABLE parent(id INTEGER PRIMARY KEY);
     CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));`
  ),
  defineMigration(2, "002-test-index", "CREATE INDEX child_parent_id_idx ON child(parent_id);")
] as const;

describe("versioned SQLite migrations", () => {
  it("applies multiple migrations transactionally and enables foreign keys in the connection", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      expect(runMigrations(database, migrationSet)).toBe(2);
      expect(runMigrations(database, migrationSet)).toBe(2);
      expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
      expect(database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({ count: 2 });
      expect(() => database.prepare("INSERT INTO child VALUES (999)").run()).toThrow();
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      database.close();
    }
  });

  it("rolls a failed migration back without partial schema or version advancement", () => {
    const database = new DatabaseSync(":memory:");
    const failingMigrations = [
      migrationSet[0],
      defineMigration(2, "002-fails-atomically", "CREATE TABLE partial_marker(id INTEGER); INSERT INTO table_that_does_not_exist VALUES (1);")
    ] as const;

    try {
      database.exec("PRAGMA foreign_keys=ON;");
      expect(() => runMigrations(database, failingMigrations)).toThrowError(
        expect.objectContaining({ code: "MIGRATION_FAILED", migrationId: "002-fails-atomically" })
      );
      expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
      expect(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='partial_marker'").get()).toBeUndefined();
      expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }]);
    } finally {
      database.close();
    }
  });

  it("rejects a changed checksum for an already applied migration", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys=ON;");
      runMigrations(database, migrationSet);
      const changed = [
        defineMigration(1, "001-test-ledger", `${migrationSet[0].sql}\n-- changed`),
        migrationSet[1]
      ] as const;
      expect(() => runMigrations(database, changed)).toThrowError(
        expect.objectContaining({ code: "MIGRATION_CHECKSUM_MISMATCH", migrationId: "001-test-ledger" })
      );
      expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    } finally {
      database.close();
    }
  });

  it("uses typed errors for an invalid migration registry", () => {
    const database = new DatabaseSync(":memory:");
    try {
      expect(() => runMigrations(database, [migrationSet[1]])).toThrowError(
        expect.objectContaining({ name: "PersistenceError", code: "MIGRATION_HISTORY_INVALID" })
      );
      expect(() => {
        throw new PersistenceError("MIGRATION_FAILED", "sanitized");
      }).toThrowError(PersistenceError);
    } finally {
      database.close();
    }
  });

  it("does not claim success or retry when commit reports an uncertain outcome", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE application_state (
        singleton INTEGER PRIMARY KEY,
        instance_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_started_at TEXT NOT NULL,
        startup_count INTEGER NOT NULL
      );
      INSERT INTO application_state VALUES (1, '00000000-0000-4000-8000-000000000001', 'created', 'started', 1);
    `);
    const originalExec = database.exec.bind(database);
    Object.defineProperty(database, "exec", {
      configurable: true,
      value: (sql: string): void => {
        if (sql === "COMMIT;") throw new Error("simulated commit acknowledgement failure");
        originalExec(sql);
      }
    });
    const coordinator = new WriteCoordinator(database);

    try {
      await expect(coordinator.enqueue((transaction) => transaction.recordStartup())).rejects.toMatchObject({
        code: "COMMIT_OUTCOME_UNKNOWN"
      });
      await expect(coordinator.enqueue((transaction) => transaction.recordStartup())).rejects.toMatchObject({
        code: "COMMIT_OUTCOME_UNKNOWN"
      });
      expect(database.prepare("SELECT startup_count FROM application_state WHERE singleton=1").get()).toEqual({ startup_count: 1 });
    } finally {
      await coordinator.close();
    }
  });
});
