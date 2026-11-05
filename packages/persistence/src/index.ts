export { PersistenceError, type PersistenceErrorCode } from "./errors.js";
export { openInternalStore, type InternalStore, type OpenInternalStoreOptions } from "./store.js";
export type { ApplicationState, IntegrityReport, StoreStatus } from "./store-types.js";
export type { StoreTransaction } from "./write-coordinator.js";
