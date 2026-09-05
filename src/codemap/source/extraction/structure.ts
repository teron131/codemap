/** Projects the shared source scan into graph structure without reparsing definitions or call text. */
import path from "node:path";

import { scanFile } from "../scanner/index.js";
import type { FileMetrics, SourceCall } from "../scanner/metrics.js";
import type { ScanEntry } from "./scan.js";

type StructureEntry = {
  path: string;
  functions: Array<{ name: string; startLine: number; endLine: number }>;
  classes: Array<{ name: string; startLine: number; endLine: number; methods: string[] }>;
  exports: Array<{ name: string }>;
  callGraph: SourceCall[];
};

export type StructurePayload = { results: StructureEntry[] };

/** Reuses the importing operation's measurements so graph and inspection share the same declaration facts. */
export function runStructure(
  root: string,
  files: ScanEntry[],
  { fileMetricsByPath = null }: { fileMetricsByPath?: Record<string, FileMetrics> | null },
): StructurePayload {
  return {
    results: files.map((file) =>
      structureForFile(root, file, { metricsByPath: fileMetricsByPath }),
    ),
  };
}

/** Builds file-local graph facts, scanning only when the caller does not already own them. */
export function structureForFile(
  root: string,
  entry: ScanEntry,
  { metricsByPath = null }: { metricsByPath?: Record<string, FileMetrics> | null } = {},
): StructureEntry {
  const metrics =
    metricsByPath?.[entry.path] ?? scanFile(path.join(root, entry.path), { displayRoot: root });
  const functions = metrics.functionSpans.map((span) => ({
    name: span.name,
    startLine: span.startLine,
    endLine: span.startLine + span.span - 1,
  }));
  const classes = metrics.classSpans.map((span) => ({
    name: span.name,
    startLine: span.startLine,
    endLine: span.startLine + span.span - 1,
    methods: span.methods,
  }));
  return {
    path: entry.path,
    functions,
    classes,
    exports: [...functions, ...classes].map(({ name }) => ({ name })),
    callGraph: metrics.callSites,
  };
}
