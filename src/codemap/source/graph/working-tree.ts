/** Owns working-tree graph assembly from supplied inventory and import evidence. Inspection and graph search share its edge helpers. */
import {
  buildInventory,
  type ImportMapPayload,
  type InventoryEntry,
  runImportMap,
} from "../extraction/index.js";
import { buildNodesAndEdges, fileNode } from "./builder.js";
import type { GraphEdge, GraphNode, GraphPayload } from "./schema.js";
import { structureForFile } from "./structure.js";

/** File count above which commands skip the detailed working-tree graph and answer from the inventory alone. */
export const DETAILED_ANALYSIS_FILE_LIMIT = 5_000;

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

/** Scans and resolves imports for the whole tree; callers already holding an inventory use `buildWorkingTreeGraph`. */
export function workingTreeGraph(root: string): GraphPayload {
  const inventory = buildInventory(root);
  return buildWorkingTreeGraph(root, inventory, runImportMap(root, inventory));
}

/** Projects inventory rows to file nodes for path-ranked entry evidence when detailed graphing is skipped. */
export function inventoryFileNodes(inventory: InventoryEntry[]): GraphNode[] {
  return inventory.map((entry) => fileNode(entry.path, entry, null, []));
}

/** `emitPaths` limits which files get nodes, while import edges still point into the whole `inventory`. */
export function buildWorkingTreeGraph(
  root: string,
  inventory: InventoryEntry[],
  importResult: ImportMapPayload,
  { emitPaths = null }: { emitPaths?: Set<string> | null } = {},
): GraphPayload {
  const files =
    emitPaths === null ? inventory : inventory.filter((item) => emitPaths.has(item.path));
  const structures = files.map((entry) =>
    structureForFile(root, entry, { metricsByPath: importResult.fileMetrics }),
  );
  const [nodes, edges] = buildNodesAndEdges(inventory, structures, importResult.importMap);
  return { nodes, edges };
}
