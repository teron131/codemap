/** Codebase Memory function metrics for `top` and `all`: one query ranked in the backend, each row checked against the working tree, and the merge with working-tree rows. */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  codebaseMemoryFailureReason,
  codebaseMemoryQueryRows,
  codebaseMemoryQueryWithProject,
} from "../codebase-memory/index.js";
import { arrayValue, nonblankString, recordValue } from "../json-utils.js";
import {
  isGeneratedPath,
  isSupportedSourcePath,
  isTestPath,
  PYTHON_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import type { SignalSection } from "./schema.js";

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
];
const BACKEND_FUNCTION_METRICS_LIMIT = 100;
const BACKEND_FUNCTION_METRICS_FILE_LIMIT = 10_000;

/** `top` fills backend rows out with distinct working-tree rows, while `all` carries backend rows alone; above 10,000 eligible files the backend is skipped. */
export function addBackendFunctionMetrics(
  payload: Record<string, unknown>,
  section: SignalSection,
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

/** Fills filtered, partial, or degraded backend rows with distinct working-tree metrics. */
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

function functionMetricKey(row: Record<string, unknown>): string {
  return `${String(row.path ?? "")}\0${String(row.name ?? "")}`;
}

function backendFunctionMetrics(
  root: string,
  { includeTests }: { includeTests: boolean },
): BackendFunctionMetrics {
  const result = codebaseMemoryQueryWithProject(
    root,
    functionMetricsQuery({ includeTests }),
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
    .sort(compareFunctionMetrics);
  return {
    freshness: result.freshness === "partial" ? "partial" : "fresh",
    reason: null,
    rows,
  };
}

/** Ranks functions and methods in the backend so its row limit keeps the true top rows, filtering by language there so the limit is not spent on rows `functionMetricRow` drops; the backend orders by returned aliases only, so metrics are coalesced in `RETURN`. */
function functionMetricsQuery({ includeTests }: { includeTests: boolean }): string {
  // Uppercase suffixes, which `isSupportedSourcePath` accepts, are left out: the backend cannot lowercase a value before `ENDS WITH`.
  const suffixes = [...PYTHON_SUFFIXES, ...TYPESCRIPT_SUFFIXES].map(
    (suffix) => `f.file_path ENDS WITH '${suffix}'`,
  );
  const conditions = [`(${suffixes.join(" OR ")})`, ...(includeTests ? [] : ["f.is_test = false"])];
  return [
    "MATCH (f:Function|Method)",
    `WHERE ${conditions.join(" AND ")}`,
    "RETURN f.name AS name, f.file_path AS file_path, f.start_line AS start_line, coalesce(f.lines, 0) AS lines, coalesce(f.complexity, 0) AS complexity, coalesce(f.cognitive, 0) AS cognitive, f.linear_scan_in_loop AS linear_scan_in_loop",
    "ORDER BY cognitive DESC, complexity DESC, lines DESC, file_path, name",
  ].join(" ");
}

/** Compacts one backend function row after verifying its current source path. */
function functionMetricRow(
  root: string,
  row: Record<string, unknown>,
  { includeTests }: { includeTests: boolean },
): Record<string, unknown> | null {
  const name = nonblankString(row.name);
  const filePath = nonblankString(row.file_path);
  if (name === null || filePath === null || !existsSync(path.join(root, filePath))) {
    return null;
  }
  if (
    !isSupportedSourcePath(filePath) ||
    isGeneratedPath(filePath) ||
    (!includeTests && isTestPath(filePath))
  ) {
    return null;
  }
  const cognitive = numericField(row.cognitive);
  const cyclomatic = numericField(row.complexity);
  const hiddenQuadratic = numericField(row.linear_scan_in_loop);
  return {
    name,
    path: filePath,
    line: numericField(row.start_line),
    lines: numericField(row.lines),
    cognitive,
    cyclomatic,
    ...(hiddenQuadratic > 0 ? { hiddenQuadratic } : {}),
  };
}

function compareFunctionMetrics(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  return (
    numericField(right.cognitive) - numericField(left.cognitive) ||
    numericField(right.cyclomatic) - numericField(left.cyclomatic) ||
    numericField(right.lines) - numericField(left.lines) ||
    compareText(String(left.path), String(right.path)) ||
    compareText(String(left.name), String(right.name))
  );
}

/** Accepts numbers or numeric strings; negative and non-numeric values become 0. */
function numericField(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
