/** Owns current-tree graph assembly from supplied scan and import evidence. Inspection and graph search share its edge helpers. */
import {
  type ImportMapPayload,
  runImportMap,
  runScan,
  type ScanEntry,
  structureForFile,
} from "../extraction/index.js";
import { buildNodesAndEdges, fileNode } from "./builder.js";
import type { GraphEdge, GraphNode, GraphPayload } from "./schema.js";

export function relatedEdges(graph: GraphPayload, nodeId: string): GraphEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

/** Labels an edge from `nodeId`'s side, so an `imports` edge reads `imported by` from its target. */
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

/** Scans and resolves imports for the whole tree; callers already holding a scan use `buildCurrentTreeGraph`. */
export function currentTreeGraph(root: string): GraphPayload {
  const scan = runScan(root);
  return buildCurrentTreeGraph(root, scan, runImportMap(root, scan));
}

/** Projects inventory rows to file nodes for path-ranked entry evidence when detailed graphing is skipped. */
export function inventoryFileNodes(scan: ScanEntry[]): GraphNode[] {
  return scan.map((entry) => fileNode(entry.path, entry, null, []));
}

/** `emitPaths` limits which files get nodes, while import edges still point into the whole `scan`. */
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
