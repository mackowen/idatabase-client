export interface ApplicationState {
  readonly instance_id: string;
  readonly created_at: string;
  readonly last_started_at: string;
  readonly startup_count: number;
}

export interface StoreStatus extends ApplicationState {
  readonly schemaVersion: number;
  readonly journalMode: "wal";
  readonly foreignKeysEnabled: true;
  readonly busyTimeoutMs: number;
  readonly synchronous: "full";
}

export interface IntegrityReport {
  readonly schemaVersion: number;
  readonly integrity: "ok";
  readonly foreignKeyViolations: 0;
  readonly journalMode: "wal";
  readonly foreignKeysEnabled: true;
}
