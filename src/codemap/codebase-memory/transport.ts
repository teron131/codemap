/** Bridges synchronous feature calls to the SDK worker and normalizes provider payloads and errors. */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { arrayValue, isRecord, recordValue } from "../json-utils.js";
import { codebaseMemoryCacheRoot, type CodebaseMemoryLock } from "./cache.js";

type JsonObject = Record<string, unknown>;

export type CodebaseMemoryToolResult = { ok: true; value: unknown } | { ok: false; reason: string };

export type CodebaseMemoryToolOptions = {
  timeoutMs?: number;
};

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
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const result = spawnSync(
    process.execPath,
    [
      ...lockedChildRuntimeArguments(),
      command,
      String(timeoutMs),
      lock?.path ?? "",
      lock?.token ?? "",
      String(process.pid),
    ],
    {
      cwd: homedir(),
      env: codebaseMemoryChildEnv(),
      input: JSON.stringify({ name, arguments: args }),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error !== undefined) {
    return { ok: false, reason: result.error.message };
  }
  if (result.status !== 0 && result.status !== null) {
    return { ok: false, reason: result.stderr.trim() || `exit ${result.status}` };
  }
  let response: unknown;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: "missing tool response" };
  }
  const resultError = toolResultError(response);
  if (resultError !== null) {
    return { ok: false, reason: resultError };
  }
  const payload = toolPayload(response);
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
