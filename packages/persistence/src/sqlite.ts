import { DatabaseSync } from "node:sqlite";
import { PersistenceError, isDatabaseBusy } from "./errors.js";

export type InternalDatabase = DatabaseSync;

export interface SQLiteConfiguration {
  readonly journalMode: "wal";
  readonly foreignKeys: true;
  readonly busyTimeoutMs: number;
  readonly synchronous: "full";
}

export const INTERNAL_BUSY_TIMEOUT_MS = 250;

export function openDatabase(file: string): InternalDatabase {
  try {
    return new DatabaseSync(file);
  } catch {
    throw new PersistenceError("DATABASE_OPEN_FAILED", "Internal SQLite database could not be opened");
  }
}

export function configureConnection(database: InternalDatabase): SQLiteConfiguration {
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec(`PRAGMA busy_timeout = ${INTERNAL_BUSY_TIMEOUT_MS};`);
    database.exec("PRAGMA synchronous = FULL;");

    const foreignKeys = database.prepare("PRAGMA foreign_keys;").get() as { foreign_keys?: number } | undefined;
    const busyTimeout = database.prepare("PRAGMA busy_timeout;").get() as { timeout?: number } | undefined;
    const synchronous = database.prepare("PRAGMA synchronous;").get() as { synchronous?: number } | undefined;

    if (foreignKeys?.foreign_keys !== 1 || busyTimeout?.timeout !== INTERNAL_BUSY_TIMEOUT_MS || synchronous?.synchronous !== 2) {
      throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite connection settings did not take effect");
    }

    const journal = database.prepare("PRAGMA journal_mode = WAL;").get() as { journal_mode?: string } | undefined;
    if (journal?.journal_mode?.toLowerCase() !== "wal") {
      throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite WAL mode could not be enabled");
    }

    const verifiedMode = database.prepare("PRAGMA journal_mode;").get() as { journal_mode?: string } | undefined;
    if (verifiedMode?.journal_mode?.toLowerCase() !== "wal") {
      throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite WAL mode is not active");
    }

    return {
      journalMode: "wal",
      foreignKeys: true,
      busyTimeoutMs: INTERNAL_BUSY_TIMEOUT_MS,
      synchronous: "full"
    };
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    if (isDatabaseBusy(error)) {
      throw new PersistenceError("DATABASE_BUSY", "SQLite database is locked during configuration");
    }
    throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite connection configuration failed");
  }
}

export function assertIntegrity(database: InternalDatabase): void {
  let check: { quick_check?: string } | undefined;
  try {
    check = database.prepare("PRAGMA quick_check;").get() as { quick_check?: string } | undefined;
  } catch {
    throw new PersistenceError("INTEGRITY_CHECK_FAILED", "SQLite integrity check could not be completed");
  }
  if (check?.quick_check !== "ok") {
    throw new PersistenceError("INTEGRITY_CHECK_FAILED", "SQLite integrity check reported a problem");
  }
}

export function assertFullIntegrity(database: InternalDatabase): void {
  let checks: Array<{ integrity_check?: string }>;
  try {
    checks = database.prepare("PRAGMA integrity_check;").all() as Array<{ integrity_check?: string }>;
  } catch {
    throw new PersistenceError("INTEGRITY_CHECK_FAILED", "SQLite integrity check could not be completed");
  }
  if (checks.length !== 1 || checks[0]?.integrity_check !== "ok") {
    throw new PersistenceError("INTEGRITY_CHECK_FAILED", "SQLite integrity check reported a problem");
  }

  let violations: unknown[];
  try {
    violations = database.prepare("PRAGMA foreign_key_check;").all();
  } catch {
    throw new PersistenceError("FOREIGN_KEY_CHECK_FAILED", "SQLite foreign key check could not be completed");
  }
  if (violations.length > 0) {
    throw new PersistenceError("FOREIGN_KEY_CHECK_FAILED", "SQLite foreign key check reported a problem");
  }
}
