import pino from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openInternalStore, PersistenceError } from "@idb/persistence";
import { createApp } from "../src/app.js";

describe("Fastify lifecycle smoke", () => {
  it("starts on loopback, serves health, and shuts down cleanly", async () => {
    const app = createApp({ logger: pino({ level: "silent" }) });

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      expect(address).not.toBeNull();
      if (!address || typeof address === "string") throw new Error("Expected a TCP address");

      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ok" });
    } finally {
      await app.close();
    }

    expect(app.server.listening).toBe(false);
  });

  it("closes the internal store with the Fastify application", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "idb-app-store-"));
    const persistence = await openInternalStore({ dataDirectory });
    const app = createApp({ logger: pino({ level: "silent" }), persistence });

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      await app.close();
      expect(() => persistence.getState()).toThrowError(PersistenceError);
    } finally {
      if (app.server.listening) await app.close();
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
