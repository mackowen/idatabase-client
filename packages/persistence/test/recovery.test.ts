import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openInternalStore } from "../src/index.js";
import { createTemporaryDataDirectory } from "./helpers.js";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("SQLite recovery and isolation", () => {
  it("preserves an unknown future schema without applying settings or migrations", async () => {
    const directory = createTemporaryDataDirectory();
    const file = join(directory, "idatabase.sqlite");
    const database = new DatabaseSync(file);
    database.exec("PRAGMA user_version=99;");
    database.close();
    const before = sha256(file);

    await expect(openInternalStore({ dataDirectory: directory })).rejects.toMatchObject({ code: "SCHEMA_VERSION_UNSUPPORTED" });
    expect(sha256(file)).toBe(before);
  });

  it("does not delete or recreate a corrupt database file", async () => {
    const directory = createTemporaryDataDirectory();
    const file = join(directory, "idatabase.sqlite");
    writeFileSync(file, Buffer.from("synthetic-corrupt-database"), { mode: 0o600 });
    const before = sha256(file);

    await expect(openInternalStore({ dataDirectory: directory })).rejects.toBeDefined();
    expect(sha256(file)).toBe(before);
  });

  it("recovers after abrupt termination with an uncommitted WAL transaction", async () => {
    const directory = createTemporaryDataDirectory();
    const file = join(directory, "idatabase.sqlite");
    const initial = await openInternalStore({ dataDirectory: directory });
    const original = initial.getState();
    await initial.close();

    const childSource = `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.env.IDB_TEST_DATABASE);
      db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;");
      db.prepare("UPDATE application_state SET startup_count=999 WHERE singleton=1").run();
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
      env: { ...process.env, IDB_TEST_DATABASE: file },
      encoding: "utf8",
      timeout: 10_000
    });
    expect(child.signal).toBe("SIGKILL");

    const recovered = await openInternalStore({ dataDirectory: directory });
    try {
      expect(recovered.getState().instance_id).toBe(original.instance_id);
      expect(recovered.getState().startup_count).toBe(2);
      expect(recovered.checkIntegrity().integrity).toBe("ok");
    } finally {
      await recovered.close();
    }
  });

  it("keeps the internal database separate from an external SQLite file and exposes no SQL handle", async () => {
    const internalDirectory = createTemporaryDataDirectory();
    const externalDirectory = createTemporaryDataDirectory();
    const internal = await openInternalStore({ dataDirectory: internalDirectory });
    const externalFile = join(externalDirectory, "external.sqlite");
    const external = new DatabaseSync(externalFile);
    try {
      external.exec("CREATE TABLE external_data(value TEXT); INSERT INTO external_data VALUES ('external-only');");
      expect(internal.getState().startup_count).toBe(1);
      expect(external.prepare("SELECT value FROM external_data").get()).toEqual({ value: "external-only" });
      expect(external.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='application_state'").get()).toBeUndefined();
      expect(internal).not.toHaveProperty("database");
      expect(internal).not.toHaveProperty("exec");
      expect(internal).not.toHaveProperty("query");
    } finally {
      external.close();
      await internal.close();
    }
  });
});
