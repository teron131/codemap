/** Builds complete signal views from current-tree and optional backend evidence. */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  codebaseMemoryFailureReason,
  codebaseMemoryQueryRows,
  codebaseMemoryQueryWithProject,
} from "../../codebase-memory/index.js";
import { DETAILED_ANALYSIS_FILE_LIMIT } from "../../common.js";
import { runScan } from "../extraction/index.js";
import { buildSignalExport, runSignalsExport } from "./build.js";
import { buildLightweightSignalPayload } from "./lightweight.js";
import { buildSignalPayload, selectPayloadSection } from "./payload.js";
import { isGeneratedSignalPath, isSupportedSignalPath, isTestPath } from "./policy.js";

type SignalViewOptions = {
  includeTests?: boolean;
};

type BackendFunctionMetrics = {
  freshness: "fresh" | "partial" | "degraded";
  reason: string | null;
  rows: Record<string, unknown>[];
};

const BACKEND_FUNCTION_METRICS_COLUMNS = [
  "name",
  "file_path",
  "start_line",
  "lines",
  "complexity",
  "cognitive",
  "linear_scan_in_loop",
  "is_test",
];
const BACKEND_FUNCTION_METRICS_LIMIT = 100;
const BACKEND_FUNCTION_METRICS_FILE_LIMIT = 10_000;

/** Builds the selected signal payload with backend metrics layered over local evidence. */
export function buildSignalView(
  root: string,
  section: string,
  options: SignalViewOptions = {},
): Record<string, unknown> {
  const payload = buildCurrentTreeSignalPayload(root, section, options);
  return addBackendFunctionMetrics(payload, section, root, {
    includeTests: Boolean(options.includeTests),
  });
}

/** Adds backend function metrics to compact top output. */
function addBackendFunctionMetrics(
  payload: Record<string, unknown>,
  section: string,
  root: string,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> {
  if (section !== "top" && section !== "all") {
    return payload;
  }
  const coverage = recordValue(payload.coverage);
  if (numericField(coverage.eligibleFiles) > BACKEND_FUNCTION_METRICS_FILE_LIMIT) {
    return {
      ...payload,
      backendStatus: "skipped",
      backendReason: `eligible source files exceed ${BACKEND_FUNCTION_METRICS_FILE_LIMIT}`,
    };
  }
  const backend = backendFunctionMetrics(root, { includeTests });
  if (section === "top") {
    const functionMetrics = mergedFunctionMetrics(backend, arrayValue(payload.functionMetrics));
    return {
      ...payload,
      freshness: backend.freshness,
      ...(backend.reason === null ? {} : { backendReason: backend.reason }),
      functionMetrics,
    };
  }
  return {
    ...payload,
    freshness: backend.freshness,
    ...(backend.reason === null ? {} : { backendReason: backend.reason }),
    functionMetrics: backend.rows,
  };
}

/** Fills filtered, partial, or degraded backend rows with distinct current-tree metrics. */
function mergedFunctionMetrics(
  backend: BackendFunctionMetrics,
  localRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (backend.freshness === "fresh" && backend.rows.length >= BACKEND_FUNCTION_METRICS_LIMIT) {
    return backend.rows;
  }
  const rows = backend.rows.slice();
  const seen = new Set(rows.map(functionMetricKey));
  for (const row of localRows) {
    const key = functionMetricKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

/** Builds a stable source identity for mixed backend and local metric rows. */
function functionMetricKey(row: Record<string, unknown>): string {
  return `${String(row.path ?? "")}\0${String(row.name ?? "")}`;
}

/** Queries and normalizes backend function metrics. */
function backendFunctionMetrics(
  root: string,
  { includeTests }: { includeTests: boolean },
): BackendFunctionMetrics {
  const result = codebaseMemoryQueryWithProject(
    root,
    BACKEND_FUNCTION_METRICS_QUERY,
    BACKEND_FUNCTION_METRICS_LIMIT,
  );
  if (result === null) {
    return {
      freshness: "degraded",
      reason: codebaseMemoryFailureReason(root),
      rows: [],
    };
  }
  const queryRows = codebaseMemoryQueryRows(result.value, BACKEND_FUNCTION_METRICS_COLUMNS);
  if (queryRows === null) {
    return {
      freshness: "degraded",
      reason: "Codebase Memory returned an unknown function-metrics payload.",
      rows: [],
    };
  }
  const rows = queryRows
    .map((row) => functionMetricRow(root, row, { includeTests }))
    .filter((row) => row !== null)
    .sort(compareFunctionMetrics)
    .slice(0, BACKEND_FUNCTION_METRICS_LIMIT);
  return {
    freshness: result.freshness === "partial" ? "partial" : "fresh",
    reason: null,
    rows,
  };
}

const BACKEND_FUNCTION_METRICS_QUERY = [
  "MATCH (f:Function)",
  "RETURN f.name AS name, f.file_path AS file_path, f.start_line AS start_line, f.lines AS lines, f.complexity AS complexity, f.cognitive AS cognitive, f.linear_scan_in_loop AS linear_scan_in_loop, f.is_test AS is_test",
  "ORDER BY coalesce(f.cognitive, 0) DESC, coalesce(f.complexity, 0) DESC, coalesce(f.lines, 0) DESC, f.file_path, f.name",
].join(" ");

/** Compacts one backend function row after verifying its current source path. */
function functionMetricRow(
  root: string,
  row: Record<string, unknown>,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> | null {
  const name = stringField(row.name);
  const filePath = stringField(row.file_path);
  if (name === null || filePath === null || !existsSync(path.join(root, filePath))) {
    return null;
  }
  if (
    !isSupportedSignalPath(filePath) ||
    isGeneratedSignalPath(filePath) ||
    (!includeTests && (booleanField(row.is_test) || isTestPath(filePath)))
  ) {
    return null;
  }
  const cognitive = numericField(row.cognitive);
  const cyclomatic = numericField(row.complexity);
  const linearScanInLoop = numericField(row.linear_scan_in_loop);
  return {
    name,
    path: filePath,
    line: numericField(row.start_line),
    lines: numericField(row.lines),
    cognitive,
    cyclomatic,
    ...(linearScanInLoop > 0 ? { linearScanInLoop } : {}),
  };
}

/** Orders backend functions by cognitive, cyclomatic, length, and identity. */
function compareFunctionMetrics(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  return (
    numericField(right.cognitive) - numericField(left.cognitive) ||
    numericField(right.cyclomatic) - numericField(left.cyclomatic) ||
    numericField(right.lines) - numericField(left.lines) ||
    String(left.path).localeCompare(String(right.path)) ||
    String(left.name).localeCompare(String(right.name))
  );
}

/** Reads number-like graph fields emitted as JSON numbers or strings. */
function numericField(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Reads boolean graph fields emitted as JSON booleans or strings. */
function booleanField(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

/** Reads nonempty string fields from backend rows. */
function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Builds the selected current-tree signal payload for CLI output. */
function buildCurrentTreeSignalPayload(
  root: string,
  section: string,
  options: SignalViewOptions = {},
): Record<string, unknown> {
  if (section === "docstring-signals" || section === "docstrings") {
    const payload = docstringSignalPayload(root, section);
    return selectPayloadSection(payload, section);
  }
  const scan = runScan(root);
  if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
    const payload = buildLightweightSignalPayload(scan.files, {
      includeTests: Boolean(options.includeTests),
      root,
    });
    return selectPayloadSection(payload, section);
  }
  const signalExport = runSignalsExport(root);
  if (signalExport.status !== "ok") {
    throw new Error(`Signals unavailable: ${String(signalExport.message ?? "unknown error")}`);
  }
  const payload = buildSignalPayload(signalExport, {
    includeTests: Boolean(options.includeTests),
  });
  if (section === "all") {
    Object.assign(payload, docstringSignalPayload(root, "docstring-signals"));
  }
  return selectPayloadSection(payload, section);
}

/** Builds docstring sections without forcing full signal export work. */
function docstringSignalPayload(
  root: string,
  section: "docstring-signals" | "docstrings",
): Record<string, unknown> {
  const signalExport = buildSignalExport(root, {
    sectionMode: section,
  });
  const sections = recordValue(signalExport.sections);
  return {
    docstring_signals: sections.docstring_signals ?? {},
    docstrings: sections.docstrings ?? {},
  };
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads record rows from an untrusted JSON-like value. */
function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
