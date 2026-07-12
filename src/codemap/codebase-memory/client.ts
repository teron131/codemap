/** Provides an optional stdio client for CodebaseMemory MCP tools. */
import { spawnSync } from "node:child_process";
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

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_COMMAND = "codebase-memory-mcp";
const DEFAULT_INDEX_MODE = "full";
const REQUEST_TIMEOUT_MS = 8_000;
const INDEX_REQUEST_TIMEOUT_MS = 120_000;
const READY_INDEX_STATUSES = new Set([
	"complete",
	"completed",
	"indexed",
	"ready",
]);

/** Returns whether the optional CodebaseMemory integration is enabled. */
export function codebaseMemoryEnabled(): boolean {
	const value = process.env.CODEMAP_CODEBASE_MEMORY;
	if (process.env.VITEST === "true" && value === undefined) {
		return false;
	}
	return value !== "0" && value !== "false" && value !== "off";
}

/** Indexes once and returns the project metadata for this command. */
export function codebaseMemoryReadyProject(
	root: string,
): CodebaseMemoryReadyProject | null {
	if (!codebaseMemoryEnabled()) {
		return null;
	}
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
	const resolvedRoot = path.resolve(root);
	const existing = projects.map(recordValue).find((project) => {
		const projectRoot = stringOrNull(project.root_path);
		return projectRoot !== null && path.resolve(projectRoot) === resolvedRoot;
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
