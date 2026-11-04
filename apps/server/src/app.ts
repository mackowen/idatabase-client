import Fastify from "fastify";
import pino, { type Logger } from "pino";
import { healthResponseSchema } from "@idb/contracts/api";

export interface AppOptions {
  logger?: Logger;
}

export function createApp(options: AppOptions = {}) {
  const logger = options.logger ?? pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["*.password", "*.token", "*.secret", "req.headers.authorization"],
      censor: "[REDACTED]"
    }
  });

  const app = Fastify({ loggerInstance: logger });

  app.get("/health", async (_request, reply) => {
    const response = healthResponseSchema.parse({
      status: "ok",
      timestamp: new Date().toISOString()
    });

    return reply.code(200).send(response);
  });

  return app;
}
