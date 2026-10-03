/** Builds and formats current-tree source inspection profiles. */
import path from "node:path";

import { DETAILED_ANALYSIS_FILE_LIMIT } from "../common.js";
import { docstringForSymbol } from "../source/docstrings/index.js";
import { runScan } from "../source/extraction/index.js";
import {
  buildLikelyEntries,
  buildPathRankedLikelyEntries,
  edgeRelationshipLabel,
  type GraphEdge,
  type GraphNode,
  type GraphPayload,
  inventoryFileNodes,
  type LikelyEntry,
  relatedEdges,
} from "../source/graph/index.js";
import { currentTreeInspectGraph, type InspectMetrics } from "./graph.js";
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

/** Runs the current-tree inspect workflow without command-specific fallback text. */
export function renderCurrentTreeInspection(
  root: string,
  target: string,
  { limit }: { limit: number },
): string | null {
  const scan = runScan(root);
  const pathTargetKind = inspectPathTargetKind(root, target);
  if (pathTargetKind !== null && scan.length > DETAILED_ANALYSIS_FILE_LIMIT) {
    const inspection =
      pathTargetKind === "directory"
        ? renderLightweightDirectoryInspection(root, target, scan, { limit })
        : renderLightweightFileInspection(root, target, scan, {
            limit,
            likelyEntries: likelyEntriesByFile(
              buildPathRankedLikelyEntries(inventoryFileNodes(scan)),
            ),
          });
    if (inspection !== null) {
      return inspection;
    }
  }
  const [graph, metrics] = currentTreeInspectGraph(root, target, scan);
  return renderInspection(root, graph, metrics, target, {
    limit,
    likelyEntries: likelyEntriesByFile(buildLikelyEntries(graph.nodes, graph.edges)),
  });
}

/** Keys likely-entry rows by their source file path. */
function likelyEntriesByFile(entries: LikelyEntry[]): Map<string, LikelyEntry> {
  return new Map(entries.map((entry) => [entry.title, entry]));
}

/** Renders the opposite endpoint and direction for a graph edge. */
function edgeEndpoint(edge: GraphEdge, nodeId: string, nodesById: Map<string, GraphNode>): string {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  const other = nodesById.get(otherId);
  const label = other ? nodeLabel(other) : otherId;
  return `${edgeRelationshipLabel(edge, nodeId)}: ${label}`;
}

/** Appends related import and symbol sections to inspection output. */
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

/** Renders an inspection profile with related graph context. */
function renderInspection(
  root: string,
  graph: GraphPayload,
  metrics: InspectMetrics,
  rawTarget: string,
  { limit, likelyEntries }: { limit: number; likelyEntries: Map<string, LikelyEntry> },
): string | null {
  const target = normalizeTarget(root, rawTarget);
  const directoryProfile = renderDirectoryProfile(root, graph, metrics, target, {
    limit,
  });
  if (directoryProfile !== null) {
    return directoryProfile;
  }

  const candidates = inspectCandidates(graph.nodes, target);
  const node = candidates[0];
  if (node === undefined) {
    return renderVariableProfile(target, metrics, { limit });
  }
  const nodesById = new Map(graph.nodes.map((item) => [item.id, item]));
  const relPath = node.filePath;
  const lines = [`# ${nodeLabel(node)}`, "", node.summary.trim()];

  appendLikelyEntryContext(lines, likelyEntries.get(relPath));
  appendSymbolProfile(lines, node);
  appendDocstringSection(lines, root, node);
  appendRelatedSections(lines, graph, node, nodesById, { limit });
  if (relPath) {
    appendFileProfile(lines, metrics, relPath, {
      limit,
      includeFunctions: node.type !== "function",
    });
  }

  if (["function", "class", "variable"].includes(node.type)) {
    appendListSection(lines, "Other Matches", candidates.slice(1).map(nodeLabel), limit - 1);
  }
  return lines.join("\n").trim();
}

/** Appends the target symbol's source docstring or declaration comment. */
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

/** Finds a docstring report entry matching one inspected graph node. */
function docstringForNode(root: string, node: GraphNode): string | null {
  const relPath = node.filePath;
  if (!relPath || (node.type !== "class" && node.type !== "function")) {
    return null;
  }
  return docstringForSymbol(path.join(root, relPath), {
    displayPath: relPath,
    kind: node.type,
    name: node.name,
    line: Number(node.lineRange?.[0] ?? 0),
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
