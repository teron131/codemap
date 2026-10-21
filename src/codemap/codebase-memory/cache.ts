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

/** Blocks the thread for up to three minutes, clearing stale owners while it waits; null on timeout or any filesystem error. */
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

/** Holds the `.recovery` directory across the staleness check and unlink, so two waiters cannot both judge a lock stale and one delete the lock the other just acquired. */
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

/** Takes over a claim older than `INCOMPLETE_LOCK_GRACE_MS`, which a crashed claimant left behind. */
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

/** Checks whether a lock owner is gone or an incomplete lock has aged past its write window. A lock naming this process counts as stale, because same-process operations reuse an active lock instead of reacquiring it. */
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

/** Rejects non-positive pids, which `process.kill(pid, 0)` would read as a process group rather than the owner. */
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

/** Rewrites the owner only while the token still matches; `recoverAfter` keeps the lock from reading as stale before that time even if `pid` has died. */
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

/** Hashes `root` as given, so callers pass `canonicalPath(root)` to share one lock across path aliases. */
export function projectLockPath(root: string): string {
  const rootHash = createHash("sha256").update(root).digest("hex");
  return path.join(codebaseMemoryCacheRoot(), "codemap-locks", `${rootHash}.lock`);
}

/** Resolves symlinks for existing paths; missing paths fall back to `path.resolve` instead of throwing. */
export function canonicalPath(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** Prefers `CBM_CACHE_DIR`, then the user cache, then a per-user temporary cache when the user cache is unwritable; choosing the default or fallback creates that directory. */
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

function ensureWritableDirectory(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
