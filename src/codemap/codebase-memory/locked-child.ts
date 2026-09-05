/**
 * Supervises one Codebase Memory provider process while preserving cache-lock ownership.
 *
 * The parent launches this module while holding a project lock.
 * It owns the lock during the provider call, restores the parent, and forwards all output before exiting.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, writeSync } from "node:fs";

import { CHILD_RECOVERY_GRACE_MS, transferProjectLock } from "./cache.js";

type ChildArguments = [string, string, string, string, string];

const childArguments = process.argv.slice(2);
if (childArguments.length !== 5) {
  writeFileSync(2, "Invalid Codebase Memory child supervisor arguments.\n");
  process.exit(64);
}

const [command, timeoutText, lockPath, token, parentPidText] = childArguments as ChildArguments;

const timeoutMs = Number(timeoutText);
const parentPid = Number(parentPidText);
const lock = { path: lockPath, token };
const sleepView = new Int32Array(new SharedArrayBuffer(4));

/** Returns a Node-style filesystem error code when one is available. */
function errorCode(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : null;
  }
  return null;
}

/** Writes every byte to a non-blocking inherited pipe before allowing process exit. */
function writeAll(fd: number, value: Uint8Array | string): void {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  let offset = 0;
  while (offset < buffer.byteLength) {
    try {
      const written = writeSync(fd, buffer, offset, buffer.byteLength - offset);
      if (written === 0) {
        Atomics.wait(sleepView, 0, 0, 1);
      } else {
        offset += written;
      }
    } catch (error) {
      const code = errorCode(error);
      if (code !== "EAGAIN" && code !== "EINTR") {
        throw error;
      }
      Atomics.wait(sleepView, 0, 0, 1);
    }
  }
}

if (!transferProjectLock(lock, process.pid, Date.now() + timeoutMs + CHILD_RECOVERY_GRACE_MS)) {
  writeAll(2, "Codebase Memory cache lock ownership was lost before launch.\n");
  process.exit(70);
}

const result = spawnSync(command, [], {
  input: readFileSync(0),
  timeout: timeoutMs,
  maxBuffer: 16 * 1024 * 1024,
});
const restored = transferProjectLock(lock, parentPid, null);

if (result.stdout !== undefined) {
  writeAll(1, result.stdout);
}
if (result.stderr !== undefined) {
  writeAll(2, result.stderr);
}
if (!restored) {
  writeAll(2, "Codebase Memory cache lock ownership was lost after launch.\n");
  process.exit(70);
}
if (result.error !== undefined) {
  writeAll(2, `${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
