import { PersistenceError, isDatabaseBusy } from "./errors.js";
import { assertCompatibleSchema, runMigrations } from "./migrations.js";
import { resolveStorePath } from "./path.js";
import { assertFullIntegrity, configureConnection, openDatabase, type InternalDatabase } from "./sqlite.js";
import type { ApplicationState, IntegrityReport, StoreStatus } from "./store-types.js";
import { WriteCoordinator, type StoreTransaction } from "./write-coordinator.js";

export interface OpenInternalStoreOptions {
  readonly dataDirectory?: string;
}

const openStores = new Map<string, Promise<InternalStore>>();

export interface InternalStore {
  getState(): ApplicationState;
  getStatus(): StoreStatus;
  recordStartup(at?: string, signal?: AbortSignal): Promise<ApplicationState>;
  writeTransaction<T>(work: (transaction: StoreTransaction) => T, signal?: AbortSignal): Promise<T>;
  checkIntegrity(): IntegrityReport;
  checkpoint(): Promise<{ busy: number; logFrames: number; checkpointedFrames: number }>;
  close(): Promise<void>;
}

class InternalStoreImpl implements InternalStore {
  #closed = false;
  #closePromise: Promise<void> | undefined;
  readonly #database: InternalDatabase;
  readonly #writes: WriteCoordinator;
  readonly #configuration: ReturnType<typeof configureConnection>;
  readonly #onClosed: () => void;

  constructor(
    database: InternalDatabase,
    writes: WriteCoordinator,
    configuration: ReturnType<typeof configureConnection>,
    onClosed: () => void
  ) {
    this.#database = database;
    this.#writes = writes;
    this.#configuration = configuration;
    this.#onClosed = onClosed;
  }

  getState(): ApplicationState {
    this.ensureOpen();
    try {
      const row = this.#database
        .prepare("SELECT instance_id, created_at, last_started_at, startup_count FROM application_state WHERE singleton = 1")
        .get() as ApplicationState | undefined;
      if (!row) throw new PersistenceError("MIGRATION_HISTORY_INVALID", "Application state row is missing");
      return row;
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError("DATABASE_OPEN_FAILED", "Application state could not be read");
    }
  }

  getStatus(): StoreStatus {
    const state = this.getState();
    const versionRow = this.#database.prepare("PRAGMA user_version;").get() as { user_version?: number } | undefined;
    return {
      ...state,
      schemaVersion: versionRow?.user_version ?? 0,
      journalMode: this.#configuration.journalMode,
      foreignKeysEnabled: this.#configuration.foreignKeys,
      busyTimeoutMs: this.#configuration.busyTimeoutMs,
      synchronous: this.#configuration.synchronous
    };
  }

  recordStartup(at?: string, signal?: AbortSignal): Promise<ApplicationState> {
    return this.writeTransaction((transaction) => transaction.recordStartup(at), signal);
  }

  writeTransaction<T>(work: (transaction: StoreTransaction) => T, signal?: AbortSignal): Promise<T> {
    this.ensureOpen();
    return this.#writes.enqueue(work, signal);
  }

  checkIntegrity(): IntegrityReport {
    this.ensureOpen();
    assertFullIntegrity(this.#database);
    const journal = this.#database.prepare("PRAGMA journal_mode;").get() as { journal_mode?: string } | undefined;
    const foreignKeys = this.#database.prepare("PRAGMA foreign_keys;").get() as { foreign_keys?: number } | undefined;
    const version = this.#database.prepare("PRAGMA user_version;").get() as { user_version?: number } | undefined;
    if (journal?.journal_mode?.toLowerCase() !== "wal" || foreignKeys?.foreign_keys !== 1) {
      throw new PersistenceError("DATABASE_CONFIGURATION_FAILED", "SQLite connection configuration changed unexpectedly");
    }
    return {
      schemaVersion: version?.user_version ?? 0,
      integrity: "ok",
      foreignKeyViolations: 0,
      journalMode: "wal",
      foreignKeysEnabled: true
    };
  }

  checkpoint(): Promise<{ busy: number; logFrames: number; checkpointedFrames: number }> {
    this.ensureOpen();
    return this.#writes.checkpoint();
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#writes.close().finally(this.#onClosed);
    return this.#closePromise;
  }

  private ensureOpen(): void {
    if (this.#closed) throw new PersistenceError("DATABASE_CLOSED", "Internal persistence is closed");
  }
}

async function initializeStore(databaseFile: string, onClosed: () => void): Promise<InternalStore> {
  const database = openDatabase(databaseFile);

  try {
    // Read-only checks happen before enabling persistent WAL mode. Newer/invalid schemas are never rewritten.
    assertCompatibleSchema(database);
    const configuration = configureConnection(database);
    runMigrations(database);
    assertFullIntegrity(database);

    const writes = new WriteCoordinator(database);
    const store = new InternalStoreImpl(database, writes, configuration, onClosed);
    await store.writeTransaction((transaction) => transaction.recordStartup());
    return store;
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the original typed initialization failure.
    }
    if (error instanceof PersistenceError) throw error;
    if (isDatabaseBusy(error)) throw new PersistenceError("DATABASE_BUSY", "SQLite database is locked during startup");
    throw new PersistenceError("DATABASE_OPEN_FAILED", "Internal SQLite initialization failed");
  }
}

export async function openInternalStore(options: OpenInternalStoreOptions = {}): Promise<InternalStore> {
  const path = resolveStorePath(options.dataDirectory);
  const existing = openStores.get(path.directory);
  if (existing) return existing;

  const openingHolder: { promise?: Promise<InternalStore> } = {};
  const onClosed = (): void => {
    if (openingHolder.promise && openStores.get(path.directory) === openingHolder.promise) {
      openStores.delete(path.directory);
    }
  };
  const opening = initializeStore(path.databaseFile, onClosed);
  openingHolder.promise = opening;
  openStores.set(path.directory, opening);

  try {
    return await opening;
  } catch (error) {
    if (openStores.get(path.directory) === opening) openStores.delete(path.directory);
    throw error;
  }
}
