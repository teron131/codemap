/** Provides an optional stdio client for CodebaseMemory MCP tools. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type JsonRpcResponse = {
	id?: number | string | null;
	result?: unknown;
	error?: { message?: string };
};

export type CodebaseMemoryReadyProject = {
	name: string;
	nodes: number | null;
	edges: number | null;
	status: "ready" | "partial";
};

export type CodebaseMemoryToolResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: string };

type CodebaseMemoryToolOptions = {
	timeoutMs?: number;
};

type CodebaseMemoryLockOwner = {
	pid: number;
	token: string;
	recoverAfter: number | null;
};

type CodebaseMemoryLock = {
	path: string;
	token: string;
};

type ActiveCodebaseMemoryOperation = {
	lock: CodebaseMemoryLock;
	project: CodebaseMemoryReadyProject | null;
};

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_COMMAND = "codebase-memory-mcp";
const DEFAULT_INDEX_MODE = "full";
const REQUEST_TIMEOUT_MS = 8_000;
const INDEX_REQUEST_TIMEOUT_MS = 120_000;
const LOCK_WAIT_TIMEOUT_MS = 180_000;
const LOCK_RETRY_MS = 50;
const INCOMPLETE_LOCK_GRACE_MS = 30_000;
const CHILD_RECOVERY_GRACE_MS = 5_000;
const READY_INDEX_STATUSES = new Set([
	"complete",
	"completed",
	"indexed",
	"ready",
]);
const activeOperations: ActiveCodebaseMemoryOperation[] = [];
const lockSleepView = new Int32Array(new SharedArrayBuffer(4));

/** Supervises one MCP child so its process lifetime remains represented in the root lock. */
const LOCKED_CHILD_SOURCE = String.raw`
const { spawnSync } = require("node:child_process");
const {
  mkdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  writeFileSync,
} = require("node:fs");

const [command, timeoutText, lockPath, token, parentPidText] = process.argv.slice(1);
const timeoutMs = Number(timeoutText);
const parentPid = Number(parentPidText);
const recoveryPath = lockPath + ".recovery";
const sleepView = new Int32Array(new SharedArrayBuffer(4));
const recoveryGraceMs = ${INCOMPLETE_LOCK_GRACE_MS};
const childRecoveryGraceMs = ${CHILD_RECOVERY_GRACE_MS};

function errorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : null;
}

function tryClaimRecovery() {
  try {
    mkdirSync(recoveryPath);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      return false;
    }
  }
  try {
    if (Date.now() - statSync(recoveryPath).mtimeMs >= recoveryGraceMs) {
      rmdirSync(recoveryPath);
      mkdirSync(recoveryPath);
      return true;
    }
  } catch {}
  return false;
}

function claimRecovery() {
  const deadline = Date.now() + childRecoveryGraceMs;
  while (Date.now() <= deadline) {
    if (tryClaimRecovery()) {
      return true;
    }
    Atomics.wait(sleepView, 0, 0, 10);
  }
  return false;
}

function transferLock(pid, recoverAfter) {
  if (!claimRecovery()) {
    return false;
  }
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8"));
    if (owner.token !== token) {
      return false;
    }
    writeFileSync(
      lockPath,
      JSON.stringify({ pid, token, recoverAfter }),
      "utf8",
    );
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmdirSync(recoveryPath);
    } catch {}
  }
}

if (!transferLock(process.pid, Date.now() + timeoutMs + childRecoveryGraceMs)) {
  process.stderr.write("CodebaseMemory cache lock ownership was lost before launch.\n");
  process.exit(70);
}

const result = spawnSync(command, [], {
  input: readFileSync(0),
  timeout: timeoutMs,
  maxBuffer: 16 * 1024 * 1024,
});
const restored = transferLock(parentPid, null);
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (!restored) {
  process.stderr.write("CodebaseMemory cache lock ownership was lost after launch.\n");
  process.exit(70);
}
if (result.error) {
  process.stderr.write(result.error.message + "\n");
  process.exit(1);
}
process.exit(result.status ?? 1);
`;

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
		return null;
	}
	const resolvedRoot = canonicalPath(root);
	const lockPath = projectLockPath(resolvedRoot);
	const activeOperation = activeOperations.find(
		(active) => active.lock.path === lockPath,
	);
	if (activeOperation !== undefined && activeOperation.project !== null) {
		return runSynchronousProjectOperation(activeOperation.project, operation);
	}
	const lock = acquireProjectLock(lockPath);
	if (lock === null) {
		return null;
	}
	const active: ActiveCodebaseMemoryOperation = { lock, project: null };
	activeOperations.push(active);
	try {
		const project = refreshProject(resolvedRoot);
		if (project === null) {
			return null;
		}
		active.project = project;
		return runSynchronousProjectOperation(project, operation);
	} finally {
		activeOperations.pop();
		releaseProjectLock(lock.path, lock.token);
	}
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
function refreshProject(root: string): CodebaseMemoryReadyProject | null {
	if (!deleteExistingProject(root)) {
		return null;
	}
	const indexResult = callCodebaseMemoryTool(
		"index_repository",
		{
			repo_path: root,
			mode:
				process.env.CODEMAP_CODEBASE_MEMORY_INDEX_MODE ?? DEFAULT_INDEX_MODE,
			persistence: false,
		},
		{
			timeoutMs: INDEX_REQUEST_TIMEOUT_MS,
		},
	);
	if (!indexResult.ok) {
		return null;
	}
	const indexed = recordValue(indexResult.value);
	const projectName = stringOrNull(indexed.project);
	const indexStatus = stringOrNull(indexed.status);
	if (
		projectName === null ||
		indexStatus === null ||
		!READY_INDEX_STATUSES.has(indexStatus.toLowerCase())
	) {
		return null;
	}
	const skippedFiles =
		typeof indexed.skipped_count === "number" && indexed.skipped_count >= 0
			? indexed.skipped_count
			: 0;
	return {
		name: projectName,
		nodes: numberOrNull(indexed.nodes),
		edges: numberOrNull(indexed.edges),
		status: skippedFiles > 0 ? "partial" : "ready",
	};
}

/** Acquires one repository's operational cache lock. */
function acquireProjectLock(lockPath: string): CodebaseMemoryLock | null {
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
		if (
			Date.now() - statSync(recoveryPath).mtimeMs >=
			INCOMPLETE_LOCK_GRACE_MS
		) {
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
			(typeof value.recoverAfter !== "number" ||
				!Number.isFinite(value.recoverAfter)))
	) {
		return null;
	}
	return {
		pid: value.pid,
		token: value.token,
		recoverAfter:
			"recoverAfter" in value && typeof value.recoverAfter === "number"
				? value.recoverAfter
				: null,
	};
}

/** Releases a lock only when this operation still owns its token. */
function releaseProjectLock(lockPath: string, token: string): void {
	try {
		const owner = lockOwner(JSON.parse(readFileSync(lockPath, "utf8")));
		if (owner?.token === token && owner.pid === process.pid) {
			unlinkSync(lockPath);
		}
	} catch {}
}

/** Derives a stable lock path beside CodebaseMemory's operational cache. */
function projectLockPath(root: string): string {
	const cacheRoot = process.env.CBM_CACHE_DIR
		? path.resolve(process.env.CBM_CACHE_DIR)
		: path.join(homedir(), ".cache", "codebase-memory-mcp");
	const rootHash = createHash("sha256").update(root).digest("hex");
	return path.join(cacheRoot, "codemap-locks", `${rootHash}.lock`);
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

/** Clears the current root's operational cache so deleted symbols cannot survive a full index. */
function deleteExistingProject(root: string): boolean {
	const projectsResult = callCodebaseMemoryTool("list_projects", {});
	if (!projectsResult.ok) {
		return false;
	}
	const projects = recordValue(projectsResult.value).projects;
	if (!Array.isArray(projects)) {
		return false;
	}
	const resolvedRoot = canonicalPath(root);
	const existing = projects.map(recordValue).find((project) => {
		const projectRoot = stringOrNull(project.root_path);
		return projectRoot !== null && canonicalPath(projectRoot) === resolvedRoot;
	});
	if (existing === undefined) {
		return true;
	}
	const projectName = stringOrNull(existing.name);
	if (projectName === null) {
		return false;
	}
	const deleteResult = callCodebaseMemoryTool("delete_project", {
		project: projectName,
	});
	return (
		deleteResult.ok &&
		stringOrNull(recordValue(deleteResult.value).status) === "deleted"
	);
}

/** Calls one CodebaseMemory MCP tool through the configured stdio server command. */
export function callCodebaseMemoryTool(
	name: string,
	args: JsonObject,
	options: CodebaseMemoryToolOptions = {},
): CodebaseMemoryToolResult {
	if (!codebaseMemoryEnabled()) {
		return { ok: false, reason: "disabled" };
	}
	const command = codebaseMemoryCommand();
	const messages = [
		{
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "codemap", version: "0.0.0" },
			},
		},
		{
			jsonrpc: "2.0",
			method: "notifications/initialized",
			params: {},
		},
		{
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name, arguments: args },
		},
	];
	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
	const input = `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
	const spawnOptions = {
		cwd: homedir(),
		env: codebaseMemoryChildEnv(),
		input,
		encoding: "utf8" as const,
		maxBuffer: 16 * 1024 * 1024,
	};
	const lock = activeOperations.at(-1)?.lock;
	const result =
		lock === undefined
			? spawnSync(command, [], {
					...spawnOptions,
					timeout: timeoutMs,
				})
			: spawnSync(
					process.execPath,
					[
						"--input-type=commonjs",
						"--eval",
						LOCKED_CHILD_SOURCE,
						command,
						String(timeoutMs),
						lock.path,
						lock.token,
						String(process.pid),
					],
					spawnOptions,
				);
	if (result.error !== undefined) {
		return { ok: false, reason: result.error.message };
	}
	if (result.status !== 0 && result.status !== null) {
		return {
			ok: false,
			reason: result.stderr.trim() || `exit ${result.status}`,
		};
	}
	const responses = parseJsonRpcResponses(result.stdout);
	const response = responses.find((item) => item.id === 2);
	if (response === undefined) {
		return { ok: false, reason: "missing tool response" };
	}
	if (response.error !== undefined) {
		return {
			ok: false,
			reason: response.error.message ?? "tool error",
		};
	}
	const resultError = toolResultError(response.result);
	if (resultError !== null) {
		return { ok: false, reason: resultError };
	}
	const payload = toolPayload(response.result);
	const payloadError = toolPayloadError(payload);
	if (payloadError !== null) {
		return { ok: false, reason: payloadError };
	}
	return { ok: true, value: payload };
}

/** Resolves path-shaped command overrides before moving the child away from the project cwd. */
function codebaseMemoryCommand(): string {
	const command =
		process.env.CODEMAP_CODEBASE_MEMORY_COMMAND ?? DEFAULT_COMMAND;
	return command.includes("/") || command.includes("\\")
		? path.resolve(command)
		: command;
}

/** Builds a child environment that avoids leaking launcher-specific argv hints. */
function codebaseMemoryChildEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	if (env.CBM_CACHE_DIR) {
		env.CBM_CACHE_DIR = path.resolve(env.CBM_CACHE_DIR);
	}
	delete env._;
	for (const key of Object.keys(env)) {
		if (key.startsWith("CODEMAP_")) {
			delete env[key];
		}
	}
	return env;
}

/** Parses newline-delimited JSON-RPC responses from MCP stdio output. */
function parseJsonRpcResponses(stdout: string): JsonRpcResponse[] {
	const responses: JsonRpcResponse[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) {
			continue;
		}
		try {
			const value = JSON.parse(trimmed);
			if (isRecord(value)) {
				responses.push(value as JsonRpcResponse);
			}
		} catch {}
	}
	return responses;
}

/** Extracts structured MCP output or JSON-decodes the first usable text block. */
function toolPayload(result: unknown): unknown {
	const record = recordValue(result);
	if (isRecord(record.structuredContent)) {
		return record.structuredContent;
	}
	const texts = toolTextBlocks(record);
	for (const text of texts) {
		try {
			return JSON.parse(text);
		} catch {}
	}
	return texts.length === 1 ? texts[0] : result;
}

/** Reads an MCP call-level error before feature-specific payload handling. */
function toolResultError(result: unknown): string | null {
	const record = recordValue(result);
	if (record.isError !== true) {
		return null;
	}
	return toolTextBlocks(record)[0] ?? "tool error";
}

/** Collects nonempty text blocks from an MCP tool result. */
function toolTextBlocks(result: JsonObject): string[] {
	return arrayValue(result.content)
		.map((item) => recordValue(item).text)
		.filter(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		);
}

/** Extracts a tool-level error from decoded MCP text payloads. */
function toolPayloadError(value: unknown): string | null {
	if (typeof value === "string" && codebaseMemoryErrorText(value)) {
		return value;
	}
	const error = recordValue(value).error;
	return typeof error === "string" && error.length > 0 ? error : null;
}

/** Detects plain-text CodebaseMemory tool errors. */
function codebaseMemoryErrorText(value: string): boolean {
	return (
		/^(error|failed|invalid|unknown)\b/i.test(value) ||
		/\b(required|must be|not found|not indexed|unavailable)\b/i.test(value)
	);
}

/** Returns object records while rejecting arrays and primitives. */
export function recordValue(value: unknown): JsonObject {
	return isRecord(value) ? value : {};
}

/** Returns arrays while rejecting other JSON values. */
export function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Converts number-like values into nullable numbers. */
function numberOrNull(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

/** Converts a nonempty string into a nullable string. */
function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Checks whether a value is a plain object record. */
function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
