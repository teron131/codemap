/** Maps each inventoried file to the inventoried files it imports, scanning each source file once for later reuse. */
import path from "node:path";

import {
  type FileMetrics,
  PYTHON_SUFFIXES,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import { ImportResolver } from "./import-resolver.js";
import type { InventoryEntry } from "./inventory.js";

/**
 * Import edges and operation-local source evidence reused by graph construction.
 *
 * Parsed source facts belong to this operation and never persist across commands.
 */
export type ImportMapPayload = {
  importMap: Record<string, string[]>;
  fileMetrics: Record<string, FileMetrics>;
};

export function runImportMap(root: string, files: InventoryEntry[]): ImportMapPayload {
  const filePaths = new Set(files.map((inventoryEntry) => String(inventoryEntry.path)));
  const resolver = new ImportResolver(root, filePaths);
  const fileMetricsByPath: Record<string, FileMetrics> = {};
  const importMap: Record<string, string[]> = {};
  for (const inventoryEntry of files) {
    const relPath = String(inventoryEntry.path);
    const filePath = path.join(root, relPath);
    const suffix = path.extname(filePath);
    if (PYTHON_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) {
      const metrics = scanFile(filePath, { displayRoot: root });
      fileMetricsByPath[relPath] = metrics;
      importMap[relPath] = resolver.targets(metrics);
    } else {
      importMap[relPath] = [];
    }
  }
  return { importMap, fileMetrics: fileMetricsByPath };
}
