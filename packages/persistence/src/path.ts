import { closeSync, chmodSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { PersistenceError } from "./errors.js";

const DATABASE_FILENAME = "idatabase.sqlite";

export interface ResolvedStorePath {
  readonly directory: string;
  readonly databaseFile: string;
}

function ensureNoSymlinkComponents(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;

  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    try {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        throw new PersistenceError("PATH_NOT_SECURE", "Persistence path contains a symbolic link");
      }
      if (!stat.isDirectory()) {
        throw new PersistenceError("PATH_NOT_SECURE", "Persistence path component is not a directory");
      }
    } catch (error) {
      if (error instanceof PersistenceError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PersistenceError("PATH_NOT_SECURE", "Persistence path cannot be inspected safely");
      }
      try {
        mkdirSync(cursor, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw new PersistenceError("PATH_NOT_SECURE", "Persistence directory could not be created securely");
        }
      }
      const created = lstatSync(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new PersistenceError("PATH_NOT_SECURE", "Persistence path changed during creation");
      }
    }
  }
}

function prepareDirectory(directory: string): void {
  ensureNoSymlinkComponents(directory);
  chmodSync(directory, 0o700);
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new PersistenceError("PATH_NOT_SECURE", "Persistence directory permissions are not private");
  }
}

function prepareDatabaseFile(file: string): void {
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PersistenceError("PATH_NOT_SECURE", "Persistence database path is not a regular file");
    }
    chmodSync(file, 0o600);
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PersistenceError("PATH_NOT_SECURE", "Persistence database file cannot be inspected safely");
    }

    let descriptor: number | undefined;
    try {
      descriptor = openSync(file, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600);
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new PersistenceError("PATH_NOT_SECURE", "Persistence database file could not be created securely");
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new PersistenceError("PATH_NOT_SECURE", "Persistence database path changed during creation");
    }
    chmodSync(file, 0o600);
  }
}

export function resolveStorePath(configuredDirectory?: string): ResolvedStorePath {
  const requested = configuredDirectory ?? process.env.IDB_DATA_DIR ?? join(homedir(), ".local", "share", "idatabase-client");
  if (!isAbsolute(requested)) {
    throw new PersistenceError("PATH_NOT_ABSOLUTE", "Persistence data directory must be absolute");
  }

  const directory = resolve(requested);
  prepareDirectory(directory);
  const databaseFile = join(directory, DATABASE_FILENAME);
  prepareDatabaseFile(databaseFile);

  try {
    if (dirname(realpathSync(databaseFile)) !== realpathSync(directory)) {
      throw new PersistenceError("PATH_NOT_SECURE", "Persistence database resolved outside its private directory");
    }
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError("PATH_NOT_SECURE", "Persistence database path could not be canonicalized");
  }

  return { directory, databaseFile };
}
