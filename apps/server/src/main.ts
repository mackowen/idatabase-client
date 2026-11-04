import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";

export async function startServer(): Promise<void> {
  const app = createApp();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "3000");

  await app.listen({ host, port });
  app.log.info({ host, port }, "server_started");

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "server_stopping");
    await app.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: unknown) => {
    console.error("server_start_failed", error);
    process.exitCode = 1;
  });
}
