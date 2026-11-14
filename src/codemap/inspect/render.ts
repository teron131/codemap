/** Working-tree `inspect` profiles from the local graph, or path-only ones above the detailed-analysis limit. */
import path from "node:path";

import { docstringForSymbol } from "../source/docstrings/index.js";
import {
  backendOnlyCoverageLine,
  backendOnlyLanguages,
  buildInventory,
} from "../source/extraction/index.js";
import {
  DETAILED_ANALYSIS_FILE_LIMIT,
  edgeRelationshipLabel,
  type GraphEdge,
  type GraphNode,
  type GraphPayload,
  inventoryFileNodes,
  relatedEdges,
} from "../source/graph/index.js";
import type { FileMetrics } from "../source/scanner/index.js";
import { type InspectMetrics, workingTreeInspectGraph } from "./graph.js";
import {
  buildLikelyEntries,
  buildPathRankedLikelyEntries,
  type LikelyEntry,
} from "./likely-entries.js";
import {
  appendFileProfile,
  appendLikelyEntryContext,
  appendListSection,
  appendSymbolProfile,
  renderDirectoryProfile,
  renderLightweightDirectoryInspection,
  renderLightweightFileInspection,
  renderVariableProfile,
} from "./profiles.js";
import { inspectCandidates, inspectPathTargetKind, nodeLabel, normalizeTarget } from "./targets.js";

/** Null when the target matches nothing, leaving the no-match message to the command. `backendFiles` carry Codebase Memory definitions for files the scanner cannot parse; above the detailed-analysis limit they are not used. */
export function renderWorkingTreeInspection(
  root: string,
  rawTarget: string,
  { limit, backendFiles }: { limit: number; backendFiles: FileMetrics[] },
): string | null {
  const target = normalizeTarget(root, rawTarget);
  const discovered = buildInventory(root);
  const discoveredPaths = new Set(discovered.map((entry) => entry.path));
  // A file Codebase Memory describes is inspectable even when discovery does not list its suffix.
  const inventory = [
    ...discovered,
    ...buildInventory(
      root,
      backendFiles.filter((file) => !discoveredPaths.has(file.relPath)).map((file) => file.path),
    ),
  ];
  const pathTargetKind = inspectPathTargetKind(root, target);
  if (pathTargetKind !== null && inventory.length > DETAILED_ANALYSIS_FILE_LIMIT) {
    const inspection =
      pathTargetKind === "directory"
        ? renderLightweightDirectoryInspection(target, inventory, { limit })
        : renderLightweightFileInspection(root, target, inventory, {
            limit,
            likelyEntries: likelyEntriesByFile(
              buildPathRankedLikelyEntries(inventoryFileNodes(inventory)),
            ),
          });
    if (inspection !== null) {
      return inspection;
    }
  }
  const [graph, metrics, fileMetricsByPath] = workingTreeInspectGraph(
    root,
    target,
    inventory,
    backendFiles,
  );
  return renderInspection(root, graph, metrics, target, {
    limit,
    likelyEntries: likelyEntriesByFile(buildLikelyEntries(graph.nodes, graph.edges)),
    fileMetricsByPath,
    backendOnlyPaths: backendFiles.map((file) => file.relPath),
  });
}

/** Keys likely-entry rows by their source file path. */
function likelyEntriesByFile(entries: LikelyEntry[]): Map<string, LikelyEntry> {
  return new Map(entries.map((entry) => [entry.file, entry]));
}

function edgeEndpoint(edge: GraphEdge, nodeId: string, nodesById: Map<string, GraphNode>): string {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  const other = nodesById.get(otherId);
  const label = other ? nodeLabel(other) : otherId;
  return `${edgeRelationshipLabel(edge, nodeId)}: ${label}`;
}

function appendRelatedSections(
  lines: string[],
  graph: GraphPayload,
  node: GraphNode,
  nodesById: Map<string, GraphNode>,
  { limit }: { limit: number },
): void {
  const importEdges: GraphEdge[] = [];
  const containedNodes: GraphNode[] = [];
  const callEdges: GraphEdge[] = [];
  for (const edge of relatedEdges(graph, node.id)) {
    if (edge.type === "imports") {
      importEdges.push(edge);
    } else if (edge.type === "contains" && edge.source === node.id) {
      const child = nodesById.get(edge.target);
      if (child !== undefined) {
        containedNodes.push(child);
      }
    } else if (edge.type === "calls") {
      callEdges.push(edge);
    }
  }
  appendListSection(
    lines,
    "Imports",
    importEdges.map((edge) => edgeEndpoint(edge, node.id, nodesById)),
    limit,
  );
  if (node.type === "file") {
    appendListSection(
      lines,
      "Classes In File",
      containedNodes.filter((child) => child.type === "class").map(nodeLabel),
      limit,
    );
    appendListSection(
      lines,
      "Contains",
      containedNodes.filter((child) => child.type !== "class").map(nodeLabel),
      limit,
    );
  } else {
    appendListSection(lines, "Contains", containedNodes.map(nodeLabel), limit);
  }
  appendListSection(
    lines,
    "Calls",
    callEdges.map((edge) => edgeEndpoint(edge, node.id, nodesById)),
    limit,
  );
}

function renderInspection(
  root: string,
  graph: GraphPayload,
  metrics: InspectMetrics,
  target: string,
  {
    limit,
    likelyEntries,
    fileMetricsByPath,
    backendOnlyPaths,
  }: {
    limit: number;
    likelyEntries: Map<string, LikelyEntry>;
    fileMetricsByPath: Record<string, FileMetrics | undefined>;
    backendOnlyPaths: string[];
  },
): string | null {
  const directoryProfile = renderDirectoryProfile(root, graph, metrics, target, {
    limit,
  });
  if (directoryProfile !== null) {
    return directoryProfile;
  }

  const candidates = inspectCandidates(graph.nodes, target, fileMetricsByPath);
  const node = candidates[0];
  if (node === undefined) {
    return renderVariableProfile(target, metrics, { limit });
  }
  const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
  const relPath = node.filePath;
  const lines = [`# ${nodeLabel(node)}`, "", node.summary.trim()];
  if (backendOnlyPaths.includes(relPath)) {
    lines.push(backendOnlyCoverageLine(backendOnlyLanguages([relPath])));
  }

  appendLikelyEntryContext(lines, likelyEntries.get(relPath));
  appendSymbolProfile(lines, node);
  appendDocstringSection(lines, root, node);
  appendRelatedSections(lines, graph, node, nodesById, { limit });
  if (relPath) {
    appendFileProfile(lines, metrics, relPath, {
      limit,
      // The whole-file inventory would dominate function answers in large files; file inspection still shows it.
      includeFunctions: node.type !== "function",
    });
  }

  if (["function", "class", "variable"].includes(node.type)) {
    appendListSection(lines, "Other Matches", candidates.slice(1).map(nodeLabel), limit - 1);
  }
  return lines.join("\n").trim();
}

function appendDocstringSection(lines: string[], root: string, node: GraphNode): void {
  const docstring = docstringForNode(root, node);
  if (docstring === null) {
    return;
  }
  lines.push("");
  lines.push("## Docstring");
  for (const line of compactDocstringLines(docstring)) {
    lines.push(line);
  }
}

function docstringForNode(root: string, node: GraphNode): string | null {
  const relPath = node.filePath;
  if (!relPath || (node.type !== "class" && node.type !== "function")) {
    return null;
  }
  return docstringForSymbol(path.join(root, relPath), {
    displayPath: relPath,
    kind: node.type,
    name: node.name,
    line: node.lineRange?.[0] ?? 0,
  });
}

/** Keeps inspected docstrings compact and closes example fences before subsequent profile sections. */
function compactDocstringLines(docstring: string): string[] {
  const lines = docstring
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const shown = lines.slice(0, 8);
  if (lines.length > shown.length) {
    shown.push("...");
  }
  let openFence: string | null = null;
  for (const line of shown) {
    const marker = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker === null) {
      continue;
    }
    const fence = marker[1] ?? "";
    if (openFence === null) {
      openFence = fence;
    } else if (
      fence[0] === openFence[0] &&
      fence.length >= openFence.length &&
      !marker[2]?.trim()
    ) {
      openFence = null;
    }
  }
  if (openFence !== null) {
    shown.push(openFence);
  }
  return shown;
}
