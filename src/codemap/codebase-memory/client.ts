/** Owns one fresh backend snapshot per project operation and attributes provider failures to its lifecycle. */
import { nonblankString, numberField, recordValue } from "../json-utils.js";
import {
  acquireProjectLock,
  canonicalPath,
  type CodebaseMemoryLock,
  projectLockPath,
  releaseProjectLock,
} from "./cache.js";
import {
  callTool,
  type CodebaseMemoryToolOptions,
  type CodebaseMemoryToolResult,
} from "./transport.js";

export type CodebaseMemoryReadyProject = {
  name: string;
  nodes: number | null;
  edges: number | null;
  status: "ready" | "partial";
};

type ActiveCodebaseMemoryOperation = {
  lock: CodebaseMemoryLock;
  project: CodebaseMemoryReadyProject | null;
  root: string;
};

type CodebaseMemoryRefreshResult =
  | { ok: true; project: CodebaseMemoryReadyProject }
  | { ok: false; reason: string };

const DEFAULT_INDEX_MODE = "full";
const INDEX_REQUEST_TIMEOUT_MS = 120_000;
const READY_INDEX_STATUSES = new Set(["complete", "completed", "indexed", "ready"]);
const activeOperations: ActiveCodebaseMemoryOperation[] = [];
const failureReasons = new Map<string, string>();

/** Returns whether the optional CodebaseMemory integration is enabled. */
export function codebaseMemoryEnabled(): boolean {
  const value = process.env.CODEMAP_CODEBASE_MEMORY;
  if (process.env.VITEST === "true" && value === undefined) {
    return false;
  }
  return value !== "0" && value !== "false" && value !== "off";
}

/** Runs one operation against a clean index while serializing the same repository across processes. */
export function withFreshCodebaseMemoryProject<T>(
  root: string,
  operation: (project: CodebaseMemoryReadyProject) => T,
): T | null {
  if (!codebaseMemoryEnabled()) {
    failureReasons.set(canonicalPath(root), "Codebase Memory integration is disabled.");
    return null;
  }
  const resolvedRoot = canonicalPath(root);
  failureReasons.delete(resolvedRoot);
  const lockPath = projectLockPath(resolvedRoot);
  const activeOperation = activeOperations.find((active) => active.lock.path === lockPath);
  if (activeOperation !== undefined && activeOperation.project !== null) {
    return runSynchronousProjectOperation(activeOperation.project, operation);
  }
  const lock = acquireProjectLock(lockPath);
  if (lock === null) {
    failureReasons.set(
      resolvedRoot,
      `Could not acquire the operational cache lock at ${lockPath}.`,
    );
    return null;
  }
  const active: ActiveCodebaseMemoryOperation = { lock, project: null, root: resolvedRoot };
  activeOperations.push(active);
  try {
    const refresh = refreshProject(resolvedRoot);
    if (!refresh.ok) {
      failureReasons.set(resolvedRoot, refresh.reason);
      return null;
    }
    const project = refresh.project;
    active.project = project;
    return runSynchronousProjectOperation(project, operation);
  } finally {
    activeOperations.pop();
    releaseProjectLock(lock.path, lock.token);
  }
}

/** Returns the most recent backend failure for one project root. */
export function codebaseMemoryFailureReason(root: string): string | null {
  return failureReasons.get(canonicalPath(root)) ?? null;
}

/** Runs a callback while rejecting asynchronous callback forms. */
function runSynchronousProjectOperation<T>(
  project: CodebaseMemoryReadyProject,
  operation: (project: CodebaseMemoryReadyProject) => T,
): T {
  if (operation.constructor.name === "AsyncFunction") {
    throw new TypeError(
      "CodebaseMemory project operations must be synchronous while the cache lock is held.",
    );
  }
  const value = operation(project);
  if (isPromiseLike(value)) {
    throw new TypeError(
      "CodebaseMemory project operations must be synchronous while the cache lock is held.",
    );
  }
  return value;
}

/** Detects Promise-like callback results before the cache lock is released. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** Rebuilds the requested root and returns its ready project metadata. */
function refreshProject(root: string): CodebaseMemoryRefreshResult {
  const deletion = deleteExistingProject(root);
  if (!deletion.ok) {
    return deletion;
  }
  const indexResult = callCodebaseMemoryTool(
    "index_repository",
    {
      repo_path: root,
      mode: process.env.CODEMAP_CODEBASE_MEMORY_INDEX_MODE ?? DEFAULT_INDEX_MODE,
      persistence: false,
    },
    {
      timeoutMs: INDEX_REQUEST_TIMEOUT_MS,
    },
  );
  if (!indexResult.ok) {
    return { ok: false, reason: `Index refresh failed: ${readableToolReason(indexResult.reason)}` };
  }
  const indexed = recordValue(indexResult.value);
  const projectName = nonblankString(indexed.project);
  const indexStatus = nonblankString(indexed.status);
  if (
    projectName === null ||
    indexStatus === null ||
    !READY_INDEX_STATUSES.has(indexStatus.toLowerCase())
  ) {
    return {
      ok: false,
      reason: `Index refresh returned ${indexStatus === null ? "no status" : `status ${indexStatus}`}.`,
    };
  }
  const skippedFiles =
    typeof indexed.skipped_count === "number" && indexed.skipped_count >= 0
      ? indexed.skipped_count
      : 0;
  return {
    ok: true,
    project: {
      name: projectName,
      nodes: numberField(indexed.nodes),
      edges: numberField(indexed.edges),
      status: skippedFiles > 0 ? "partial" : "ready",
    },
  };
}

/** Calls the provider and attributes nested failures to the active project operation. */
export function callCodebaseMemoryTool(
  name: string,
  args: Record<string, unknown>,
  options: CodebaseMemoryToolOptions = {},
): CodebaseMemoryToolResult {
  if (!codebaseMemoryEnabled()) {
    return { ok: false, reason: "disabled" };
  }
  const active = activeOperations.at(-1);
  const result = callTool(name, args, options, active?.lock);
  if (active !== undefined) {
    if (result.ok) {
      failureReasons.delete(active.root);
    } else {
      failureReasons.set(active.root, readableToolReason(result.reason));
    }
  }
  return result;
}

/** Clears the current root's operational cache so deleted symbols cannot survive a full index. */
function deleteExistingProject(root: string): { ok: true } | { ok: false; reason: string } {
  const projectsResult = callCodebaseMemoryTool("list_projects", {});
  if (!projectsResult.ok) {
    return {
      ok: false,
      reason: `Could not list existing projects: ${readableToolReason(projectsResult.reason)}`,
    };
  }
  const projects = recordValue(projectsResult.value).projects;
  if (!Array.isArray(projects)) {
    return { ok: false, reason: "Could not list existing projects: invalid projects payload." };
  }
  const resolvedRoot = canonicalPath(root);
  const existing = projects.map(recordValue).find((project) => {
    const projectRoot = nonblankString(project.root_path);
    return projectRoot !== null && canonicalPath(projectRoot) === resolvedRoot;
  });
  if (existing === undefined) {
    return { ok: true };
  }
  const projectName = nonblankString(existing.name);
  if (projectName === null) {
    return { ok: false, reason: "Could not delete existing project: missing project name." };
  }
  const deleteResult = callCodebaseMemoryTool("delete_project", {
    project: projectName,
  });
  if (!deleteResult.ok) {
    return {
      ok: false,
      reason: `Could not delete existing project: ${readableToolReason(deleteResult.reason)}`,
    };
  }
  return nonblankString(recordValue(deleteResult.value).status) === "deleted"
    ? { ok: true }
    : { ok: false, reason: "Could not delete existing project: invalid deletion response." };
}

/** Extracts a concise provider hint from JSON-encoded or plain tool failures. */
function readableToolReason(reason: string): string {
  try {
    const payload = recordValue(JSON.parse(reason));
    const hint = nonblankString(payload.hint);
    const outcome = nonblankString(payload.outcome);
    if (hint !== null) {
      return outcome === null ? hint : `${outcome}: ${hint}`;
    }
  } catch {}
  return reason;
}
