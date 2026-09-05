/** Builds and formats current-tree source inspection profiles. */
import path from "node:path";

import { DETAILED_ANALYSIS_FILE_LIMIT } from "../common.js";
import { recordValue } from "../json-utils.js";
import { docstringForSymbol } from "../source/docstrings/index.js";
import { runScan } from "../source/extraction/index.js";
import {
  currentTreeSummaryGraph,
  type GraphEdge,
  type GraphNode,
  type GraphPayload,
  relatedEdges,
} from "../source/graph/index.js";
import { buildLikelyEntries, buildPathRankedLikelyEntries } from "../source/graph/index.js";
import { currentTreeInspectGraph } from "./graph.js";
import {
  appendFileProfile,
  appendLikelyEntryContext,
  appendSymbolProfile,
  fileMetricsForPath,
  type LikelyEntryContext,
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
  const pathTargetKind = inspectPathTargetKind(root, target);
  let pathTargetScan: ReturnType<typeof runScan> | null = null;
  if (pathTargetKind !== null) {
    const scan = runScan(root);
    pathTargetScan = scan;
    if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
      const likelyEntries = likelyEntryContextByFile(currentTreeSummaryGraph(root, scan));
      const inspection =
        pathTargetKind === "directory"
          ? renderLightweightDirectoryInspection(root, target, scan.files, {
              limit,
            })
          : renderLightweightFileInspection(root, target, scan.files, {
              limit,
              likelyEntries,
            });
      if (inspection !== null) {
        return inspection;
      }
    }
  }
  const [graph, metrics] = currentTreeInspectGraph(root, target, pathTargetScan);
  return renderInspection(root, graph, metrics, target, {
    limit,
    likelyEntries: likelyEntryContextByFile(graph),
  });
}

/** Builds likely-entry context keyed by source file path from graph evidence. */
function likelyEntryContextByFile(graph: GraphPayload): Record<string, LikelyEntryContext> {
  const importMapEvidence = recordValue(graph.evidence.importMap);
  const entries =
    importMapEvidence.mode === "lightweight-summary"
      ? buildPathRankedLikelyEntries(graph.nodes)
      : buildLikelyEntries(graph.nodes, graph.edges);
  const byFile: Record<string, LikelyEntryContext> = {};
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const filePath = String(row.title ?? "");
    if (!filePath) {
      continue;
    }
    byFile[filePath] = {
      role: row.role,
      reason: row.reason,
      description: row.description,
    };
  }
  return byFile;
}

/** Renders the opposite endpoint and direction for a graph edge. */
export function edgeEndpoint(
  edge: GraphEdge,
  nodeId: string,
  nodesById: Record<string, GraphNode | undefined>,
): string {
  const otherId = String(edge.source === nodeId ? edge.target : edge.source);
  const other = nodesById[otherId];
  const label = other ? nodeLabel(other) : otherId;
  return `${edgeRelationshipLabel(edge, nodeId)}: ${label}`;
}

/** Names a graph edge direction in CLI-friendly language. */
function edgeRelationshipLabel(edge: GraphEdge, nodeId: string): string {
  const outgoing = edge.source === nodeId;
  if (edge.type === "imports") {
    return outgoing ? "imports" : "imported by";
  }
  if (edge.type === "calls") {
    return outgoing ? "calls" : "called by";
  }
  if (edge.type === "contains") {
    return outgoing ? "contains" : "in";
  }
  return outgoing ? String(edge.type) : `${String(edge.type)} by`;
}

/** Appends incoming or outgoing graph edges to inspection text. */
export function appendEdgeSection(
  lines: string[],
  title: string,
  edges: GraphEdge[],
  nodeId: string,
  nodesById: Record<string, GraphNode | undefined>,
  { limit }: { limit: number },
): void {
  if (edges.length === 0) {
    return;
  }
  lines.push("");
  lines.push(title);
  for (const edge of edges.slice(0, limit)) {
    lines.push(`- ${edgeEndpoint(edge, nodeId, nodesById)}`);
  }
  appendLimitMarker(lines, edges.length, limit);
}

/** Appends contained child nodes to inspection text. */
export function appendContainsSection(
  lines: string[],
  contains: GraphEdge[],
  nodesById: Record<string, GraphNode | undefined>,
  { limit }: { limit: number },
): void {
  if (contains.length === 0) {
    return;
  }
  lines.push("");
  lines.push("## Contains");
  for (const edge of contains.slice(0, limit)) {
    const child = nodesById[String(edge.target)] ?? {};
    lines.push(`- ${nodeLabel(child)}`);
  }
  appendLimitMarker(lines, contains.length, limit);
}

/** Appends class definitions contained directly by an inspected file node. */
function appendClassesInFileSection(
  lines: string[],
  contains: GraphEdge[],
  nodesById: Record<string, GraphNode | undefined>,
  { limit }: { limit: number },
): void {
  const classes = contains
    .map((edge) => nodesById[String(edge.target)])
    .filter((node): node is GraphNode => node?.type === "class");
  if (classes.length === 0) {
    return;
  }
  lines.push("");
  lines.push("## Classes In File");
  for (const item of classes.slice(0, limit)) {
    lines.push(`- ${nodeLabel(item)}`);
  }
  appendLimitMarker(lines, classes.length, limit);
}

/** Appends related import and symbol sections to inspection output. */
export function appendRelatedSections(
  lines: string[],
  graph: GraphPayload,
  nodeId: string,
  nodesById: Record<string, GraphNode | undefined>,
  { limit }: { limit: number },
): void {
  const node = nodesById[nodeId];
  const importEdges: GraphEdge[] = [];
  const containsEdges: GraphEdge[] = [];
  const callEdges: GraphEdge[] = [];
  for (const edge of relatedEdges(graph, nodeId)) {
    if (edge.type === "imports") {
      importEdges.push(edge);
    } else if (edge.type === "contains" && edge.source === nodeId) {
      containsEdges.push(edge);
    } else if (edge.type === "calls") {
      callEdges.push(edge);
    }
  }
  appendEdgeSection(lines, "## Imports", importEdges, nodeId, nodesById, {
    limit,
  });
  if (node?.type === "file") {
    appendClassesInFileSection(lines, containsEdges, nodesById, { limit });
    appendContainsSection(
      lines,
      containsEdges.filter((edge) => nodesById[String(edge.target)]?.type !== "class"),
      nodesById,
      { limit },
    );
  } else {
    appendContainsSection(lines, containsEdges, nodesById, { limit });
  }
  appendEdgeSection(lines, "## Calls", callEdges, nodeId, nodesById, {
    limit,
  });
}

/** Renders an inspection profile with related graph context. */
export function renderInspection(
  root: string,
  graph: GraphPayload,
  metrics: Record<string, unknown>,
  rawTarget: string,
  {
    limit,
    likelyEntries = {},
  }: { limit: number; likelyEntries?: Record<string, LikelyEntryContext> },
): string | null {
  const target = normalizeTarget(root, rawTarget);
  const directoryProfile = renderDirectoryProfile(root, graph, metrics, target, {
    limit,
  });
  if (directoryProfile !== null) {
    return directoryProfile;
  }

  const candidates = inspectCandidates(graph.nodes ?? [], target);
  if (candidates.length === 0) {
    return renderVariableProfile(target, metrics, { limit });
  }

  const node = candidates[0];
  if (node === undefined) {
    return null;
  }
  const nodeId = String(node.id);
  const nodesById = Object.fromEntries(
    (graph.nodes ?? []).map((item) => [String(item.id), item]),
  ) as Record<string, GraphNode | undefined>;
  const relPath = String(node.filePath ?? "");
  const lines = [`# ${nodeLabel(node)}`, "", String(node.summary ?? "").trim()];

  appendLikelyEntryContext(lines, likelyEntries[relPath]);
  appendSymbolProfile(lines, node);
  appendDocstringSection(lines, root, node);
  appendRelatedSections(lines, graph, nodeId, nodesById, { limit });
  if (relPath) {
    appendFileProfile(lines, fileMetricsForPath(metrics, relPath), { limit });
  }

  if (
    candidates.length > 1 &&
    ["function", "class", "variable"].includes(String(node.type ?? ""))
  ) {
    lines.push("");
    lines.push("## Other Matches");
    for (const item of candidates.slice(1, limit)) {
      lines.push(`- ${nodeLabel(item)}`);
    }
    appendLimitMarker(lines, candidates.length - 1, limit - 1);
  }
  return lines
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .trim();
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
  const relPath = String(node.filePath ?? "");
  const nodeType = String(node.type ?? "");
  if (!relPath || (nodeType !== "class" && nodeType !== "function")) {
    return null;
  }
  return docstringForSymbol(path.join(root, relPath), {
    displayPath: relPath,
    kind: nodeType,
    name: String(node.name ?? ""),
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

/** Marks list sections that were shortened by the display limit. */
function appendLimitMarker(lines: string[], total: number, shown: number): void {
  if (total > shown) {
    lines.push("- ...");
  }
}
