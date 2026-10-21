/** Current-tree fallback for `search --graph`, scoring local graph nodes under the backend lane's filters. */
import {
  edgeRelationshipLabel,
  type GraphEdge,
  type GraphNode,
  type GraphPayload,
} from "../source/graph/index.js";
import { isTestPath } from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";
import { matchesGlobFilter, matchesTextFilter } from "./filters.js";

export type GraphMatchOptions = {
  includeTests?: boolean;
  label?: string;
  namePattern?: string;
  qnPattern?: string;
  filePattern?: string;
  relationship?: string;
  minDegree?: number;
  maxDegree?: number;
  excludeEntryPoints?: boolean;
  offset?: number;
};

type GraphSearchIndex = {
  edgesByNode: Map<string, GraphEdge[]>;
  nodesById: Map<string, GraphNode>;
};

/** A whole-query substring outranks term matches, and terms count more in a node's own fields than in its first 20 edges. */
function graphMatches(
  graph: GraphPayload,
  searchText: string,
  limit: number,
  options: GraphMatchOptions,
  index: GraphSearchIndex,
): GraphNode[] {
  const loweredSearch = searchText.toLowerCase();
  const cleanedSearch = [...searchText]
    .map((character) => (/[A-Za-z0-9]/.test(character) ? character.toLowerCase() : " "))
    .join("");
  const terms = cleanedSearch.split(/\s+/).filter((term) => term.length > 1);
  const scored: Array<[number, GraphNode]> = [];
  for (const node of graph.nodes) {
    const nodeId = node.id;
    const related = index.edgesByNode.get(nodeId) ?? [];
    if (!graphNodeMatchesFilters(node, related, options)) {
      continue;
    }
    const nodeHaystack = [
      nodeId,
      String(node.name ?? ""),
      String(node.filePath ?? ""),
      String(node.summary ?? ""),
      (node.tags ?? []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    const edgeHaystack = related.slice(0, 20).map(graphEdgeText).join(" ").toLowerCase();
    const haystack = `${nodeHaystack} ${edgeHaystack}`;
    if (haystack.includes(loweredSearch)) {
      scored.push([100 + loweredSearch.length, node]);
      continue;
    }
    if (terms.length > 0 && terms.every((term) => haystack.includes(term))) {
      const nodeHits = terms.filter((term) => nodeHaystack.includes(term)).length;
      const edgeHits = terms.filter((term) => edgeHaystack.includes(term)).length;
      scored.push([nodeHits * 20 + edgeHits * 5, node]);
    }
  }
  scored.sort(
    (left, right) =>
      right[0] - left[0] ||
      compareText(String(left[1].filePath ?? ""), String(right[1].filePath ?? "")) ||
      compareText(String(left[1].id ?? ""), String(right[1].id ?? "")),
  );
  const offset = Math.max(0, options.offset ?? 0);
  return scored.slice(offset, offset + limit).map(([, node]) => node);
}

export function renderGraphMatchLines(
  graph: GraphPayload,
  searchText: string,
  limit: number,
  options: GraphMatchOptions = {},
): string[] {
  const lines = ["", "Relationship matches:"];
  const index = buildGraphSearchIndex(graph);
  const matches = graphMatches(graph, searchText, limit, options, index);
  if (matches.length === 0) {
    lines.push("  none");
    return lines;
  }
  for (const node of matches) {
    const label = graphNodeLabel(node);
    lines.push(`  - ${label}: ${graphNodeSummary(node, label)}`);
    const hops = (index.edgesByNode.get(node.id) ?? []).slice(0, 5);
    for (const edge of hops) {
      lines.push(`      ${graphEdgeLabel(edge, node, index.nodesById)}`);
    }
  }
  return lines;
}

function graphNodeMatchesFilters(
  node: GraphNode,
  related: GraphEdge[],
  options: GraphMatchOptions,
): boolean {
  const degree = related.length;
  return (
    (options.includeTests === true || !isTestPath(String(node.filePath ?? ""))) &&
    graphNodeMatchesLabel(node, options.label) &&
    matchesTextFilter(String(node.name ?? ""), options.namePattern) &&
    matchesTextFilter(graphNodeQualifiedName(node), options.qnPattern) &&
    matchesGlobFilter(String(node.filePath ?? ""), options.filePattern) &&
    (options.relationship === undefined ||
      related.some((edge) => edge.type === options.relationship)) &&
    (options.minDegree === undefined || degree >= options.minDegree) &&
    (options.maxDegree === undefined || degree <= options.maxDegree) &&
    (options.excludeEntryPoints !== true || !node.tags.some((tag) => tag.startsWith("entry-")))
  );
}

/** Checks Codebase Memory-style label names against local graph node types. */
function graphNodeMatchesLabel(node: GraphNode, label: string | undefined): boolean {
  if (label === undefined) {
    return true;
  }
  const normalizedLabel = label.toLowerCase();
  const type = String(node.type ?? "").toLowerCase();
  return normalizedLabel === type;
}

/** Local stand-in for backend qualified names, such as `src/app.ts:run`, so `--qn-pattern` still filters. */
function graphNodeQualifiedName(node: GraphNode): string {
  return [node.filePath, node.name].filter(Boolean).join(":");
}

function graphNodeSummary(node: GraphNode, label: string): string {
  const summary = String(node.summary ?? "");
  const duplicatePrefix = `${label}: `;
  return summary.startsWith(duplicatePrefix) ? summary.slice(duplicatePrefix.length) : summary;
}

function graphNodeLabel(node: GraphNode): string {
  const name = String(node.name ?? "");
  const filePath = String(node.filePath ?? "");
  const nodeType = String(node.type ?? "");
  if (["function", "class"].includes(nodeType) && name && filePath) {
    return `${name} in ${filePath}`;
  }
  return filePath || name || String(node.id ?? "");
}

function graphEdgeLabel(
  edge: GraphEdge,
  node: GraphNode,
  nodesById: Map<string, GraphNode>,
): string {
  const nodeId = String(node.id ?? "");
  const otherId = String(edge.source === nodeId ? edge.target : edge.source);
  const otherNode = nodesById.get(otherId);
  const otherLabel = otherNode ? graphNodeLabel(otherNode) : otherId;
  return `${edgeRelationshipLabel(edge, nodeId)}: ${otherLabel}`;
}

function buildGraphSearchIndex(graph: GraphPayload): GraphSearchIndex {
  const edgesByNode = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    for (const nodeId of new Set([edge.source, edge.target])) {
      const related = edgesByNode.get(nodeId);
      if (related === undefined) {
        edgesByNode.set(nodeId, [edge]);
      } else {
        related.push(edge);
      }
    }
  }
  return {
    edgesByNode,
    nodesById: new Map(graph.nodes.map((node) => [node.id, node])),
  };
}

function graphEdgeText(edge: GraphEdge): string {
  return `${String(edge.source ?? "")} ${String(edge.type ?? "")} ${String(edge.target ?? "")}`;
}
