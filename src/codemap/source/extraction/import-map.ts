/** Builds the project-wide import map across Python and TypeScript-family files. */
import path from "node:path";

import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/constants.js";
import type { FileMetrics } from "../scanner/metrics.js";
import { scanFile } from "../scanner/scan-file.js";
import { pythonImportTargets, pythonModuleIndex } from "./python-imports.js";
import type { ScanEntry } from "./scan.js";
import { typescriptImportTargets, TypeScriptResolver } from "./typescript-imports.js";

/**
 * Import edges and operation-local source evidence reused by graph construction.
 *
 * Parsed source facts belong to this operation and never persist across commands.
 */
export type ImportMapPayload = {
  importMap: Record<string, string[]>;
  stats: {
    filesScanned: number;
    edges: number;
  };
  fileMetrics: Record<string, FileMetrics>;
};

/** Builds the project import map across Python and TypeScript-family files. */
export function runImportMap(root: string, files: ScanEntry[]): ImportMapPayload {
  const filePaths = new Set(files.map((scanEntry) => String(scanEntry.path)));
  const pythonModules = pythonModuleIndex(filePaths);
  const typescriptResolver = new TypeScriptResolver(root, filePaths);
  const fileMetricsByPath: Record<string, FileMetrics> = {};
  const importMap: Record<string, string[]> = {};
  for (const scanEntry of files) {
    const relPath = String(scanEntry.path);
    const filePath = path.join(root, relPath);
    const suffix = path.extname(filePath);
    if (PY_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) {
      const metrics = scanFile(filePath, { displayRoot: root });
      fileMetricsByPath[relPath] = metrics;
      importMap[relPath] = PY_SUFFIXES.has(suffix)
        ? pythonImportTargets(metrics, filePaths, pythonModules)
        : typescriptImportTargets(filePath, metrics, typescriptResolver);
    } else {
      importMap[relPath] = [];
    }
  }
  return {
    importMap,
    stats: {
      filesScanned: files.length,
      edges: Object.values(importMap).reduce((total, targets) => total + targets.length, 0),
    },
    fileMetrics: fileMetricsByPath,
  };
}
