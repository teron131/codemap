/** Classifies internal module roles, boundaries, flows, and compact directory outlines. */

import path from "node:path";

import { stringField } from "../../json-utils.js";
import { pythonModuleIndex, resolvePythonModule } from "../../source/extraction/python-imports.js";
import { typescriptImportTargets } from "../../source/extraction/typescript-imports.js";
import { type FileMetrics } from "../../source/scanner/index.js";
import { compareText, extentSamples } from "../../text-utils.js";
import { renderStructuralReference } from "../presentation.js";
import type { StructuralOutline, StructuralReference, StructuralSignal } from "../schema.js";
import { isConventionalSurface, type SourcePackage, sourcePackages } from "./packages.js";
import type { RelationshipRow } from "./relationships.js";
import type { SourceContext } from "./source-context.js";

type StructuralBoundary = {
  file: string;
  label: string;
  root: string;
  declared: boolean;
  packageRoot: string | null;
};

type BoundaryEdge = {
  source: StructuralBoundary;
  target: StructuralBoundary;
  weight: number;
};

export type StructuralSummary = {
  signals: StructuralSignal[];
  outlines: StructuralOutline[];
  packages: SourcePackage[];
};

/** Derives role-based signals and compact nested shape from repository relationships. */
export function structuralSummary(
  backendRelationships: RelationshipRow[],
  source: SourceContext,
  currentTreeRelationships: RelationshipRow[],
): StructuralSummary {
  const packages = sourcePackages(source);
  const boundaries = structuralBoundaries(source, packages);
  const edges = boundaryEdges(
    [...backendRelationships, ...currentTreeRelationships],
    source,
    boundaries,
    packages,
  );
  if (edges.length === 0) {
    return { signals: [], outlines: [], packages };
  }

  const outgoing = groupedBoundaryEdges(edges, "source");
  const incoming = groupedBoundaryEdges(edges, "target");
  const connectedBoundaries = new Set(
    edges.flatMap((edge) => [edge.source.file, edge.target.file]),
  );
  const signals: StructuralSignal[] = [];

  const entryCandidates = boundaries.filter(
    (boundary) => boundary.declared && (outgoing.get(boundary.file)?.length ?? 0) > 0,
  );
  const entryReach = entryCandidates.map((boundary) => ({
    boundary,
    reach: twoHopReach(boundary, outgoing),
    weight: edgeWeight(outgoing.get(boundary.file) ?? []),
  }));
  const entry = uniqueRoleWinner(
    entryReach,
    (candidate) => candidate.reach.size,
    (candidate) => candidate.weight,
  );
  if (entry !== null) {
    signals.push({
      kind: "entry",
      source: entry.boundary.label,
      targets: relatedReferences(outgoing.get(entry.boundary.file) ?? [], "target"),
      share: null,
    });
  }

  const coordinators = [...outgoing]
    .filter(([, edges]) => edges.length >= 2)
    .map(([file, edges]) => ({ file, edges, weight: edgeWeight(edges) }));
  const coordinator = uniqueRoleWinner(
    coordinators,
    (candidate) => candidate.edges.length,
    (candidate) => candidate.weight,
  );
  if (coordinator !== null) {
    const sourceLabel = boundaryLabel(boundaries, coordinator.file);
    const targets = relatedReferences(coordinator.edges, "target");
    if (
      !signals.some(
        (signal) => signal.source === sourceLabel && sameReferences(signal.targets, targets),
      )
    ) {
      signals.push({
        kind: "coordination",
        source: sourceLabel,
        targets,
        share: null,
      });
    }
  }

  const foundations = [...incoming]
    .filter(([, edges]) => edges.length >= 2)
    .map(([file, edges]) => ({ file, edges, weight: edgeWeight(edges) }));
  const foundation = uniqueRoleWinner(
    foundations,
    (candidate) => candidate.edges.length,
    (candidate) => candidate.weight,
  );
  if (foundation !== null) {
    const sourceLabel = boundaryLabel(boundaries, foundation.file);
    const relatedModules = relatedReferences(foundation.edges, "source");
    const share =
      connectedBoundaries.size > 1
        ? foundation.edges.length / (connectedBoundaries.size - 1)
        : null;
    const coordination = signals.find(
      (signal) => signal.kind === "coordination" && signal.source === sourceLabel,
    );
    if (coordination !== undefined) {
      coordination.kind = "core";
      coordination.targets = uniqueStructuralReferences([
        ...coordination.targets,
        ...relatedModules,
      ]);
      coordination.share = share;
    } else {
      signals.push({
        kind: "foundation",
        source: sourceLabel,
        targets: relatedModules,
        share,
      });
    }
  }
  return {
    signals,
    outlines: structuralOutlines(source, boundaries, signals),
    packages,
  };
}

/** Returns one unambiguous role winner by breadth, then relationship weight. */
function uniqueRoleWinner<T>(
  candidates: T[],
  breadth: (candidate: T) => number,
  weight: (candidate: T) => number,
): T | null {
  const maxBreadth = Math.max(0, ...candidates.map(breadth));
  const broadest = candidates.filter((candidate) => breadth(candidate) === maxBreadth);
  const maxWeight = Math.max(0, ...broadest.map(weight));
  const winners = broadest.filter((candidate) => weight(candidate) === maxWeight);
  return winners.length === 1 ? (winners[0] ?? null) : null;
}

/** Builds complete current-tree import relationships from the source scan already owned by summary. */
export function currentTreeRelationshipRows(source: SourceContext): RelationshipRow[] {
  const relationships: RelationshipRow[] = [];
  const pythonModules = pythonModuleIndex(source.filePaths);
  for (const metrics of source.files) {
    const targets =
      metrics.suffix === ".py"
        ? pythonMetricImportTargets(metrics, source.filePaths, pythonModules)
        : typescriptImportTargets(metrics.path, metrics, source.resolver);
    for (const target of targets) {
      relationships.push({ source: metrics.relPath, target, weight: 1 });
    }
  }
  return relationships;
}

/** Resolves scanner-owned Python import names against the project module index. */
function pythonMetricImportTargets(
  metrics: FileMetrics,
  filePaths: Set<string>,
  modules: ReturnType<typeof pythonModuleIndex>,
): string[] {
  const targets = new Set<string>();
  const packageParts = path.posix.dirname(metrics.relPath).split("/").filter(Boolean);
  for (const rawTarget of metrics.pyImportTargets) {
    const level = rawTarget.match(/^\.+/)?.[0].length ?? 0;
    const moduleParts = rawTarget.slice(level).split(".").filter(Boolean);
    const baseParts =
      level > 0 ? packageParts.slice(0, Math.max(0, packageParts.length - level + 1)) : [];
    for (const target of resolvePythonModule([...baseParts, ...moduleParts], filePaths, modules)) {
      targets.add(target);
    }
  }
  return [...targets].sort(compareText);
}

/** Finds the deepest source directory that contains a strict majority of eligible files. */
function primarySourceRoot(files: string[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const initDirs = new Set(
    files
      .filter((file) => path.posix.basename(file) === "__init__.py")
      .map((file) => path.posix.dirname(file)),
  );
  const topPackageRoots = [...initDirs]
    .filter((root) => !initDirs.has(path.posix.dirname(root)))
    .map((root) => ({
      root,
      files: files.filter((file) => file === `${root}/__init__.py` || file.startsWith(`${root}/`))
        .length,
    }))
    .filter((candidate) => candidate.files > files.length / 2)
    .sort(
      (left, right) =>
        right.files - left.files ||
        pathDepth(left.root) - pathDepth(right.root) ||
        compareText(left.root, right.root),
    );
  if (topPackageRoots[0] !== undefined) {
    return topPackageRoots[0].root;
  }
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = path.posix
      .dirname(file)
      .split("/")
      .filter((part) => part && part !== ".");
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return (
    [...counts]
      .filter(([, count]) => count > files.length / 2)
      .sort(
        (left, right) =>
          pathDepth(right[0]) - pathDepth(left[0]) ||
          right[1] - left[1] ||
          compareText(left[0], right[0]),
      )[0]?.[0] ?? null
  );
}

/** Chooses package boundaries for workspaces and feature boundaries for one-package repositories. */
function structuralBoundaries(
  source: SourceContext,
  packages: SourcePackage[],
): StructuralBoundary[] {
  if (packages.length > 1) {
    return packages
      .map((item) => ({
        file: `package:${item.root || "."}`,
        label: item.root || item.names[0] || ".",
        root: item.root,
        declared: item.root === "" && item.declared,
        packageRoot: item.root,
      }))
      .sort(
        (left, right) =>
          pathDepth(right.root) - pathDepth(left.root) || compareText(left.file, right.file),
      );
  }

  const primaryRoot = primarySourceRoot(source.files.map((metrics) => metrics.relPath));
  if (primaryRoot === null) {
    return [];
  }
  const declaredSurfaces = new Set(packages.flatMap((sourcePackage) => sourcePackage.surfaces));
  const childRoots = new Set<string>();
  let ownsRootFiles = false;
  for (const file of source.filePaths) {
    if (file !== primaryRoot && !file.startsWith(`${primaryRoot}/`)) {
      continue;
    }
    const relative = path.posix.relative(primaryRoot, file);
    const [child, nested] = relative.split("/", 2);
    if (child && nested !== undefined) {
      childRoots.add(`${primaryRoot}/${child}`);
    } else {
      ownsRootFiles = true;
    }
  }
  const roots = [...childRoots];
  if (ownsRootFiles) {
    roots.push(primaryRoot);
  }
  return roots
    .map((root) => {
      const surface = source.files.find(
        (metrics) =>
          path.posix.dirname(metrics.relPath) === root && isConventionalSurface(metrics.relPath),
      )?.relPath;
      return {
        file: surface ?? `module:${root}`,
        label: root,
        root,
        declared: [...declaredSurfaces].some(
          (file) => file === root || file.startsWith(`${root}/`),
        ),
        packageRoot: null,
      };
    })
    .sort(
      (left, right) =>
        pathDepth(right.root) - pathDepth(left.root) || compareText(left.file, right.file),
    );
}

/** Aggregates file-level graph facts into explicit cross-boundary relationships. */
function boundaryEdges(
  relationships: RelationshipRow[],
  source: SourceContext,
  boundaries: StructuralBoundary[],
  packages: SourcePackage[],
): BoundaryEdge[] {
  const edgesByPair = new Map<string, BoundaryEdge>();
  for (const row of relationships) {
    const sourceFile = stringField(row.source);
    const targetFile = stringField(row.target);
    if (
      sourceFile === null ||
      targetFile === null ||
      !source.filePaths.has(sourceFile) ||
      !source.filePaths.has(targetFile)
    ) {
      continue;
    }
    const sourceBoundary = owningBoundary(sourceFile, boundaries);
    const targetBoundary = owningBoundary(targetFile, boundaries);
    if (sourceBoundary === null || targetBoundary === null || sourceBoundary === targetBoundary) {
      continue;
    }
    addBoundaryWeight(edgesByPair, sourceBoundary, targetBoundary, numericValue(row.weight) ?? 1);
  }
  const packagesByName = new Map<string, SourcePackage>();
  for (const item of packages) {
    for (const name of item.names) {
      packagesByName.set(normalizedPackageName(name), item);
    }
  }
  for (const item of packages) {
    const sourceBoundary = boundaries.find((boundary) => boundary.packageRoot === item.root);
    if (sourceBoundary === undefined) {
      continue;
    }
    for (const dependency of item.dependencies) {
      const targetPackage = packagesByName.get(normalizedPackageName(dependency));
      const targetBoundary = boundaries.find(
        (boundary) => boundary.packageRoot === targetPackage?.root,
      );
      if (targetBoundary !== undefined && targetBoundary !== sourceBoundary) {
        addBoundaryWeight(edgesByPair, sourceBoundary, targetBoundary, 1);
      }
    }
  }
  return [...edgesByPair.values()].sort(
    (left, right) =>
      right.weight - left.weight ||
      compareText(left.source.label, right.source.label) ||
      compareText(left.target.label, right.target.label),
  );
}

/** Adds one normalized relationship weight to the boundary graph. */
function addBoundaryWeight(
  edgesByPair: Map<string, BoundaryEdge>,
  source: StructuralBoundary,
  target: StructuralBoundary,
  weight: number,
): void {
  const key = `${source.file}\0${target.file}`;
  const existing = edgesByPair.get(key);
  edgesByPair.set(key, {
    source,
    target,
    weight: (existing?.weight ?? 0) + weight,
  });
}

/** Maps a source file to the deepest explicit package or barrel boundary that owns it. */
function owningBoundary(file: string, boundaries: StructuralBoundary[]): StructuralBoundary | null {
  return (
    boundaries.find(
      (boundary) =>
        file === boundary.file || boundary.root === "" || file.startsWith(`${boundary.root}/`),
    ) ?? null
  );
}

/** Groups boundary edges by the chosen endpoint while retaining importance order. */
function groupedBoundaryEdges(
  edges: BoundaryEdge[],
  endpoint: "source" | "target",
): Map<string, BoundaryEdge[]> {
  const grouped = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const file = edge[endpoint].file;
    const groupEdges = grouped.get(file) ?? [];
    groupEdges.push(edge);
    grouped.set(file, groupEdges);
  }
  return grouped;
}

/** Totals graph relationship strength only to resolve equal module reach. */
function edgeWeight(edges: BoundaryEdge[]): number {
  return edges.reduce((total, edge) => total + edge.weight, 0);
}

/** Measures the distinct module territory exposed by an entry in two graph steps. */
function twoHopReach(
  boundary: StructuralBoundary,
  outgoing: Map<string, BoundaryEdge[]>,
): Set<string> {
  const reached = new Set<string>();
  for (const edge of outgoing.get(boundary.file) ?? []) {
    reached.add(edge.target.file);
    for (const nested of outgoing.get(edge.target.file) ?? []) {
      reached.add(nested.target.file);
    }
  }
  return reached;
}

/** Lists opposite boundaries while compacting one dominant repeated parent path. */
function relatedReferences(
  edges: BoundaryEdge[],
  endpoint: "source" | "target",
): StructuralReference[] {
  const packageEdges = edges.filter((edge) => edge[endpoint].packageRoot !== null);
  const byParent = new Map<string, BoundaryEdge[]>();
  for (const edge of packageEdges) {
    const root = edge[endpoint].packageRoot ?? "";
    const parent = path.posix.dirname(root);
    if (!root || parent === ".") {
      continue;
    }
    const siblingEdges = byParent.get(parent) ?? [];
    siblingEdges.push(edge);
    byParent.set(parent, siblingEdges);
  }
  const dominantFamily = [...byParent]
    .filter(
      ([parent, siblingEdges]) =>
        siblingEdges.length > 3 &&
        siblingEdges.length > packageEdges.length - siblingEdges.length &&
        (endpoint === "source" || pathDepth(parent) >= 2),
    )
    .sort((left, right) => right[1].length - left[1].length || compareText(left[0], right[0]))[0];
  if (dominantFamily === undefined) {
    return edges.map((edge) => explicitStructuralReference(edge[endpoint].label));
  }
  const [parent, familyEdges] = dominantFamily;
  const family = new Set(familyEdges);
  const references: StructuralReference[] = [];
  for (const edge of edges) {
    if (family.has(edge)) {
      if (!references.some((reference) => reference.label === `${parent}/*`)) {
        const members = familyEdges
          .map((item) => path.posix.relative(parent, item[endpoint].label))
          .sort(compareText);
        references.push({
          label: `${parent}/*`,
          count: members.length,
          examples: extentSamples(members),
        });
      }
    } else {
      references.push(explicitStructuralReference(edge[endpoint].label));
    }
  }
  return references;
}

/** Adds compact child shape only for selected single-package modules that benefit from grouping. */
function structuralOutlines(
  source: SourceContext,
  boundaries: StructuralBoundary[],
  signals: StructuralSignal[],
): StructuralOutline[] {
  if (boundaries.some((boundary) => boundary.packageRoot !== null)) {
    return [];
  }
  const sourceRoot = primarySourceRoot(source.files.map((metrics) => metrics.relPath));
  const selectedLabels = new Set([
    ...signals.map((signal) => signal.source),
    ...signals.flatMap((signal) => signal.targets.map((target) => target.label)),
  ]);
  const outlines: StructuralOutline[] = [];
  for (const boundary of boundaries) {
    if (boundary.root === sourceRoot || !selectedLabels.has(boundary.label)) {
      continue;
    }
    const items = structuralOutlineItems(source, boundary.root);
    if (!items.some((item) => item.count !== null)) {
      continue;
    }
    outlines.push({ source: boundary.label, items });
  }
  return outlines.sort((left, right) => compareText(left.source, right.source));
}

/** Chooses the shortest hierarchical path description while preserving root-level files. */
function structuralOutlineItems(source: SourceContext, root: string): StructuralReference[] {
  const tree = emptyStructuralPathTree();
  for (const metrics of source.files) {
    if (!metrics.relPath.startsWith(`${root}/`)) {
      continue;
    }
    const relative = path.posix.relative(root, metrics.relPath);
    const parts = relative.split("/").filter(Boolean);
    const file = parts.pop();
    if (file === undefined) {
      continue;
    }
    let node = tree;
    for (const part of parts) {
      const child = node.children.get(part) ?? emptyStructuralPathTree();
      node.children.set(part, child);
      node = child;
    }
    if (!isConventionalSurface(metrics.relPath)) {
      node.files.add(file);
    }
  }
  return summarizeStructuralRoot(tree);
}

/** Resolves a boundary identifier that originated from a grouped edge map. */
function boundaryLabel(boundaries: StructuralBoundary[], file: string): string {
  return boundaries.find((boundary) => boundary.file === file)?.label ?? file;
}

/** Accepts numeric aggregation strings returned by Codebase Memory query rows. */
function numericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Normalizes JavaScript and Python distribution names for manifest dependency matching. */
function normalizedPackageName(value: string): string {
  return value.toLowerCase().replace(/[_.]+/g, "-");
}

/** Counts non-empty POSIX path segments. */
function pathDepth(value: string): number {
  return value.split("/").filter(Boolean).length;
}

/** Compares already ordered related-module lists for redundant role suppression. */
function sameReferences(left: StructuralReference[], right: StructuralReference[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => JSON.stringify(value) === JSON.stringify(right[index]))
  );
}

type StructuralPathTree = {
  files: Set<string>;
  children: Map<string, StructuralPathTree>;
};

/** Creates one empty node for a source-path hierarchy. */
function emptyStructuralPathTree(): StructuralPathTree {
  return { files: new Set(), children: new Map() };
}

/** Keeps direct files while optionally collapsing a wide set of child directories. */
function summarizeStructuralRoot(tree: StructuralPathTree): StructuralReference[] {
  const direct = [...tree.files].sort(compareText).map((file) => explicitStructuralReference(file));
  const childNames = [...tree.children.keys()].sort(compareText);
  const expanded = childNames.flatMap((child) =>
    summarizeStructuralDirectory(tree.children.get(child) ?? emptyStructuralPathTree(), child),
  );
  if (childNames.length > 3) {
    const collapsed = compressedStructuralReference("*/", childNames);
    if (structuralReferenceBytes([collapsed]) < structuralReferenceBytes(expanded)) {
      return [...direct, collapsed];
    }
  }
  return [...direct, ...expanded].sort((left, right) => compareText(left.label, right.label));
}

/** Recursively expands a directory only while doing so costs less than one counted group. */
function summarizeStructuralDirectory(
  tree: StructuralPathTree,
  prefix: string,
): StructuralReference[] {
  const direct = [...tree.files]
    .sort(compareText)
    .map((file) => explicitStructuralReference(`${prefix}/${file}`));
  const childNames = [...tree.children.keys()].sort(compareText);
  const nested = childNames.flatMap((child) =>
    summarizeStructuralDirectory(
      tree.children.get(child) ?? emptyStructuralPathTree(),
      `${prefix}/${child}`,
    ),
  );
  const expanded = [...direct, ...nested].sort((left, right) =>
    compareText(left.label, right.label),
  );
  const members = [...tree.files, ...childNames].sort(compareText);
  if (members.length > 3) {
    const collapsed = compressedStructuralReference(`${prefix}/*`, members);
    if (structuralReferenceBytes([collapsed]) < structuralReferenceBytes(expanded)) {
      return [collapsed];
    }
  }
  return expanded.length > 0 ? expanded : [explicitStructuralReference(prefix)];
}

/** Creates one counted group with deterministic extent samples. */
function compressedStructuralReference(label: string, members: string[]): StructuralReference {
  return {
    label,
    count: members.length,
    examples: extentSamples(members),
  };
}

/** Measures the exact rendered payload used to choose between path representations. */
function structuralReferenceBytes(references: StructuralReference[]): number {
  const rendered = references.map(renderStructuralReference).join(", ");
  return Buffer.byteLength(rendered, "utf8");
}

/** Creates one uncompressed structural label. */
function explicitStructuralReference(label: string): StructuralReference {
  return { label, count: null, examples: [] };
}

/** Deduplicates rendered structural references without discarding group evidence. */
function uniqueStructuralReferences(references: StructuralReference[]): StructuralReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = JSON.stringify(reference);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
