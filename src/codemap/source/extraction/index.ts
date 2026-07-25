/** Builds scan, import, and structure extraction payloads. */
import path from "node:path";

import { PY_SUFFIXES, scanFile, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";
import type { FileMetrics } from "../scanner/metrics.js";
import { parsePythonTree, pythonImportTargets, pythonModuleIndex } from "./python-imports.js";
import type { ScanEntry } from "./scan.js";
import {
  typescriptImportTargets,
  typescriptPathAliases,
  TypeScriptResolver,
} from "./typescript-imports.js";

export {
  parsePythonTree,
  pythonImportTargets,
  pythonModuleIndex,
  resolvePythonModule,
} from "./python-imports.js";
export {
  applyTypescriptAlias,
  TYPESCRIPT_RESOLUTION_SUFFIXES,
  type TypeScriptPathAlias,
  TypeScriptResolver,
  typescriptImportTargets,
  typescriptPathAliases,
  typescriptSourceBases,
} from "./typescript-imports.js";

export type ImportMapPayload = {
  importMap: Record<string, string[]>;
  stats: {
    filesScanned: number;
    edges: number;
  };
  _pythonTrees: Record<string, null>;
  _typescriptMetrics: Record<string, FileMetrics>;
};

/** Builds the project import map across Python and TypeScript-family files. */
export function runImportMap(root: string, files: ScanEntry[]): ImportMapPayload {
  const filePaths = new Set(files.map((scanEntry) => String(scanEntry.path)));
  const pythonModules = pythonModuleIndex(filePaths);
  const pythonTreesByPath: Record<string, null> = {};
  const typescriptAliases = typescriptPathAliases(root);
  const typescriptResolver = new TypeScriptResolver(root, filePaths, typescriptAliases);
  const typescriptMetricsByPath: Record<string, FileMetrics> = {};
  const importMap: Record<string, string[]> = {};
  for (const scanEntry of files) {
    const relPath = String(scanEntry.path);
    const filePath = path.join(root, relPath);
    const suffix = path.extname(filePath);
    if (PY_SUFFIXES.has(suffix)) {
      if (parsePythonTree(filePath) !== null) {
        pythonTreesByPath[relPath] = null;
      }
      importMap[relPath] = pythonImportTargets(filePath, root, filePaths, pythonModules);
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
    _pythonTrees: pythonTreesByPath,
    _typescriptMetrics: typescriptMetricsByPath,
  };
}

export {
  CONFIG_BASENAMES,
  categoryForPath,
  countLines,
  filterScan,
  LANGUAGE_BY_SUFFIX,
  runScan,
  type ScanEntry,
  type ScanPayload,
  scanEntry,
} from "./scan.js";
export type { StructurePayload } from "./structure.js";
export {
  callEdgesForFunction,
  callNames,
  pythonStructure,
  runStructure,
  structureForFile,
  typescriptStructure,
} from "./structure.js";
