/** Resolves an inspect target to the files it names or defines, widened by one import hop each way for graph emission. */
import { statSync } from "node:fs";
import path from "node:path";

import { expandUser, isDirectory } from "../common.js";
import type { ScanEntry } from "../source/extraction/index.js";
import type { GraphNode } from "../source/graph/index.js";
import { type FileMetrics, scanFile } from "../source/scanner/index.js";

type InspectTargetKind = "directory" | "file";

export function inspectPathTargetKind(root: string, target: string): InspectTargetKind | null {
  const targetPath = path.resolve(root, target);
  try {
    const stats = statSync(targetPath);
    if (stats.isDirectory()) {
      return "directory";
    }
    return stats.isFile() ? "file" : null;
  } catch {
    return null;
  }
}

/** Makes absolute targets inside `root` relative and leaves others alone; with root `/repo`, `/repo/src/a.ts` → `src/a.ts`, `/repo` → `""`, and `parseConfig` → `parseConfig`. */
export function normalizeTarget(root: string, target: string): string {
  const expanded = expandUser(target);
  if (path.isAbsolute(expanded)) {
    const relative = path.relative(root, expanded);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
    if (expanded === root) {
      return "";
    }
    return target;
  }
  return target;
}

function targetFilePaths(
  root: string,
  rawTarget: string,
  files: ScanEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
  const target = normalizeTarget(root, rawTarget);
  const filesByPath = new Set(files.map((entry) => entry.path));
  if (isDirectory(path.join(root, target))) {
    return directoryFilePaths(target, filesByPath);
  }
  if (filesByPath.has(target)) {
    return new Set([target]);
  }
  return symbolFilePaths(root, target, files, fileMetricsByPath);
}

function directoryFilePaths(target: string, filesByPath: Set<string>): Set<string> {
  if (target === "" || target === ".") {
    return new Set(filesByPath);
  }
  const prefix = `${target.replace(/\/+$/, "")}/`;
  return new Set([...filesByPath].filter((filePath) => filePath.startsWith(prefix)));
}

/** Caches every metrics record it scans into `fileMetricsByPath` (mutated) for the rest of the inspection. */
function symbolFilePaths(
  root: string,
  target: string,
  files: ScanEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
  const paths = new Set<string>();
  for (const scanEntry of files) {
    const relPath = scanEntry.path;
    let metrics = fileMetricsByPath[relPath];
    if (metrics === undefined && relPath) {
      metrics = scanFile(path.join(root, relPath), { displayRoot: root });
      fileMetricsByPath[relPath] = metrics;
    }
    if (
      metrics &&
      (metrics.functionNames.includes(target) ||
        metrics.classSpans.some((span) => span.name === target) ||
        metrics.variableNames.includes(target) ||
        metrics.exportedNames.includes(target))
    ) {
      paths.add(relPath);
    }
  }
  return paths;
}

/** Null when the target names no file, directory, or defined symbol; scans it performs are cached into `fileMetricsByPath`. */
export function inspectEmitPaths(
  root: string,
  rawTarget: string,
  scan: ScanEntry[],
  importMap: Record<string, string[] | undefined>,
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> | null {
  const paths = targetFilePaths(root, rawTarget, scan, fileMetricsByPath);
  if (paths.size === 0) {
    return null;
  }
  const basePaths = new Set(paths);
  for (const sourcePath of basePaths) {
    for (const targetPath of importMap[sourcePath] ?? []) {
      paths.add(targetPath);
    }
  }
  for (const [sourcePath, targets] of Object.entries(importMap)) {
    if ((targets ?? []).some((targetPath) => basePaths.has(targetPath))) {
      paths.add(sourcePath);
    }
  }
  return paths;
}

/** Case-insensitive exact matches on id, path, or name come before substring matches. */
export function inspectCandidates(graphNodes: GraphNode[], target: string): GraphNode[] {
  const lowered = target.toLowerCase();
  const exact: GraphNode[] = [];
  const partial: GraphNode[] = [];
  for (const node of graphNodes) {
    const values = [node.id, node.filePath, node.name];
    if (values.some((value) => value.toLowerCase() === lowered)) {
      exact.push(node);
    } else if (values.some((value) => value.toLowerCase().includes(lowered))) {
      partial.push(node);
    }
  }
  return [...exact, ...partial];
}

export function nodeLabel(node: GraphNode): string {
  if (node.type === "function" || node.type === "class") {
    const suffix = node.lineRange?.length ? `:${String(node.lineRange[0])}` : "";
    return `${node.name} in ${node.filePath}${suffix}`;
  }
  return node.filePath || node.id;
}
