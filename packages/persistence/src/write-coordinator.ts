import { randomUUID } from "node:crypto";
import { PersistenceError, isDatabaseBusy } from "./errors.js";
import type { ApplicationState } from "./store-types.js";
import type { InternalDatabase } from "./sqlite.js";

export interface StoreTransaction {
  getState(): ApplicationState;
  recordStartup(at?: string): ApplicationState;
}

type CoordinatorState = "open" | "uncertain" | "closing" | "closed";

class TransactionSession implements StoreTransaction {
  readonly #database: InternalDatabase;

  constructor(database: InternalDatabase) {
    this.#database = database;
  }

  getState(): ApplicationState {
    const row = this.#database
      .prepare("SELECT instance_id, created_at, last_started_at, startup_count FROM application_state WHERE singleton = 1")
      .get() as ApplicationState | undefined;
    if (!row) throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Application state row is missing");
    return row;
  }

  recordStartup(at = new Date().toISOString()): ApplicationState {
    const existing = this.#database
      .prepare("SELECT instance_id, created_at, last_started_at, startup_count FROM application_state WHERE singleton = 1")
      .get() as ApplicationState | undefined;
    if (!existing) {
      this.#database
        .prepare("INSERT INTO application_state(singleton, instance_id, created_at, last_started_at, startup_count) VALUES (1, ?, ?, ?, 1)")
        .run(randomUUID(), at, at);
    } else {
      this.#database
        .prepare("UPDATE application_state SET last_started_at = ?, startup_count = startup_count + 1 WHERE singleton = 1")
        .run(at);
    }
    return this.getState();
  }
}

export class WriteCoordinator {
  readonly #database: InternalDatabase;
  private tail: Promise<void> = Promise.resolve();
  private state: CoordinatorState = "open";
  private closePromise: Promise<void> | undefined;

  constructor(database: InternalDatabase) {
    this.#database = database;
  }

  enqueue<T>(work: (transaction: StoreTransaction) => T, signal?: AbortSignal): Promise<T> {
    if (this.state === "uncertain") {
      return Promise.reject(new PersistenceError("COMMIT_OUTCOME_UNKNOWN", "Writes are paused until the database is closed and reconciled"));
    }
    if (this.state !== "open") {
      return Promise.reject(new PersistenceError("DATABASE_CLOSED", "Internal persistence is closing or closed"));
    }

    const operation = this.tail.then(() => this.runTransaction(work, signal));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  checkpoint(): Promise<{ busy: number; logFrames: number; checkpointedFrames: number }> {
    if (this.state !== "open") {
      return Promise.reject(new PersistenceError("DATABASE_CLOSED", "Internal persistence is closing or closed"));
    }

    const operation = this.tail.then(() => {
      try {
        const row = this.#database.prepare("PRAGMA wal_checkpoint(PASSIVE);").get() as
          | { busy?: number; log?: number; checkpointed?: number }
          | undefined;
        if (!row || typeof row.busy !== "number" || typeof row.log !== "number" || typeof row.checkpointed !== "number") {
          throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite WAL checkpoint returned an invalid result");
        }
        return { busy: row.busy, logFrames: row.log, checkpointedFrames: row.checkpointed };
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        if (isDatabaseBusy(error)) throw new PersistenceError("DATABASE_BUSY", "SQLite WAL checkpoint is blocked");
        throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite WAL checkpoint failed");
      }
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.tail.then(() => {
      let checkpointFailed = false;
      try {
        this.#database.prepare("PRAGMA wal_checkpoint(PASSIVE);").get();
      } catch {
        checkpointFailed = true;
      }
      try {
        this.#database.close();
      } catch {
        this.state = "closed";
        throw new PersistenceError("DATABASE_OPEN_FAILED", "SQLite connection failed to close");
      }
      this.state = "closed";
      if (checkpointFailed) {
        throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite WAL checkpoint failed during close");
      }
    });
    return this.closePromise;
  }

  private runTransaction<T>(work: (transaction: StoreTransaction) => T, signal?: AbortSignal): T {
    if (this.state === "uncertain") {
      throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN", "Writes are paused until the database is closed and reconciled");
    }
    if (signal?.aborted) {
      throw new PersistenceError("WRITE_CANCELLED", "Write was cancelled before it started");
    }

    let begun = false;
    let commitAttempted = false;
    try {
      this.#database.exec("BEGIN IMMEDIATE;");
      begun = true;
      const result = work(new TransactionSession(this.#database));
      if (result !== null && (typeof result === "object" || typeof result === "function") && "then" in result) {
        throw new PersistenceError("ASYNC_TRANSACTION_NOT_SUPPORTED", "Write transaction callbacks must be synchronous");
      }
      if (signal?.aborted) {
        throw new PersistenceError("WRITE_CANCELLED", "Write was cancelled before commit");
      }
      commitAttempted = true;
      this.#database.exec("COMMIT;");
      begun = false;
      return result;
    } catch (error) {
      if (commitAttempted) {
        this.state = "uncertain";
        if (begun) {
          try {
            this.#database.exec("ROLLBACK;");
          } catch {
            // The outcome remains unknown; callers must reconcile and never auto-retry.
          }
        }
        throw new PersistenceError("COMMIT_OUTCOME_UNKNOWN", "Write commit outcome is unknown; reconcile state before retrying");
      }
      if (begun) {
        try {
          this.#database.exec("ROLLBACK;");
        } catch {
          throw new PersistenceError("TRANSACTION_ROLLBACK_FAILED", "Write rollback failed; database was preserved");
        }
      }
      if (error instanceof PersistenceError) throw error;
      if (isDatabaseBusy(error)) throw new PersistenceError("DATABASE_BUSY", "SQLite database is locked");
      throw new PersistenceError("TRANSACTION_FAILED", "Write transaction failed and was rolled back");
    }
  }
}
