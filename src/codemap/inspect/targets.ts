/** Resolves an inspect target to the files it names or defines, widened by one import hop each way for graph emission. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { expandUser, isDirectory, isWithinDirectory } from "../path-utils.js";
import type { InventoryEntry } from "../source/extraction/index.js";
import type { GraphNode } from "../source/graph/index.js";
import {
  type FileMetrics,
  isMemberOf,
  type QualifiedName,
  qualifiedName,
  scanFile,
} from "../source/scanner/index.js";

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

/** Rewrites a target naming an existing path inside `root` as its project-relative path, so `./src/a.ts`, `src/a.ts`, and the absolute path inspect the same file and `root` itself becomes `""`; symbol names and outside paths pass through. */
export function normalizeTarget(root: string, target: string): string {
  const resolved = path.resolve(root, expandUser(target));
  if (!existsSync(resolved)) {
    return target;
  }
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return target;
  }
  return relative.split(path.sep).join("/");
}

function targetFilePaths(
  root: string,
  target: string,
  files: InventoryEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
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
  return new Set([...filesByPath].filter((filePath) => isWithinDirectory(filePath, target)));
}

/** Caches every metrics record it scans into `fileMetricsByPath` (mutated) for the rest of the inspection. */
function symbolFilePaths(
  root: string,
  target: string,
  files: InventoryEntry[],
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> {
  const paths = new Set<string>();
  const qualified = qualifiedName(target);
  for (const inventoryEntry of files) {
    const relPath = inventoryEntry.path;
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
        metrics.exportedNames.includes(target) ||
        (qualified !== null && definesMember(metrics, qualified)))
    ) {
      paths.add(relPath);
    }
  }
  return paths;
}

function definesMember(metrics: FileMetrics, { owner, member }: QualifiedName): boolean {
  return [...metrics.functionSpans, ...metrics.classSpans].some(
    (span) => span.name === member && isMemberOf(metrics, owner, span.startLine),
  );
}

/** Takes a normalized target; null when it names no file, directory, or defined symbol, and the scans it performs are cached into `fileMetricsByPath`. */
export function inspectEmitPaths(
  root: string,
  target: string,
  inventory: InventoryEntry[],
  importMap: Record<string, string[] | undefined>,
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): Set<string> | null {
  const paths = targetFilePaths(root, target, inventory, fileMetricsByPath);
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

/** A qualified name such as `Model.save` selects only the definitions of `save` that belong to `Model`, when any exist; otherwise case-insensitive exact matches on id, path, or name come before substring matches. */
export function inspectCandidates(
  graphNodes: GraphNode[],
  target: string,
  fileMetricsByPath: Record<string, FileMetrics | undefined>,
): GraphNode[] {
  const qualified = qualifiedName(target);
  if (qualified !== null) {
    const members = graphNodes.filter((node) => {
      const metrics = fileMetricsByPath[node.filePath];
      return (
        node.name === qualified.member &&
        node.lineRange !== undefined &&
        metrics !== undefined &&
        isMemberOf(metrics, qualified.owner, node.lineRange[0])
      );
    });
    if (members.length > 0) {
      return members;
    }
  }
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
    const suffix = node.lineRange ? `:${node.lineRange[0]}` : "";
    return `${node.name} in ${node.filePath}${suffix}`;
  }
  return node.filePath || node.id;
}
