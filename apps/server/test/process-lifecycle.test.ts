import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("server process lifecycle", () => {
  it("starts the built Fastify process and exits after SIGTERM", async () => {
    const entrypoint = fileURLToPath(new URL("../dist/main.js", import.meta.url));
    const child = spawn(process.execPath, [entrypoint], {
      env: { ...process.env, HOST: "127.0.0.1", PORT: "0", LOG_LEVEL: "info" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10_000);
        const inspect = (): void => {
          if (!output.includes("server_started")) return;
          clearTimeout(timer);
          resolve();
        };
        child.stdout.on("data", () => inspect());
        child.stderr.on("data", () => inspect());
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          if (output.includes("server_started")) return;
          clearTimeout(timer);
          reject(new Error(`Server exited before start: code=${code} signal=${signal} output=${output}`));
        });
      });

      child.kill("SIGTERM");
      const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
      expect(signal).toBeNull();
      expect(code).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    }
  }, 15_000);
});
