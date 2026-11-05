import { createHash } from "node:crypto";
import { PersistenceError, isDatabaseBusy } from "./errors.js";
import { assertFullIntegrity, type InternalDatabase } from "./sqlite.js";

export interface Migration {
  readonly version: number;
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

export function defineMigration(version: number, id: string, sql: string): Migration {
  return {
    version,
    id,
    sql,
    checksum: createHash("sha256").update(`${version}\n${id}\n${sql}\n`).digest("hex")
  };
}

export const INTERNAL_MIGRATIONS: readonly Migration[] = [
  defineMigration(
    1,
    "001-migration-ledger",
    `CREATE TABLE schema_migrations (
       version INTEGER PRIMARY KEY CHECK (version > 0),
       migration_id TEXT NOT NULL UNIQUE,
       checksum TEXT NOT NULL CHECK (length(checksum) = 64),
       applied_at TEXT NOT NULL
     ) STRICT;`
  ),
  defineMigration(
    2,
    "002-application-state",
    `CREATE TABLE application_state (
       singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
       instance_id TEXT NOT NULL CHECK (length(instance_id) = 36),
       created_at TEXT NOT NULL,
       last_started_at TEXT NOT NULL,
       startup_count INTEGER NOT NULL CHECK (startup_count >= 1)
     ) STRICT;`
  )
];

interface UserVersionRow {
  readonly user_version?: number;
}

interface MigrationRow {
  readonly version: number;
  readonly migration_id: string;
  readonly checksum: string;
}

function schemaVersion(database: InternalDatabase): number {
  const row = database.prepare("PRAGMA user_version;").get() as UserVersionRow | undefined;
  if (!row || typeof row.user_version !== "number" || row.user_version < 0) {
    throw new PersistenceError("MIGRATION_HISTORY_INVALID", "SQLite schema version is invalid");
  }
  return row.user_version;
}

function tableExists(database: InternalDatabase, tableName: string): boolean {
  const row = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found?: number } | undefined;
  return row?.found === 1;
}

function validateMigrationList(migrations: readonly Migration[]): void {
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index];
    if (!migration || migration.version !== index + 1 || !/^[0-9]{3}-[a-z0-9-]+$/.test(migration.id)) {
      throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration registry is not contiguous and deterministic");
    }
    const expected = createHash("sha256").update(`${migration.version}\n${migration.id}\n${migration.sql}\n`).digest("hex");
    if (expected !== migration.checksum) {
      throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration checksum does not match its definition", migration.id);
    }
  }
}

function verifyAppliedHistory(database: InternalDatabase, version: number, migrations: readonly Migration[]): void {
  const ledgerExists = tableExists(database, "schema_migrations");
  if (version === 0) {
    if (ledgerExists) {
      throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration ledger exists while schema version is zero");
    }
    return;
  }
  if (!ledgerExists) {
    throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration ledger is missing");
  }

  let rows: MigrationRow[];
  try {
    rows = database
      .prepare("SELECT version, migration_id, checksum FROM schema_migrations ORDER BY version")
      .all() as unknown as MigrationRow[];
  } catch {
    throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration ledger cannot be read");
  }
  if (rows.length !== version) {
    throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Migration ledger does not match schema version");
  }

  for (const row of rows) {
    const migration = migrations[row.version - 1];
    if (!migration || migration.version !== row.version || migration.id !== row.migration_id) {
      throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Applied migration is absent from the migration registry");
    }
    if (migration.checksum !== row.checksum) {
      throw new PersistenceError("MIGRATION_CHECKSUM_MISMATCH", "Applied migration checksum differs from the registry", migration.id);
    }
  }
}

function ensureCompatibleVersion(database: InternalDatabase, migrations: readonly Migration[]): number {
  validateMigrationList(migrations);
  const current = schemaVersion(database);
  const latest = migrations.length;
  if (current > latest) {
    throw new PersistenceError("SCHEMA_VERSION_UNSUPPORTED", "Database schema is newer than this application supports");
  }
  assertFullIntegrity(database);
  verifyAppliedHistory(database, current, migrations);
  return current;
}

export function assertCompatibleSchema(database: InternalDatabase, migrations: readonly Migration[] = INTERNAL_MIGRATIONS): void {
  ensureCompatibleVersion(database, migrations);
}

function rollback(database: InternalDatabase, migrationId: string): void {
  try {
    database.exec("ROLLBACK;");
  } catch {
    throw new PersistenceError("MIGRATION_ROLLBACK_FAILED", "Migration rollback failed; database was preserved", migrationId);
  }
}

export function runMigrations(database: InternalDatabase, migrations: readonly Migration[] = INTERNAL_MIGRATIONS): number {
  let current = ensureCompatibleVersion(database, migrations);
  const latest = migrations.length;

  while (current < latest) {
    const migration = migrations[current];
    if (!migration) {
      throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Next migration is missing");
    }

    let begun = false;
    let commitAttempted = false;
    try {
      database.exec("BEGIN IMMEDIATE;");
      begun = true;
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations(version, migration_id, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.id, migration.checksum, new Date().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version};`);
      commitAttempted = true;
      database.exec("COMMIT;");
      begun = false;
      current = migration.version;
    } catch (error) {
      if (commitAttempted) {
        if (begun) {
          try {
            database.exec("ROLLBACK;");
          } catch {
            // Commit outcome remains unknown; never retry automatically.
          }
        }
        throw new PersistenceError("MIGRATION_COMMIT_UNKNOWN", "Migration commit outcome is unknown; inspect schema version before retrying", migration.id);
      }
      if (begun) rollback(database, migration.id);
      if (error instanceof PersistenceError) throw error;
      if (isDatabaseBusy(error)) {
        throw new PersistenceError("DATABASE_BUSY", "SQLite database is locked during migration", migration.id);
      }
      throw new PersistenceError("MIGRATION_FAILED", "Migration failed and was rolled back", migration.id);
    }
  }

  assertFullIntegrity(database);
  return current;
}
