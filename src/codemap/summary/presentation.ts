/** Renders the summary as Markdown in a fixed order: overview, structure, most-called symbols, clusters, then public API. */
import path from "node:path";

import type {
  ClusterSummary,
  LanguageSummary,
  MostCalledSymbol,
  PublicSurface,
  ReadmeSection,
  RepositorySummary,
  StructuralOutline,
  StructuralRole,
} from "./schema.js";
import { renderStructuralReference } from "./structural-reference.js";

type PublicApiNode = {
  label: string;
  description: string | null;
  exports: string[];
  inlineModules: string[];
  children: PublicApiNode[];
};

type PublicSurfaceNode = {
  surface: PublicSurface;
  scope: string;
  parent: PublicSurfaceNode | null;
  children: PublicSurfaceNode[];
};

const PUBLIC_API_LEVELS = 3;

export function renderSummaryText(summary: RepositorySummary): string {
  const lines = [`# ${summary.project}`];
  appendOverview(lines, summary.readme, summary.languages);
  appendStructure(lines, summary.structuralRoles, summary.structuralOutlines);
  appendMostCalled(lines, summary.mostCalled);
  appendClusters(lines, summary.clusters);
  if (!summary.relationshipEvidenceAvailable) {
    const reason = summary.relationshipEvidenceFailureReason
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/\.$/, "");
    const explanation = reason ? ` Reason: ${reason}.` : "";
    lines.push(
      "",
      `_Codebase Memory unavailable; most-called symbols and clusters omitted.${explanation}_`,
    );
  }
  appendPublicApi(lines, summary.publicSurfaces);
  return `${lines.join("\n")}\n`;
}

function appendStructure(
  lines: string[],
  roles: StructuralRole[],
  outlines: StructuralOutline[],
): void {
  if (roles.length === 0 && outlines.length === 0) {
    return;
  }
  lines.push("", "## Structural Signals — role · imports");
  for (const role of roles) {
    const boundary = role.boundary;
    const related = role.related.map(renderStructuralReference).join(", ");
    if (role.kind === "entry") {
      lines.push(`- entry · ${boundary} → ${related}`);
      continue;
    }
    if (role.kind === "coordination") {
      lines.push(`- coordination · ${boundary} → ${related}`);
      continue;
    }
    const importedBy =
      role.share === null ? "" : ` · imported by ${formatPercent(role.share)} of modules`;
    if (role.kind === "core") {
      lines.push(`- core · ${boundary} ↔ ${related}${importedBy}`);
      continue;
    }
    lines.push(`- foundation · ${related} → ${boundary}${importedBy}`);
  }
  for (const outline of outlines) {
    lines.push(`- inside ${outline.boundary}`);
    const directItems = outline.items.filter((item) => item.count === null);
    const renderedChildren: string[] = [];
    if (directItems.length > 0) {
      renderedChildren.push(directItems.map(renderStructuralReference).join(", "));
    }
    for (const group of outline.items.filter((item) => item.count !== null)) {
      renderedChildren.push(renderStructuralReference(group));
    }
    for (const [index, child] of renderedChildren.entries()) {
      lines.push(`  ${index === renderedChildren.length - 1 ? "└─" : "├─"} ${child}`);
    }
  }
}

function appendOverview(
  lines: string[],
  sections: ReadmeSection[],
  languages: LanguageSummary[],
): void {
  if (sections.length === 0 && languages.length === 0) {
    return;
  }
  lines.push("", "## Overview");
  const outline = sections.filter((item) => item.outline);
  if (outline.length > 0) {
    lines.push("", "### README Outline");
    for (const section of outline) {
      lines.push(`${"  ".repeat(Math.max(0, section.level - 1))}- ${section.title}`);
    }
  }
  for (const section of sections.filter((item) => item.content.length > 0)) {
    lines.push("", `### ${section.title}`, ...section.content);
  }
  if (languages.length > 0) {
    lines.push(
      "",
      "### Languages",
      languages.map((language) => `${language.name} ${formatPercent(language.share)}`).join(" · "),
    );
  }
}

function appendPublicApi(lines: string[], surfaces: PublicSurface[]): void {
  if (surfaces.length === 0) {
    return;
  }
  lines.push(
    "",
    "## Public API — selected by shallowest entry, most importers, most modules exposed",
  );
  lines.push("Defining exports shown where clear.");
  for (const node of publicApiTree(surfaces)) {
    lines.push(renderPublicApiNode(node));
    appendPublicApiChildren(lines, node, "");
  }
}

/** Nests the selected surfaces without collecting additional API entries. */
function publicApiTree(surfaces: PublicSurface[]): PublicApiNode[] {
  const sourceNodes: PublicSurfaceNode[] = surfaces.map((surface) => ({
    surface,
    scope: publicSurfaceScope(surface.file),
    parent: null,
    children: [],
  }));
  for (const node of sourceNodes) {
    const parent = sourceNodes
      .filter((candidate) => candidate !== node && node.scope.startsWith(`${candidate.scope}/`))
      .sort((left, right) => right.scope.length - left.scope.length)[0];
    if (parent !== undefined) {
      node.parent = parent;
      parent.children.push(node);
    }
  }
  return sourceNodes
    .filter((node) => node.parent === null)
    .map((node) => {
      const root = publicApiNode(node.surface.file, node.surface.description);
      populatePublicApiNode(root, node, 1);
      return root;
    });
}

function populatePublicApiNode(
  targetNode: PublicApiNode,
  surfaceNode: PublicSurfaceNode,
  depth: number,
): void {
  for (const capability of surfaceNode.surface.modules) {
    const inserted = insertPublicApiPath(targetNode, capability.label, depth);
    inserted.node.exports = [...new Set([...inserted.node.exports, ...capability.exports])];
  }
  for (const child of surfaceNode.children) {
    const relative = relativePublicSurfacePath(surfaceNode.scope, child);
    const inserted = insertPublicApiPath(targetNode, relative, depth);
    if (inserted.node.description === null) {
      inserted.node.description = child.surface.description;
    }
    populatePublicApiNode(inserted.node, child, inserted.depth);
  }
}

/** Uses directory names for package entries and module stems for nested source files. */
function relativePublicSurfacePath(parentScope: string, child: PublicSurfaceNode): string {
  const relative = path.posix.relative(parentScope, child.scope);
  if (child.scope !== child.surface.file) {
    return relative;
  }
  const dirname = path.posix.dirname(relative);
  const basename = path.posix.basename(relative);
  const stem = basename.replace(/\.d\.[^.]+$/, "").replace(/\.[^.]+$/, "");
  return dirname === "." ? stem : `${dirname}/${stem}`;
}

/** Inserts a relative path while collapsing any tail that would exceed three levels; scoped names such as `@scope/pkg` stay one segment. */
function insertPublicApiPath(
  parent: PublicApiNode,
  value: string,
  parentDepth: number,
): { node: PublicApiNode; depth: number } {
  const remainingLevels = PUBLIC_API_LEVELS - parentDepth;
  if (remainingLevels <= 0) {
    if (!parent.inlineModules.includes(value)) {
      parent.inlineModules.push(value);
    }
    return { node: parent, depth: parentDepth };
  }
  const rawParts = value.startsWith("@/") || /^@[^/]+\//.test(value) ? [value] : value.split("/");
  const parts = rawParts.filter(Boolean);
  const displayedParts =
    parts.length <= remainingLevels
      ? parts
      : [...parts.slice(0, remainingLevels - 1), parts.slice(remainingLevels - 1).join("/")];
  let node = parent;
  let depth = parentDepth;
  for (const label of displayedParts) {
    let child = node.children.find((candidate) => candidate.label === label);
    if (child === undefined) {
      child = publicApiNode(label, null);
      node.children.push(child);
    }
    node = child;
    depth += 1;
  }
  return { node, depth };
}

function publicApiNode(label: string, description: string | null): PublicApiNode {
  return { label, description, exports: [], inlineModules: [], children: [] };
}

/** Treats conventional package entry files as the scope they publicly represent. */
function publicSurfaceScope(file: string): string {
  const basename = path.posix.basename(file);
  return /^(?:index(?:\.d)?\.[^.]+|__init__\.py)$/.test(basename) ? path.posix.dirname(file) : file;
}

function renderPublicApiNode(node: PublicApiNode): string {
  const details: string[] = [];
  if (node.description !== null) {
    details.push(node.description.replace(/\s+/g, " "));
  }
  if (node.inlineModules.length > 0) {
    details.push(`modules: ${node.inlineModules.join(", ")}`);
  }
  const detailSuffix = details.length > 0 ? ` — ${details.join("; ")}` : "";
  const exportNames = node.exports.length > 0 ? `: ${node.exports.join(", ")}` : "";
  return `${node.label}${exportNames}${detailSuffix}`;
}

/** Adds explicit tree branches so hierarchy survives plain-text and Markdown viewing. */
function appendPublicApiChildren(lines: string[], parent: PublicApiNode, prefix: string): void {
  for (const [index, child] of parent.children.entries()) {
    const isLast = index === parent.children.length - 1;
    lines.push(`${prefix}${isLast ? "└─" : "├─"} ${renderPublicApiNode(child)}`);
    appendPublicApiChildren(lines, child, `${prefix}${isLast ? "   " : "│  "}`);
  }
}

function appendMostCalled(lines: string[], symbols: MostCalledSymbol[]): void {
  if (symbols.length === 0) {
    return;
  }
  lines.push("", "## Most Called — symbol · location · share of all calls");
  for (const symbol of symbols) {
    const location = symbol.file ?? "—";
    const share = symbol.callShare === null ? "frequent" : formatPercent(symbol.callShare);
    const description = symbol.description === null ? "" : ` · ${symbol.description}`;
    lines.push(`- ${symbol.name} · ${location} · ${share}${description}`);
  }
}

function appendClusters(lines: string[], clusters: ClusterSummary[]): void {
  if (clusters.length === 0) {
    return;
  }
  lines.push("", "## Clusters — label · share of symbols · internal calls");
  for (const cluster of clusters) {
    const symbolShare = cluster.symbolShare === null ? "—" : formatPercent(cluster.symbolShare);
    const internalCalls =
      cluster.internalCallShare === null ? "—" : formatPercent(cluster.internalCallShare);
    lines.push(`- ${cluster.label} · ${symbolShare} · ${internalCalls}`);
    const detail = cluster.description ?? cluster.topNodes.join(", ");
    if (detail) {
      lines.push(`  └─ ${detail}`);
    }
  }
}

/** Shows at most one decimal, as in `0.123` → `12.3%`, with `100%` from 99.95% up and `<0.1%` for tiny positive ratios. */
function formatPercent(ratio: number): string {
  const percentage = ratio * 100;
  if (percentage >= 99.95) {
    return "100%";
  }
  if (percentage > 0 && percentage < 0.1) {
    return "<0.1%";
  }
  return `${percentage.toFixed(1).replace(/\.0$/, "")}%`;
}
