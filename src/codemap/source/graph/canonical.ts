/** Builds canonical current-tree graph payloads and relationship helpers. */
import {
  type ImportMapPayload,
  runImportMap,
  runScan,
  type ScanEntry,
  structureForFile,
} from "../extraction/index.js";
import { buildNodesAndEdges, fileNode } from "./builder.js";
import type { GraphEdge, GraphNode, GraphPayload } from "./schema.js";

/** Returns graph edges touching a node id. */
export function relatedEdges(graph: GraphPayload, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

/** Names a relationship from the inspected endpoint while preserving directional import, call, and containment labels. */
export function edgeRelationshipLabel(edge: GraphEdge, nodeId: string): string {
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

/** Builds the graph payload directly from the current project tree. */
export function currentTreeGraph(root: string): GraphPayload {
  const scan = runScan(root);
  return buildCurrentTreeGraph(root, scan, runImportMap(root, scan));
}

/** Projects inventory rows to file nodes for path-ranked entry evidence when detailed graphing is skipped. */
export function inventoryFileNodes(scan: ScanEntry[]): GraphNode[] {
  return scan.map((entry) => fileNode(entry.path, entry, null, []));
}

/** Builds selected structure from one import snapshot, keeping extraction sequencing inside the graph owner. */
export function buildCurrentTreeGraph(
  root: string,
  scan: ScanEntry[],
  importResult: ImportMapPayload,
  { emitPaths = null }: { emitPaths?: Set<string> | null } = {},
): GraphPayload {
  const files = emitPaths === null ? scan : scan.filter((item) => emitPaths.has(item.path));
  const structures = files.map((entry) =>
    structureForFile(root, entry, { metricsByPath: importResult.fileMetrics }),
  );
  const [nodes, edges] = buildNodesAndEdges(scan, structures, importResult.importMap);
  return { nodes, edges };
}
