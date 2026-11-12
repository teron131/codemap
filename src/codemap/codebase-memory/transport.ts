/** Bridges synchronous feature calls to the SDK worker and normalizes backend payloads and errors. */
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
/**
 * Sent with every call; tools without these parameters ignore them.
 *
 * The backend replies in compact text unless asked for JSON, and its byte ceiling, about 3,200 tokens by default, would cut rows that a call's own `limit` asked for; Codemap's output budget bounds what is printed.
 */
const RESPONSE_ARGUMENTS = { format: "json", max_output_tokens: 1_000_000 } as const;

/** Blocks while a fresh supervisor child starts the backend, makes this one call, and exits; with `lock`, the child holds the lock until its backend has exited. */
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
      // Outside the project, so the backend's own watcher and auto-indexing cannot race the explicit refresh.
      cwd: homedir(),
      env: codebaseMemoryChildEnv(),
      input: JSON.stringify({ name, arguments: { ...args, ...RESPONSE_ARGUMENTS } }),
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
  return { ok: true, value: expandTables(payload) };
}

/** A symbol's own name, the segment after the last dot of its backend qualified name: `pkg.mod.Client.run` → `run`. */
export function symbolName(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);
}

/**
 * Expands the backend's compact tables into records at any depth: an object with `cols` drops it, and its `rows`, or the rows of its `groups`, become records keyed by column.
 *
 * Grouped rows also take their group's `file` and the `qn` its `qn_rule` builds from `qn_prefix`, so `{cols: ["name"], groups: [{qn_prefix: "pkg.mod", file: "mod.ts", rows: [["run"]]}]}` → `{rows: [{name: "run", file: "mod.ts", qn: "pkg.mod.run"}]}`. Query results name their columns `columns` and pass through unchanged.
 */
function expandTables(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(expandTables);
  }
  if (!isRecord(value)) {
    return value;
  }
  const record = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expandTables(item)]),
  );
  if (!Array.isArray(record.cols)) {
    return record;
  }
  const { cols, rows, groups, qn_rule: _qnRule, ...rest } = record;
  const columns = arrayValue(cols).map(String);
  const rowRecord = (row: unknown) =>
    Object.fromEntries(columns.map((column, index) => [column, arrayValue(row)[index]]));
  const tableRows =
    groups === undefined
      ? arrayValue(rows).map(rowRecord)
      : arrayValue(groups).flatMap((group) => {
          const { qn_prefix: prefix, rows: groupRows, ...groupFields } = recordValue(group);
          return arrayValue(groupRows).map((row) => {
            const fields = rowRecord(row);
            const name = String(fields.name ?? "");
            return { ...fields, ...groupFields, qn: prefix ? `${String(prefix)}.${name}` : name };
          });
        });
  return { ...rest, rows: tableRows };
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

/** Pins `CBM_CACHE_DIR` to the cache root chosen here, so the backend shares the lock's cache even after a fallback, and drops the launcher's `_` and `CODEMAP_*` variables. */
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

/** Prefers structured MCP output, then the first text block that decodes as JSON; a lone undecodable text block comes back as a string and anything else as the raw result. */
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

function toolResultError(result: unknown): string | null {
  const record = recordValue(result);
  if (record.isError !== true) {
    return null;
  }
  return toolTextBlocks(record)[0] ?? "tool error";
}

function toolTextBlocks(result: JsonObject): string[] {
  return arrayValue(result.content)
    .map((item) => recordValue(item).text)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

/** Catches failures that arrive without `isError`: plain error text or an `error` field. */
function toolPayloadError(value: unknown): string | null {
  if (typeof value === "string" && codebaseMemoryErrorText(value)) {
    return value;
  }
  const error = recordValue(value).error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

/** Keyword heuristic, so non-JSON success text containing a phrase such as `not found` also reads as a failure. */
function codebaseMemoryErrorText(value: string): boolean {
  return (
    /^(error|failed|invalid|unknown)\b/i.test(value) ||
    /\b(required|must be|not found|not indexed|unavailable)\b/i.test(value)
  );
}
