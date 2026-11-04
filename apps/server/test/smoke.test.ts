import pino from "pino";
import { describe, expect, it } from "vitest";
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
});
