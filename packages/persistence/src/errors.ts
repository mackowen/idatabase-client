export type PersistenceErrorCode =
  | "PATH_NOT_ABSOLUTE"
  | "PATH_NOT_SECURE"
  | "DATABASE_OPEN_FAILED"
  | "DATABASE_CONFIGURATION_FAILED"
  | "DATABASE_BUSY"
  | "DATABASE_CLOSED"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "MIGRATION_HISTORY_INVALID"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_FAILED"
  | "MIGRATION_ROLLBACK_FAILED"
  | "MIGRATION_COMMIT_UNKNOWN"
  | "TRANSACTION_FAILED"
  | "TRANSACTION_ROLLBACK_FAILED"
  | "INTEGRITY_CHECK_FAILED"
  | "FOREIGN_KEY_CHECK_FAILED"
  | "WRITE_CANCELLED"
  | "ASYNC_TRANSACTION_NOT_SUPPORTED"
  | "COMMIT_OUTCOME_UNKNOWN";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly migrationId?: string;

  constructor(code: PersistenceErrorCode, message: string, migrationId?: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    if (migrationId) this.migrationId = migrationId;
  }
}

export function isDatabaseBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as Error & { errcode?: number; code?: string };
  return (
    (typeof sqliteError.errcode === "number" && (sqliteError.errcode & 0xff) === 5) ||
    sqliteError.code?.includes("SQLITE_BUSY") === true ||
    error.message.toLowerCase().includes("database is locked")
  );
}
