/** Provides an optional stdio client for CodebaseMemory MCP tools. */
import { spawnSync } from "node:child_process";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type JsonRpcResponse = {
	id?: number | string | null;
	result?: unknown;
	error?: { message?: string };
};

type CodebaseMemoryProject = {
	name: string;
	root_path: string;
	nodes: number | null;
	edges: number | null;
};

export type CodebaseMemoryReadyProject = {
	name: string;
	rootPath: string;
	nodes: number | null;
	edges: number | null;
	status: string;
	changedCount: number;
};

export type CodebaseMemoryToolResult =
	| { ok: true; value: unknown }
	| { ok: false; reason: string };

type CodebaseMemoryToolOptions = {
	timeoutMs?: number;
};

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_COMMAND = "codebase-memory-mcp";
const DEFAULT_INDEX_MODE = "full";
const REQUEST_TIMEOUT_MS = 8_000;
const INDEX_REQUEST_TIMEOUT_MS = 120_000;

/** Returns whether the optional CodebaseMemory integration is enabled. */
export function codebaseMemoryEnabled(): boolean {
	const value = process.env.CODEMAP_CODEBASE_MEMORY;
	if (process.env.VITEST === "true" && value === undefined) {
		return false;
	}
	return value !== "0" && value !== "false" && value !== "off";
}

/** Finds a ready CodebaseMemory project matching the project root. */
export function codebaseMemoryReadyProject(
	root: string,
): CodebaseMemoryReadyProject | null {
	if (!codebaseMemoryEnabled()) {
		return null;
	}
	return codebaseMemoryFreshProject(root);
}

/** Ensures the project is indexed and unchanged before returning backend metadata. */
function codebaseMemoryFreshProject(
	root: string,
): CodebaseMemoryReadyProject | null {
	const project = codebaseMemoryProjectForRoot(root);
	if (project === null) {
		return codebaseMemoryIndexAndReadProject(root);
	}
	const status = codebaseMemoryProjectIndexStatus(project.name);
	if (status !== "ready") {
		return codebaseMemoryIndexAndReadProject(root);
	}
	const changedCount = codebaseMemoryChangedCount(project.name);
	if (changedCount === null || changedCount > 0) {
		return codebaseMemoryIndexAndReadProject(root);
	}
	return codebaseMemoryReadyProjectFromIndexedProject(
		project,
		status,
		changedCount,
	);
}

/** Converts an already indexed project into ready metadata when status permits it. */
function codebaseMemoryReadyProjectFromIndexedProject(
	project: CodebaseMemoryProject,
	status: string,
	changedCount: number,
): CodebaseMemoryReadyProject {
	return {
		name: project.name,
		rootPath: project.root_path,
		nodes: numberOrNull(project.nodes),
		edges: numberOrNull(project.edges),
		status,
		changedCount,
	};
}

/** Indexes the repository, then returns the fresh matching project when available. */
function codebaseMemoryIndexAndReadProject(
	root: string,
): CodebaseMemoryReadyProject | null {
	const indexResult = callCodebaseMemoryTool(
		"index_repository",
		{
			repo_path: root,
			mode:
				process.env.CODEMAP_CODEBASE_MEMORY_INDEX_MODE ?? DEFAULT_INDEX_MODE,
		},
		{
			timeoutMs: INDEX_REQUEST_TIMEOUT_MS,
		},
	);
	if (!indexResult.ok) {
		return null;
	}
	const project = codebaseMemoryProjectForRoot(root);
	if (project === null) {
		return null;
	}
	const status = codebaseMemoryProjectIndexStatus(project.name);
	if (status !== "ready") {
		return null;
	}
	const changedCount = codebaseMemoryChangedCount(project.name);
	return codebaseMemoryReadyProjectFromIndexedProject(
		project,
		status,
		changedCount ?? 0,
	);
}

/** Reads CodebaseMemory's raw index status for a project. */
function codebaseMemoryProjectIndexStatus(project: string): string | null {
	const statusResult = callCodebaseMemoryTool("index_status", { project });
	if (!statusResult.ok) {
		return null;
	}
	const status = recordValue(statusResult.value);
	return typeof status.status === "string" ? status.status : null;
}

/** Finds the indexed CodebaseMemory project whose nonempty root matches the target root. */
function codebaseMemoryProjectForRoot(
	root: string,
): CodebaseMemoryProject | null {
	const projectResult = callCodebaseMemoryTool("list_projects", {});
	if (!projectResult.ok) {
		return null;
	}
	const normalizedRoot = normalizePath(root);
	const projects = arrayValue(recordValue(projectResult.value).projects)
		.map(codebaseMemoryProjectFromValue)
		.filter((project) => project !== null);
	return (
		projects.find((item) => normalizePath(item.root_path) === normalizedRoot) ??
		null
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
	const command =
		process.env.CODEMAP_CODEBASE_MEMORY_COMMAND ?? DEFAULT_COMMAND;
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
	const result = spawnSync(command, [], {
		env: codebaseMemoryChildEnv(),
		input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
		encoding: "utf8",
		timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
		maxBuffer: 16 * 1024 * 1024,
	});
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
	const payload = toolPayload(response.result);
	const payloadError = toolPayloadError(payload);
	if (payloadError !== null) {
		return { ok: false, reason: payloadError };
	}
	return { ok: true, value: payload };
}

/** Builds a child environment that avoids leaking launcher-specific argv hints. */
function codebaseMemoryChildEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
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

/** Extracts and JSON-decodes the MCP tool text payload when possible. */
function toolPayload(result: unknown): unknown {
	const content = arrayValue(recordValue(result).content);
	const first = recordValue(content[0]);
	const text = typeof first.text === "string" ? first.text : "";
	if (!text) {
		return result;
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Extracts a tool-level error from decoded MCP text payloads. */
function toolPayloadError(value: unknown): string | null {
	const error = recordValue(value).error;
	return typeof error === "string" && error.length > 0 ? error : null;
}

/** Reads CodebaseMemory's changed-file count for status output. */
function codebaseMemoryChangedCount(project: string): number | null {
	const result = callCodebaseMemoryTool("detect_changes", {
		project,
		depth: 1,
	});
	if (!result.ok) {
		return null;
	}
	const changedCount = recordValue(result.value).changed_count;
	return typeof changedCount === "number" ? changedCount : null;
}

/** Coerces a raw CodebaseMemory project record into the local project shape. */
function codebaseMemoryProjectFromValue(
	value: unknown,
): CodebaseMemoryProject | null {
	const record = recordValue(value);
	if (typeof record.name !== "string" || typeof record.root_path !== "string") {
		return null;
	}
	if (record.root_path.trim().length === 0) {
		return null;
	}
	return {
		name: record.name,
		root_path: record.root_path,
		nodes: numberOrNull(record.nodes),
		edges: numberOrNull(record.edges),
	};
}

/** Normalizes a filesystem path for exact project-root matching. */
function normalizePath(value: string): string {
	return path.resolve(value);
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

/** Checks whether a value is a plain object record. */
function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
