/** Owns operational cache placement and cross-process project locks, including stale-owner recovery. */
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

type CodebaseMemoryLockOwner = {
  pid: number;
  token: string;
  recoverAfter: number | null;
};

export type CodebaseMemoryLock = {
  path: string;
  token: string;
};

const LOCK_WAIT_TIMEOUT_MS = 180_000;
const LOCK_RETRY_MS = 50;
const INCOMPLETE_LOCK_GRACE_MS = 30_000;
export const CHILD_RECOVERY_GRACE_MS = 5_000;
const lockSleepView = new Int32Array(new SharedArrayBuffer(4));

/** Acquires one repository's operational cache lock. */
export function acquireProjectLock(lockPath: string): CodebaseMemoryLock | null {
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  } catch {
    return null;
  }
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const owner = {
      pid: process.pid,
      token: randomUUID(),
      recoverAfter: null,
    };
    let descriptor: number | null = null;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(owner), "utf8");
      closeSync(descriptor);
      descriptor = null;
      return { path: lockPath, token: owner.token };
    } catch (error) {
      if (descriptor !== null) {
        try {
          closeSync(descriptor);
        } catch {}
        try {
          unlinkSync(lockPath);
        } catch {}
        return null;
      }
      if (errorCode(error) !== "EEXIST") {
        return null;
      }
      clearStaleProjectLock(lockPath);
      Atomics.wait(lockSleepView, 0, 0, LOCK_RETRY_MS);
    }
  }
  return null;
}

/** Removes a dead owner's lock while serializing stale-lock recovery. */
function clearStaleProjectLock(lockPath: string): void {
  const recoveryPath = `${lockPath}.recovery`;
  if (!claimRecoveryDirectory(recoveryPath)) {
    return;
  }
  try {
    if (projectLockIsStale(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  } finally {
    try {
      rmdirSync(recoveryPath);
    } catch {}
  }
}

/** Claims the tiny stale-lock recovery section and repairs an abandoned claim. */
function claimRecoveryDirectory(recoveryPath: string): boolean {
  try {
    mkdirSync(recoveryPath);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      return false;
    }
  }
  try {
    if (Date.now() - statSync(recoveryPath).mtimeMs >= INCOMPLETE_LOCK_GRACE_MS) {
      rmdirSync(recoveryPath);
      mkdirSync(recoveryPath);
      return true;
    }
  } catch {}
  return false;
}

/** Checks whether a lock owner is gone or an incomplete lock has aged past its write window. */
function projectLockIsStale(lockPath: string): boolean {
  let modifiedAt = Date.now();
  try {
    modifiedAt = statSync(lockPath).mtimeMs;
  } catch {
    return false;
  }
  let owner: CodebaseMemoryLockOwner | null;
  try {
    owner = lockOwner(JSON.parse(readFileSync(lockPath, "utf8")));
  } catch {
    return Date.now() - modifiedAt >= INCOMPLETE_LOCK_GRACE_MS;
  }
  if (owner === null) {
    return Date.now() - modifiedAt >= INCOMPLETE_LOCK_GRACE_MS;
  }
  if (owner.pid === process.pid) {
    return true;
  }
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return (
      errorCode(error) === "ESRCH" &&
      (owner.recoverAfter === null || Date.now() >= owner.recoverAfter)
    );
  }
}

/** Validates lock metadata before using its process identifier. */
function lockOwner(value: unknown): CodebaseMemoryLockOwner | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pid" in value) ||
    !("token" in value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    ("recoverAfter" in value &&
      value.recoverAfter !== null &&
      (typeof value.recoverAfter !== "number" || !Number.isFinite(value.recoverAfter)))
  ) {
    return null;
  }
  return {
    pid: value.pid,
    token: value.token,
    recoverAfter:
      "recoverAfter" in value && typeof value.recoverAfter === "number" ? value.recoverAfter : null,
  };
}

/** Waits briefly for exclusive access to the lock recovery sentinel. */
function claimTransferRecovery(recoveryPath: string): boolean {
  const deadline = Date.now() + CHILD_RECOVERY_GRACE_MS;
  while (Date.now() <= deadline) {
    if (claimRecoveryDirectory(recoveryPath)) {
      return true;
    }
    Atomics.wait(lockSleepView, 0, 0, 10);
  }
  return false;
}

/** Transfers the lock only when its token still identifies this operation. */
export function transferProjectLock(
  { path: lockPath, token }: CodebaseMemoryLock,
  pid: number,
  recoverAfter: number | null,
): boolean {
  const recoveryPath = `${lockPath}.recovery`;
  if (!claimTransferRecovery(recoveryPath)) {
    return false;
  }
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as { token?: unknown };
    if (owner.token !== token) {
      return false;
    }
    writeFileSync(lockPath, JSON.stringify({ pid, token, recoverAfter }), "utf8");
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmdirSync(recoveryPath);
    } catch {
      // The sentinel can already be absent after interrupted recovery.
    }
  }
}

/** Releases a lock only when this operation still owns its token. */
export function releaseProjectLock(lockPath: string, token: string): void {
  try {
    const owner = lockOwner(JSON.parse(readFileSync(lockPath, "utf8")));
    if (owner?.token === token && owner.pid === process.pid) {
      unlinkSync(lockPath);
    }
  } catch {}
}

/** Derives a stable lock path beside CodebaseMemory's operational cache. */
export function projectLockPath(root: string): string {
  const rootHash = createHash("sha256").update(root).digest("hex");
  return path.join(codebaseMemoryCacheRoot(), "codemap-locks", `${rootHash}.lock`);
}

/** Canonicalizes path aliases for cache matching and backend result normalization. */
export function canonicalPath(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

/** Reads a Node filesystem or process error code without widening catches. */
function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Uses the configured cache, the normal user cache, or a sandbox-writable temporary cache. */
export function codebaseMemoryCacheRoot(): string {
  if (process.env.CBM_CACHE_DIR) {
    return path.resolve(process.env.CBM_CACHE_DIR);
  }
  const defaultRoot = path.join(homedir(), ".cache", "codebase-memory-mcp");
  if (ensureWritableDirectory(defaultRoot)) {
    return defaultRoot;
  }
  const userKey =
    typeof process.getuid === "function"
      ? String(process.getuid())
      : createHash("sha256").update(homedir()).digest("hex").slice(0, 12);
  const fallbackRoot = path.join(tmpdir(), `codemap-${userKey}-codebase-memory-mcp`);
  ensureWritableDirectory(fallbackRoot);
  return fallbackRoot;
}

/** Creates one private cache directory and verifies that the current process may write it. */
function ensureWritableDirectory(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
