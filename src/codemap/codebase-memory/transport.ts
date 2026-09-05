/** Runs isolated MCP stdio calls and validates protocol envelopes before feature owners interpret payloads. */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { arrayValue, isRecord, recordValue } from "../json-utils.js";
import { CODEMAP_VERSION } from "../version.js";
import { codebaseMemoryCacheRoot, type CodebaseMemoryLock } from "./cache.js";

type JsonObject = Record<string, unknown>;

type JsonRpcResponse = {
  id?: number | string | null;
  result?: unknown;
  error?: { message?: string };
};

export type CodebaseMemoryToolResult = { ok: true; value: unknown } | { ok: false; reason: string };

export type CodebaseMemoryToolOptions = {
  timeoutMs?: number;
};

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_COMMAND = "codebase-memory-mcp";
const REQUEST_TIMEOUT_MS = 8_000;

/** Calls one CodebaseMemory MCP tool through the configured stdio server command. */
export function callTool(
  name: string,
  args: JsonObject,
  options: CodebaseMemoryToolOptions,
  lock?: CodebaseMemoryLock,
): CodebaseMemoryToolResult {
  const command = codebaseMemoryCommand();
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "codemap", version: CODEMAP_VERSION },
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
  const result =
    lock === undefined
      ? spawnSync(command, [], {
          ...spawnOptions,
          timeout: timeoutMs,
        })
      : spawnSync(
          process.execPath,
          [
            ...lockedChildRuntimeArguments(),
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
    return { ok: false, reason: result.stderr.trim() || `exit ${result.status}` };
  }
  const responses = parseJsonRpcResponses(result.stdout);
  const response = responses.find((item) => item.id === 2);
  if (response === undefined) {
    return { ok: false, reason: "missing tool response" };
  }
  if (response.error !== undefined) {
    return { ok: false, reason: response.error.message ?? "tool error" };
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

/** Locates the compiled supervisor, or loads its TypeScript source during development. */
function lockedChildRuntimeArguments(): string[] {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const childPath = fileURLToPath(new URL(`./locked-child${extension}`, import.meta.url));
  return extension === ".ts" ? ["--import", import.meta.resolve("tsx"), childPath] : [childPath];
}

/** Resolves path-shaped command overrides before moving the child away from the project cwd. */
function codebaseMemoryCommand(): string {
  const command = process.env.CODEMAP_CODEBASE_MEMORY_COMMAND ?? DEFAULT_COMMAND;
  return command.includes("/") || command.includes("\\") ? path.resolve(command) : command;
}

/** Builds a child environment that avoids leaking launcher-specific argv hints. */
function codebaseMemoryChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.CBM_CACHE_DIR = codebaseMemoryCacheRoot();
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
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
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
