/** Projects the shared source scan into graph structure without reparsing definitions or call text. */
import path from "node:path";

import { scanFile } from "../scanner/index.js";
import type { FileMetrics, SourceCall } from "../scanner/metrics.js";
import type { ScanEntry } from "./scan.js";

export type StructureEntry = {
  path: string;
  functions: Array<{ name: string; startLine: number; endLine: number }>;
  classes: Array<{ name: string; startLine: number; endLine: number }>;
  callGraph: SourceCall[];
};

/** Builds file-local graph facts, scanning only when the caller does not already own them. */
export function structureForFile(
  root: string,
  entry: ScanEntry,
  { metricsByPath = null }: { metricsByPath?: Record<string, FileMetrics> | null } = {},
): StructureEntry {
  const metrics =
    metricsByPath?.[entry.path] ?? scanFile(path.join(root, entry.path), { displayRoot: root });
  return {
    path: entry.path,
    functions: metrics.functionSpans.map((span) => ({
      name: span.name,
      startLine: span.startLine,
      endLine: span.startLine + span.span - 1,
    })),
    classes: metrics.classSpans.map((span) => ({
      name: span.name,
      startLine: span.startLine,
      endLine: span.startLine + span.span - 1,
    })),
    callGraph: metrics.callSites,
  };
}
