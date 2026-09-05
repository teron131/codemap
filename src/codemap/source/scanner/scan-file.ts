/** Dispatches one source file to the scanner for its language. */
import path from "node:path";

import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "./constants.js";
import { relativePath } from "./discovery.js";
import { createFileMetrics, type FileMetrics } from "./metrics.js";
import { scanPythonFile } from "./python.js";
import { scanTypescriptFile } from "./typescript.js";

/**
 * Scans one file with the matching language scanner.
 *
 * Supplied source reuses the calling operation's read without retaining state between commands.
 * Unsupported suffixes return empty metrics rather than failing, so callers can walk a mixed tree without pre-filtering by language.
 */
export function scanFile(
  filePath: string,
  { displayRoot, source }: { displayRoot: string; source?: string | undefined },
): FileMetrics {
  const relPath = relativePath(filePath, { displayRoot });
  const suffix = path.extname(filePath);
  if (PY_SUFFIXES.has(suffix)) {
    return scanPythonFile(filePath, { relPath, source });
  }
  if (TYPESCRIPT_SUFFIXES.has(suffix)) {
    return scanTypescriptFile(filePath, { relPath, source });
  }
  return createFileMetrics({
    path: filePath,
    relPath,
    suffix,
  });
}
