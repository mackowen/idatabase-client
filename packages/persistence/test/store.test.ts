import { lstatSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openInternalStore, PersistenceError } from "../src/index.js";
import { createTemporaryDataDirectory } from "./helpers.js";

describe("internal SQLite store", () => {
  it("creates a private database, applies migrations, and verifies effective settings", async () => {
    const directory = createTemporaryDataDirectory();
    const store = await openInternalStore({ dataDirectory: directory });

    try {
      const status = store.getStatus();
      expect(status.schemaVersion).toBe(2);
      expect(status.startup_count).toBe(1);
      expect(status.instance_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(status.journalMode).toBe("wal");
      expect(status.foreignKeysEnabled).toBe(true);
      expect(status.busyTimeoutMs).toBe(250);
      expect(status.synchronous).toBe("full");
      expect(store.checkIntegrity()).toEqual({
        schemaVersion: 2,
        integrity: "ok",
        foreignKeyViolations: 0,
        journalMode: "wal",
        foreignKeysEnabled: true
      });

      const directoryMode = statSync(directory).mode & 0o777;
      const fileMode = statSync(join(directory, "idatabase.sqlite")).mode & 0o777;
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);

      const database = new DatabaseSync(join(directory, "idatabase.sqlite"));
      try {
        expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
        expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
        expect(database.prepare("SELECT version, migration_id FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, migration_id: "001-migration-ledger" },
          { version: 2, migration_id: "002-application-state" }
        ]);
      } finally {
        database.close();
      }
    } finally {
      await store.close();
    }
  });

  it("preserves installation metadata across close and reopen", async () => {
    const directory = createTemporaryDataDirectory();
    const [first, concurrentOpen] = await Promise.all([
      openInternalStore({ dataDirectory: directory }),
      openInternalStore({ dataDirectory: directory })
    ]);
    expect(concurrentOpen).toBe(first);
    const original = first.getState();
    await first.close();

    const reopened = await openInternalStore({ dataDirectory: directory });
    try {
      const current = reopened.getState();
      expect(current.instance_id).toBe(original.instance_id);
      expect(current.created_at).toBe(original.created_at);
      expect(current.startup_count).toBe(2);
      expect(reopened.checkIntegrity().integrity).toBe("ok");
    } finally {
      await reopened.close();
    }
  });

  it("serializes concurrent writes and resolves only after each commit", async () => {
    const store = await openInternalStore({ dataDirectory: createTemporaryDataDirectory() });
    try {
      const operations = Array.from({ length: 32 }, (_, index) =>
        store.recordStartup(`2026-11-05T00:00:${String(index).padStart(2, "0")}.000Z`)
      );
      const committedStates = await Promise.all(operations);
      expect(committedStates.map((state) => state.startup_count).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 32 }, (_, index) => index + 2)
      );
      expect(store.getState().startup_count).toBe(33);
    } finally {
      await store.close();
    }
  });

  it("rolls back failed and cancelled transactions without reporting success", async () => {
    const store = await openInternalStore({ dataDirectory: createTemporaryDataDirectory() });
    const before = store.getState();
    try {
      await expect(
        store.writeTransaction((transaction) => {
          transaction.recordStartup("2026-11-05T00:01:00.000Z");
          throw new Error("synthetic failure");
        })
      ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
      expect(store.getState().startup_count).toBe(before.startup_count);

      const abortedBeforeStart = new AbortController();
      abortedBeforeStart.abort();
      await expect(store.recordStartup(undefined, abortedBeforeStart.signal)).rejects.toMatchObject({ code: "WRITE_CANCELLED" });

      const abortedBeforeCommit = new AbortController();
      await expect(
        store.writeTransaction((transaction) => {
          transaction.recordStartup("2026-11-05T00:02:00.000Z");
          abortedBeforeCommit.abort();
          return "not-committed";
        }, abortedBeforeCommit.signal)
      ).rejects.toMatchObject({ code: "WRITE_CANCELLED" });
      expect(store.getState().startup_count).toBe(before.startup_count);
    } finally {
      await store.close();
    }
  });

  it("reports a real interconnection lock after the configured busy timeout without retry", async () => {
    const directory = createTemporaryDataDirectory();
    const store = await openInternalStore({ dataDirectory: directory });
    const blocker = new DatabaseSync(join(directory, "idatabase.sqlite"));
    try {
      blocker.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;");
      const before = store.getState().startup_count;
      await expect(store.recordStartup()).rejects.toMatchObject({ code: "DATABASE_BUSY" });
      expect(store.getState().startup_count).toBe(before);
      blocker.exec("ROLLBACK;");
    } finally {
      try {
        blocker.close();
      } finally {
        await store.close();
      }
    }
  });

  it("waits for accepted writes on close and rejects new operations", async () => {
    const store = await openInternalStore({ dataDirectory: createTemporaryDataDirectory() });
    const accepted = store.recordStartup();
    const closing = store.close();
    const committed = await accepted;
    await closing;

    expect(committed.startup_count).toBe(2);
    expect(store.close()).toBe(closing);
    expect(() => store.getState()).toThrowError(PersistenceError);
    expect(() => store.recordStartup()).toThrowError(PersistenceError);
  });

  it("rejects relative paths and symbolic-link directories", async () => {
    await expect(openInternalStore({ dataDirectory: "relative-store" })).rejects.toMatchObject({ code: "PATH_NOT_ABSOLUTE" });

    const target = createTemporaryDataDirectory();
    const linkParent = mkdtempSync(join(tmpdir(), "idb-link-test-"));
    const link = join(linkParent, "linked-store");
    try {
      // Termux app-private filesystem supports symlinks; the internal path resolver must reject them.
      symlinkSync(target, link, "dir");
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      await expect(openInternalStore({ dataDirectory: link })).rejects.toMatchObject({ code: "PATH_NOT_SECURE" });
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
    }
  });
});
