/** Scans source files through one batched ast-grep run and dispatches each file's matches to the scanner for its language. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { scanSyntax } from "../../ast-grep.js";
import { PYTHON_SUFFIXES, TYPESCRIPT_SUFFIXES } from "./constants.js";
import { relativePath } from "./discovery.js";
import { createFileMetrics, type FileMetrics } from "./metrics.js";
import { PYTHON_SCAN_RULES, pythonFileMetrics } from "./python.js";
import {
  MAX_FULL_SCAN_BYTES,
  TYPESCRIPT_SCAN_RULES,
  TYPESCRIPT_SURFACE_RULES,
  typescriptFileMetrics,
} from "./typescript.js";

/** One record per path, in order. Unsupported suffixes and unreadable files return empty metrics rather than failing, so callers can walk a mixed tree without pre-filtering by language. */
export function scanFiles(
  filePaths: string[],
  { displayRoot }: { displayRoot: string },
): FileMetrics[] {
  const sources = new Map<string, string>();
  const fullScan: string[] = [];
  const surfaceScan: string[] = [];
  for (const filePath of filePaths) {
    const suffix = path.extname(filePath);
    const python = PYTHON_SUFFIXES.has(suffix);
    if (!python && !TYPESCRIPT_SUFFIXES.has(suffix)) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    sources.set(filePath, source);
    const surface = !python && Buffer.byteLength(source, "utf8") > MAX_FULL_SCAN_BYTES;
    (surface ? surfaceScan : fullScan).push(filePath);
  }
  const matches = scanSyntax(fullScan, [...PYTHON_SCAN_RULES, ...TYPESCRIPT_SCAN_RULES]);
  for (const [filePath, fileMatches] of scanSyntax(surfaceScan, TYPESCRIPT_SURFACE_RULES)) {
    matches.set(filePath, fileMatches);
  }
  return filePaths.map((filePath) => {
    const relPath = relativePath(filePath, { displayRoot });
    const source = sources.get(filePath);
    if (source === undefined) {
      return createFileMetrics({ path: filePath, relPath, suffix: path.extname(filePath) });
    }
    const scanned = { relPath, source, matches: matches.get(filePath) ?? [] };
    return PYTHON_SUFFIXES.has(path.extname(filePath))
      ? pythonFileMetrics(filePath, scanned)
      : typescriptFileMetrics(filePath, scanned);
  });
}

export function scanFile(filePath: string, { displayRoot }: { displayRoot: string }): FileMetrics {
  return scanFiles([filePath], { displayRoot })[0]!;
}
