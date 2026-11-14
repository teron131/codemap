/** Fills the scanner's per-file record from Codebase Memory definitions for files the working-tree scanner cannot parse, so summary and inspection read every language through one shape. Only definition names, kinds, and line spans are filled: imports, exports, calls, and documentation stay empty. */
import { existsSync } from "node:fs";
import path from "node:path";

import { nonblankString, numberValue } from "../../json-utils.js";
import {
  createFileMetrics,
  definitionIdentifier,
  type FileMetrics,
  isGeneratedPath,
  isIgnoredPath,
  isSupportedSourcePath,
  isTestPath,
  PYTHON_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import { categoryForPath } from "./inventory.js";

export const BACKEND_DEFINITION_COLUMNS = [
  "label",
  "name",
  "file_path",
  "start_line",
  "end_line",
  "is_test",
];

/** Selects definitions outside the scanner's suffixes, so a Python or TypeScript project returns no rows; `file` narrows to one project-relative path, null to the whole project. */
export function backendDefinitionsQuery(file: string | null): string {
  const scanned = [...PYTHON_SUFFIXES, ...TYPESCRIPT_SUFFIXES].map(
    (suffix) => `d.file_path ENDS WITH '${suffix}'`,
  );
  const conditions = [`NOT (${scanned.join(" OR ")})`];
  if (file !== null) {
    conditions.push(`d.file_path = ${JSON.stringify(file)}`);
  }
  return [
    "MATCH (d:Function|Method|Class|Struct|Enum|Interface|Type)",
    `WHERE ${conditions.join(" AND ")}`,
    "RETURN labels(d) AS label, d.name AS name, d.file_path AS file_path, d.start_line AS start_line, d.end_line AS end_line, d.is_test AS is_test",
  ].join(" ");
}

/** One record per file, in first-seen order; rows under ignored, generated, or non-code paths, in files the scanner parses or that do not exist (the backend names pseudo-files such as `<python-builtins>`), or without a name or start line are dropped, as are test definitions unless `includeTests`. */
export function backendFileMetrics(
  root: string,
  rows: Record<string, unknown>[],
  { includeTests }: { includeTests: boolean },
): FileMetrics[] {
  const metricsByPath = new Map<string, FileMetrics>();
  for (const row of rows) {
    const name = nonblankString(row.name);
    const relPath = nonblankString(row.file_path);
    const startLine = numberValue(row.start_line);
    if (
      name === null ||
      relPath === null ||
      !(startLine >= 1) ||
      isSupportedSourcePath(relPath) ||
      isIgnoredPath(relPath) ||
      isGeneratedPath(relPath) ||
      categoryForPath(relPath) !== "code" ||
      (!includeTests && (isTestPath(relPath) || String(row.is_test) === "true")) ||
      !existsSync(path.join(root, relPath))
    ) {
      continue;
    }
    let metrics = metricsByPath.get(relPath);
    if (metrics === undefined) {
      metrics = createFileMetrics({
        path: path.join(root, relPath),
        relPath,
        suffix: path.extname(relPath),
      });
      metricsByPath.set(relPath, metrics);
    }
    const span = Math.max(1, numberValue(row.end_line) - startLine + 1);
    metrics.defines += 1;
    // The backend returns labels as a JSON list in a string, such as `["Method"]`.
    if (/"(?:Function|Method)"/.test(String(row.label))) {
      metrics.functionNames.push(name);
      metrics.functionSpans.push({
        name,
        identifier: definitionIdentifier(relPath, name),
        span,
        startLine,
      });
    } else {
      metrics.classSpans.push({ name, span, startLine });
    }
  }
  return [...metricsByPath.values()];
}
