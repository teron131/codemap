/** Outlines a directory's files and subdirectories in the fewest rendered bytes, collapsing wide levels into counted groups. */
import path from "node:path";

import { compareText } from "../../text-utils.js";
import type { StructuralOutline, StructuralReference } from "../schema.js";
import {
  explicitReference,
  groupedReference,
  renderStructuralReference,
} from "../structural-reference.js";
import { isConventionalSurface } from "./packages.js";
import type { SourceContext } from "./source-context.js";

/** Keeps only directories whose outline has a counted group; one that lists a few plain files adds nothing to the role rows. */
export function structuralOutlines(
  source: SourceContext,
  directories: Array<{ label: string; root: string }>,
): StructuralOutline[] {
  return directories
    .map(({ label, root }) => ({ boundary: label, items: structuralOutlineItems(source, root) }))
    .filter((outline) => outline.items.some((item) => item.count !== null))
    .sort((left, right) => compareText(left.boundary, right.boundary));
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

type StructuralPathTree = {
  files: Set<string>;
  children: Map<string, StructuralPathTree>;
};

function emptyStructuralPathTree(): StructuralPathTree {
  return { files: new Set(), children: new Map() };
}

/** Keeps direct files while optionally collapsing a wide set of child directories. */
function summarizeStructuralRoot(tree: StructuralPathTree): StructuralReference[] {
  const direct = [...tree.files].sort(compareText).map((file) => explicitReference(file));
  const childNames = [...tree.children.keys()].sort(compareText);
  const expanded = childNames.flatMap((child) =>
    summarizeStructuralDirectory(tree.children.get(child) ?? emptyStructuralPathTree(), child),
  );
  if (childNames.length > 3) {
    const collapsed = groupedReference("*/", childNames);
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
    .map((file) => explicitReference(`${prefix}/${file}`));
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
    const collapsed = groupedReference(`${prefix}/*`, members);
    if (structuralReferenceBytes([collapsed]) < structuralReferenceBytes(expanded)) {
      return [collapsed];
    }
  }
  return expanded.length > 0 ? expanded : [explicitReference(prefix)];
}

/** Measures the exact rendered payload used to choose between path representations. */
function structuralReferenceBytes(references: StructuralReference[]): number {
  const rendered = references.map(renderStructuralReference).join(", ");
  return Buffer.byteLength(rendered, "utf8");
}
