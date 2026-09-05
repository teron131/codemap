/** Runs the official MCP client while retaining lock ownership until its provider process has exited. */
import { readFileSync, writeFileSync, writeSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { CODEMAP_VERSION } from "../version.js";
import { CHILD_RECOVERY_GRACE_MS, transferProjectLock } from "./cache.js";

const childArguments = process.argv.slice(2);
if (childArguments.length !== 5) {
  writeFileSync(2, "Invalid Codebase Memory child supervisor arguments.\n");
  process.exit(64);
}
const [command, timeoutText, lockPath, token, parentPidText] = childArguments as [
  string,
  string,
  string,
  string,
  string,
];
const timeoutMs = Number(timeoutText);
const parentPid = Number(parentPidText);
const lock = lockPath ? { path: lockPath, token } : null;
const sleepView = new Int32Array(new SharedArrayBuffer(4));

/** Finishes writes to inherited non-blocking pipes before this short-lived worker can exit. */
function writeAll(fd: number, value: string): void {
  const buffer = Buffer.from(value);
  let offset = 0;
  while (offset < buffer.length) {
    try {
      const written = writeSync(fd, buffer, offset, buffer.length - offset);
      if (written === 0) {
        Atomics.wait(sleepView, 0, 0, 1);
      } else {
        offset += written;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EAGAIN" && code !== "EINTR") {
        throw error;
      }
      Atomics.wait(sleepView, 0, 0, 1);
    }
  }
}

/** Keeps SDK negotiation, cancellation, and provider shutdown inside the existing synchronous caller boundary. */
async function run(): Promise<void> {
  const request = JSON.parse(readFileSync(0, "utf8")) as {
    name: string;
    arguments: Record<string, unknown>;
  };
  if (
    lock !== null &&
    !transferProjectLock(lock, process.pid, Date.now() + timeoutMs + CHILD_RECOVERY_GRACE_MS)
  ) {
    throw new Error("Codebase Memory cache lock ownership was lost before launch.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Codebase Memory request timed out.")),
    timeoutMs,
  );
  const transport = new StdioClientTransport({
    command,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    stderr: "pipe",
    maxBufferSize: 16 * 1024 * 1024,
  });
  const exited = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  const client = new Client({ name: "codemap", version: CODEMAP_VERSION });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-64 * 1024);
  });
  client.onerror = (error) => controller.abort(error);
  const terminate = () => controller.abort(new Error("Codebase Memory request interrupted."));
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  let result: unknown;
  const failures: unknown[] = [];
  try {
    await client.connect(transport, { signal: controller.signal, timeout: timeoutMs });
    result = await client.callTool(request, undefined, {
      signal: controller.signal,
      timeout: timeoutMs,
    });
  } catch (error) {
    failures.push(
      error instanceof McpError && error.code === ErrorCode.ConnectionClosed
        ? new Error(stderr.trim() || "missing tool response", { cause: error })
        : error,
    );
  } finally {
    clearTimeout(timeout);
    await client.close().catch((error: unknown) => {
      failures.push(error);
    });
    // SDK close can return immediately after SIGKILL; retain the lock until the OS reaps the provider.
    await exited;
    process.removeListener("SIGTERM", terminate);
    process.removeListener("SIGINT", terminate);
    if (lock !== null && !transferProjectLock(lock, parentPid, null)) {
      failures.push(new Error("Codebase Memory cache lock ownership was lost after launch."));
    }
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      failures.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
    );
  }
  writeAll(1, `${JSON.stringify(result)}\n`);
}

void run().catch((error: unknown) => {
  writeAll(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
