/** Presents the combined repository summary as concise, tree-shaped text. */
import path from "node:path";

import type {
  ClusterSummary,
  ExportSurface,
  HotspotSummary,
  LanguageSummary,
  ReadmeSection,
  RepositorySummary,
  StructuralOutline,
  StructuralReference,
  StructuralSignal,
} from "./schema.js";

type PublicApiNode = {
  label: string;
  description: string | null;
  exports: string[];
  inlineModules: string[];
  children: PublicApiNode[];
};

type PublicSurfaceNode = {
  surface: ExportSurface;
  scope: string;
  parent: PublicSurfaceNode | null;
  children: PublicSurfaceNode[];
};

const PUBLIC_API_LEVELS = 3;

/** Renders one repository-orientation document from current-tree and graph facts. */
export function renderSummaryText(summary: RepositorySummary): string {
  const lines = [`# ${summary.project}`];
  appendOverview(lines, summary.readme, summary.languages);
  appendStructuralSignals(lines, summary.structuralSignals, summary.structuralOutlines);
  appendHotspots(lines, summary.hotspots);
  appendClusters(lines, summary.clusters);
  if (!summary.relationshipEvidenceAvailable) {
    const reason = summary.relationshipEvidenceFailureReason
      ?.replace(/\s+/g, " ")
      .trim()
      .replace(/\.$/, "");
    const explanation = reason ? ` Reason: ${reason}.` : "";
    lines.push("", `_Codebase Memory unavailable; hotspots and clusters omitted.${explanation}_`);
  }
  appendExportSurfaces(lines, summary.exportSurfaces);
  return `${lines.join("\n")}\n`;
}

/** Adds only graph roles that reveal a repository's public module skeleton. */
function appendStructuralSignals(
  lines: string[],
  signals: StructuralSignal[],
  outlines: StructuralOutline[],
): void {
  if (signals.length === 0 && outlines.length === 0) {
    return;
  }
  lines.push("", "## Structural Signals — role · flow · peer reach");
  for (const signal of signals) {
    const sourceLabel = signal.source;
    const targets = signal.targets.map(renderStructuralReference).join(", ");
    if (signal.kind === "entry") {
      lines.push(`- entry · ${sourceLabel} → ${targets}`);
      continue;
    }
    if (signal.kind === "coordination") {
      lines.push(`- coordination · ${sourceLabel} → ${targets}`);
      continue;
    }
    if (signal.kind === "core") {
      const share = signal.share === null ? "" : ` · ${formatPercent(signal.share)}`;
      lines.push(`- core · ${sourceLabel} → ${targets}${share}`);
      continue;
    }
    const share = signal.share === null ? "" : ` · ${formatPercent(signal.share)}`;
    lines.push(`- foundation · ${targets} → ${sourceLabel}${share}`);
  }
  for (const outline of outlines) {
    lines.push(`- inside ${outline.source}`);
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

/** Renders an explicit boundary or one counted same-parent compression group. */
export function renderStructuralReference(reference: StructuralReference): string {
  if (reference.count === null) {
    return reference.label;
  }
  return `${reference.label} [${reference.count}]: ${renderStructuralExamples(reference)}`;
}

/** Marks only real gaps between sorted first, middle, and last extent samples. */
function renderStructuralExamples(reference: StructuralReference): string {
  const examples = reference.examples;
  if (reference.count === null || reference.count <= examples.length || examples.length !== 3) {
    return examples.join(", ");
  }
  const positions = [0, Math.floor((reference.count - 1) / 2), reference.count - 1];
  const rendered = [examples[0] ?? ""];
  for (let index = 1; index < examples.length; index += 1) {
    if ((positions[index] ?? 0) - (positions[index - 1] ?? 0) > 1) {
      rendered.push("…");
    }
    rendered.push(examples[index] ?? "");
  }
  return rendered.filter(Boolean).join(", ");
}

/** Adds README orientation and one GitHub-style authored-source language line. */
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

/** Adds selected public surfaces and at most one directly exposed module level. */
function appendExportSurfaces(lines: string[], surfaces: ExportSurface[]): void {
  if (surfaces.length === 0) {
    return;
  }
  lines.push("", "## Public API — entry position · import reach · implementation breadth");
  lines.push("Defining exports shown where clear.");
  for (const node of publicApiTree(surfaces)) {
    lines.push(renderPublicApiNode(node));
    appendPublicApiChildren(lines, node, "");
  }
}

/** Nests the selected surfaces without collecting additional API entries. */
function publicApiTree(surfaces: ExportSurface[]): PublicApiNode[] {
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

/** Adds directly exposed modules and descendant surfaces within the three-level view. */
function populatePublicApiNode(
  targetNode: PublicApiNode,
  surfaceNode: PublicSurfaceNode,
  depth: number,
): void {
  for (const capability of surfaceNode.surface.capabilities) {
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

/** Inserts a relative path while collapsing any tail that would exceed three levels. */
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

/** Creates one render-only public API tree node. */
function publicApiNode(label: string, description: string | null): PublicApiNode {
  return { label, description, exports: [], inlineModules: [], children: [] };
}

/** Treats conventional package entry files as the scope they publicly represent. */
function publicSurfaceScope(file: string): string {
  const basename = path.posix.basename(file);
  return /^(?:index(?:\.d)?\.[^.]+|__init__\.py)$/.test(basename) ? path.posix.dirname(file) : file;
}

/** Renders one public API node without repeating the section's field labels. */
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

/** Adds non-generic call hotspots as a share of the indexed call graph. */
function appendHotspots(lines: string[], hotspots: HotspotSummary[]): void {
  if (hotspots.length === 0) {
    return;
  }
  lines.push("", "## Hotspots — symbol · location · indexed call share");
  for (const hotspot of hotspots) {
    const location = hotspot.file ?? "—";
    const share = hotspot.callShare === null ? "frequent" : formatPercent(hotspot.callShare);
    const description = hotspot.description === null ? "" : ` · ${hotspot.description}`;
    lines.push(`- ${hotspot.name} · ${location} · ${share}${description}`);
  }
}

/** Adds call-graph communities with understandable size and boundary percentages. */
function appendClusters(lines: string[], clusters: ClusterSummary[]): void {
  if (clusters.length === 0) {
    return;
  }
  lines.push("", "## Clusters — label · symbol share · internal calls");
  for (const cluster of clusters) {
    const codeShare = cluster.codeShare === null ? "—" : formatPercent(cluster.codeShare);
    const internalCalls =
      cluster.internalCallShare === null ? "—" : formatPercent(cluster.internalCallShare);
    lines.push(`- ${cluster.label} · ${codeShare} · ${internalCalls}`);
    const detail = cluster.description ?? cluster.topNodes.join(", ");
    if (detail) {
      lines.push(`  └─ ${detail}`);
    }
  }
}

/** Formats a ratio as a compact human percentage. */
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
