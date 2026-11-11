/** Derives the summary skeleton: package or feature boundaries, one winner per structural role, and which boundaries get an outline. */

import path from "node:path";

import { isWithinDirectory, pathDepth } from "../../path-utils.js";
import { compareText } from "../../text-utils.js";
import type { StructuralOutline, StructuralReference, StructuralRole } from "../schema.js";
import { explicitReference, groupedReference } from "../structural-reference.js";
import { structuralOutlines } from "./outlines.js";
import { isConventionalSurface, type SourcePackage, sourcePackages } from "./packages.js";
import type { RelationshipRow } from "./relationships.js";
import type { SourceContext } from "./source-context.js";

/** `id` is the boundary's entry file when it has one, and a `package:` or `module:` key otherwise. */
type StructuralBoundary = {
  id: string;
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
  roles: StructuralRole[];
  outlines: StructuralOutline[];
  packages: SourcePackage[];
};

/**
 * Picks at most one boundary per structural role.
 * 1. Aggregate backend and working-tree imports, plus dependencies between in-repo packages, into cross-boundary edges.
 * 2. Entry: the declared boundary with the widest two-hop reach.
 * 3. Coordination: the boundary importing the most others, at least two, unless that repeats the entry.
 * 4. Foundation: the boundary imported by the most others, at least two; when it is also the coordinator, the two merge into one core role.
 * A tie that relationship weight cannot break leaves its role out.
 */
export function structuralSummary(
  backendRelationships: RelationshipRow[],
  source: SourceContext,
  workingTreeRelationships: RelationshipRow[],
): StructuralSummary {
  const packages = sourcePackages(source);
  const primaryRoot = primarySourceRoot(source.files.map((metrics) => metrics.relPath));
  const boundaries = structuralBoundaries(source, packages, primaryRoot);
  const edges = boundaryEdges(
    [...backendRelationships, ...workingTreeRelationships],
    source,
    boundaries,
    packages,
  );
  if (edges.length === 0) {
    return { roles: [], outlines: [], packages };
  }

  const outgoing = groupedBoundaryEdges(edges, "source");
  const incoming = groupedBoundaryEdges(edges, "target");
  const connectedBoundaries = new Set(edges.flatMap((edge) => [edge.source.id, edge.target.id]));
  const roles: StructuralRole[] = [];

  const entryCandidates = boundaries.filter(
    (boundary) => boundary.declared && (outgoing.get(boundary.id)?.length ?? 0) > 0,
  );
  const entryReach = entryCandidates.map((boundary) => ({
    boundary,
    reach: twoHopReach(boundary, outgoing),
    weight: edgeWeight(outgoing.get(boundary.id) ?? []),
  }));
  const entry = uniqueRoleWinner(
    entryReach,
    (candidate) => candidate.reach.size,
    (candidate) => candidate.weight,
  );
  if (entry !== null) {
    roles.push({
      kind: "entry",
      boundary: entry.boundary.label,
      related: relatedReferences(outgoing.get(entry.boundary.id) ?? [], "target"),
      share: null,
    });
  }

  const coordinators = [...outgoing]
    .filter(([, edges]) => edges.length >= 2)
    .map(([id, edges]) => ({ id, edges, weight: edgeWeight(edges) }));
  const coordinator = uniqueRoleWinner(
    coordinators,
    (candidate) => candidate.edges.length,
    (candidate) => candidate.weight,
  );
  if (coordinator !== null) {
    const boundary = boundaryLabel(boundaries, coordinator.id);
    const related = relatedReferences(coordinator.edges, "target");
    if (
      !roles.some((role) => role.boundary === boundary && sameReferences(role.related, related))
    ) {
      roles.push({ kind: "coordination", boundary, related, share: null });
    }
  }

  const foundations = [...incoming]
    .filter(([, edges]) => edges.length >= 2)
    .map(([id, edges]) => ({ id, edges, weight: edgeWeight(edges) }));
  const foundation = uniqueRoleWinner(
    foundations,
    (candidate) => candidate.edges.length,
    (candidate) => candidate.weight,
  );
  if (foundation !== null) {
    const boundary = boundaryLabel(boundaries, foundation.id);
    const related = relatedReferences(foundation.edges, "source");
    const share =
      connectedBoundaries.size > 1
        ? foundation.edges.length / (connectedBoundaries.size - 1)
        : null;
    const coordination = roles.find(
      (role) => role.kind === "coordination" && role.boundary === boundary,
    );
    if (coordination !== undefined) {
      coordination.kind = "core";
      coordination.related = uniqueStructuralReferences([...coordination.related, ...related]);
      coordination.share = share;
    } else {
      roles.push({ kind: "foundation", boundary, related, share });
    }
  }
  return {
    roles,
    outlines: structuralOutlines(source, outlinedBoundaries(boundaries, roles, primaryRoot)),
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

/** Prefers a top-level Python package holding a strict majority of files, otherwise the deepest directory holding one. */
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
      files: files.filter((file) => isWithinDirectory(file, root)).length,
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
  primaryRoot: string | null,
): StructuralBoundary[] {
  if (packages.length > 1) {
    return packages
      .map((item) => ({
        id: `package:${item.root || "."}`,
        label: item.root || item.names[0] || ".",
        root: item.root,
        declared: item.root === "" && item.declared,
        packageRoot: item.root,
      }))
      .sort(
        (left, right) =>
          pathDepth(right.root) - pathDepth(left.root) || compareText(left.id, right.id),
      );
  }

  if (primaryRoot === null) {
    return [];
  }
  const declaredSurfaces = new Set(packages.flatMap((sourcePackage) => sourcePackage.surfaces));
  const childRoots = new Set<string>();
  let ownsRootFiles = false;
  for (const file of source.filePaths) {
    if (!isWithinDirectory(file, primaryRoot)) {
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
        id: surface ?? `module:${root}`,
        label: root,
        root,
        declared: [...declaredSurfaces].some((file) => isWithinDirectory(file, root)),
        packageRoot: null,
      };
    })
    .sort(
      (left, right) =>
        pathDepth(right.root) - pathDepth(left.root) || compareText(left.id, right.id),
    );
}

/** Aggregates file-level imports and in-repo package dependencies into weighted cross-boundary edges. */
function boundaryEdges(
  relationships: RelationshipRow[],
  source: SourceContext,
  boundaries: StructuralBoundary[],
  packages: SourcePackage[],
): BoundaryEdge[] {
  const edgesByPair = new Map<string, BoundaryEdge>();
  for (const row of relationships) {
    if (!source.filePaths.has(row.source) || !source.filePaths.has(row.target)) {
      continue;
    }
    const sourceBoundary = owningBoundary(row.source, boundaries);
    const targetBoundary = owningBoundary(row.target, boundaries);
    if (sourceBoundary === null || targetBoundary === null || sourceBoundary === targetBoundary) {
      continue;
    }
    addBoundaryWeight(edgesByPair, sourceBoundary, targetBoundary, row.weight);
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

function addBoundaryWeight(
  edgesByPair: Map<string, BoundaryEdge>,
  source: StructuralBoundary,
  target: StructuralBoundary,
  weight: number,
): void {
  const key = `${source.id}\0${target.id}`;
  const existing = edgesByPair.get(key);
  edgesByPair.set(key, {
    source,
    target,
    weight: (existing?.weight ?? 0) + weight,
  });
}

/** Maps a source file to the deepest boundary that contains it, relying on `boundaries` arriving deepest first. */
function owningBoundary(file: string, boundaries: StructuralBoundary[]): StructuralBoundary | null {
  return boundaries.find((boundary) => isWithinDirectory(file, boundary.root)) ?? null;
}

/** Groups boundary edges by the chosen endpoint while retaining importance order. */
function groupedBoundaryEdges(
  edges: BoundaryEdge[],
  endpoint: "source" | "target",
): Map<string, BoundaryEdge[]> {
  const grouped = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const id = edge[endpoint].id;
    const groupEdges = grouped.get(id) ?? [];
    groupEdges.push(edge);
    grouped.set(id, groupEdges);
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
  for (const edge of outgoing.get(boundary.id) ?? []) {
    reached.add(edge.target.id);
    for (const nested of outgoing.get(edge.target.id) ?? []) {
      reached.add(nested.target.id);
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
    return edges.map((edge) => explicitReference(edge[endpoint].label));
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
        references.push(groupedReference(`${parent}/*`, members));
      }
    } else {
      references.push(explicitReference(edge[endpoint].label));
    }
  }
  return references;
}

/** Outlines only feature boundaries a role names, never the primary root itself; package workspaces get none. */
function outlinedBoundaries(
  boundaries: StructuralBoundary[],
  roles: StructuralRole[],
  primaryRoot: string | null,
): StructuralBoundary[] {
  if (boundaries.some((boundary) => boundary.packageRoot !== null)) {
    return [];
  }
  const selectedLabels = new Set([
    ...roles.map((role) => role.boundary),
    ...roles.flatMap((role) => role.related.map((reference) => reference.label)),
  ]);
  return boundaries.filter(
    (boundary) => boundary.root !== primaryRoot && selectedLabels.has(boundary.label),
  );
}

function boundaryLabel(boundaries: StructuralBoundary[], id: string): string {
  return boundaries.find((boundary) => boundary.id === id)?.label ?? id;
}

/** Normalizes JavaScript and Python distribution names for manifest dependency matching, as in `My_Pkg.core` → `my-pkg-core`. */
function normalizedPackageName(value: string): string {
  return value.toLowerCase().replace(/[_.]+/g, "-");
}

/** Compares already ordered related-module lists for redundant role suppression. */
function sameReferences(left: StructuralReference[], right: StructuralReference[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => JSON.stringify(value) === JSON.stringify(right[index]))
  );
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
