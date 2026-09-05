/** Builds the project-wide import map across Python and TypeScript-family files. */
import path from "node:path";

import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/constants.js";
import type { FileMetrics } from "../scanner/metrics.js";
import { scanFile } from "../scanner/scan-file.js";
import { pythonImportTargets, pythonModuleIndex, readPythonSource } from "./python-imports.js";
import type { ScanEntry } from "./scan.js";
import {
  typescriptImportTargets,
  typescriptPathAliases,
  TypeScriptResolver,
} from "./typescript-imports.js";

/**
 * Import edges and operation-local source evidence reused by graph construction.
 *
 * TypeScript metrics and Python source belong to this operation and never persist across commands.
 */
export type ImportMapPayload = {
  importMap: Record<string, string[]>;
  stats: {
    filesScanned: number;
    edges: number;
  };
  pythonSources: Record<string, string>;
  fileMetrics: Record<string, FileMetrics>;
};

/** Builds the project import map across Python and TypeScript-family files. */
export function runImportMap(root: string, files: ScanEntry[]): ImportMapPayload {
  const filePaths = new Set(files.map((scanEntry) => String(scanEntry.path)));
  const pythonModules = pythonModuleIndex(filePaths);
  const pythonSources: Record<string, string> = {};
  const typescriptAliases = typescriptPathAliases(root);
  const typescriptResolver = new TypeScriptResolver(root, filePaths, typescriptAliases);
  const typescriptMetricsByPath: Record<string, FileMetrics> = {};
  const importMap: Record<string, string[]> = {};
  for (const scanEntry of files) {
    const relPath = String(scanEntry.path);
    const filePath = path.join(root, relPath);
    const suffix = path.extname(filePath);
    if (PY_SUFFIXES.has(suffix)) {
      const source = readPythonSource(filePath);
      if (source !== null) {
        pythonSources[relPath] = source;
      }
      importMap[relPath] =
        source === null
          ? []
          : pythonImportTargets(filePath, root, filePaths, pythonModules, { source });
    } else if (TYPESCRIPT_SUFFIXES.has(suffix)) {
      const metrics = scanFile(filePath, { displayRoot: root });
      typescriptMetricsByPath[relPath] = metrics;
      importMap[relPath] = typescriptImportTargets(filePath, metrics, typescriptResolver);
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
    pythonSources,
    fileMetrics: typescriptMetricsByPath,
  };
}
