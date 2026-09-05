/** Builds canonical current-tree graph payloads and relationship helpers. */
import { DETAILED_ANALYSIS_FILE_LIMIT } from "../../common.js";
import type { ScanPayload } from "../extraction/index.js";
import { type ImportMapPayload, runImportMap, runScan, runStructure } from "../extraction/index.js";
import { buildNodesAndEdges, fileNode } from "./builder.js";
import type { GraphEdge, GraphNode, GraphPayload, GraphStats } from "./schema.js";

/** Summarizes canonical graph size, languages, categories, and edge types. */
export function graphStats(nodes: GraphNode[], edges: GraphEdge[], scan: ScanPayload): GraphStats {
  return {
    files: scan.files.length,
    nodes: nodes.length,
    edges: edges.length,
    nodeTypes: countBy(nodes, (node) => String(node.type ?? "unknown")),
    edgeTypes: countBy(edges, (edge) => String(edge.type ?? "unknown")),
    languages: scan.stats.byLanguage,
    categories: scan.stats.byCategory,
  };
}

/** Returns graph edges touching a node id. */
export function relatedEdges(
  graph: GraphPayload,
  nodeId: string,
  edgeType: string | null = null,
): GraphEdge[] {
  let edges = graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
  if (edgeType) {
    edges = edges.filter((edge) => edge.type === edgeType);
  }
  return edges;
}

/** Builds the graph payload directly from the current project tree. */
export function currentTreeGraph(
  root: string,
  {
    emitPaths = null,
    scan = runScan(root),
  }: { emitPaths?: Set<string> | null; scan?: ScanPayload } = {},
): GraphPayload {
  const importResult = runImportMap(root, scan.files);
  return buildCurrentTreeGraph(root, scan, importResult, { emitPaths });
}

/** Builds summary graph evidence, using path-ranked inventory above the detailed-analysis limit. */
export function currentTreeSummaryGraph(
  root: string,
  scan: ReturnType<typeof runScan> = runScan(root),
): GraphPayload {
  if (scan.files.length <= DETAILED_ANALYSIS_FILE_LIMIT) {
    return currentTreeGraph(root, { scan });
  }
  const nodes = scan.files.map((entry) => fileNode(entry.path, entry, null, []));
  return {
    stats: {
      files: scan.files.length,
      nodes: nodes.length,
      edges: 0,
      nodeTypes: countBy(nodes, (node) => node.type),
      edgeTypes: {},
      languages: scan.stats.byLanguage,
      categories: scan.stats.byCategory,
    },
    nodes,
    edges: [],
    evidence: {
      importMap: {
        mode: "lightweight-summary",
        reason: `skipped detailed graph above ${DETAILED_ANALYSIS_FILE_LIMIT} files`,
      },
    },
  };
}

/** Builds selected structure from one import snapshot, keeping extraction sequencing inside the graph owner. */
export function buildCurrentTreeGraph(
  root: string,
  scan: ScanPayload,
  importResult: ImportMapPayload,
  { emitPaths = null }: { emitPaths?: Set<string> | null } = {},
): GraphPayload {
  const importMap = importResult.importMap;
  const files =
    emitPaths === null ? scan.files : scan.files.filter((item) => emitPaths.has(item.path));
  const structure = runStructure(root, files, {
    fileMetricsByPath: importResult.fileMetrics,
    pythonSourcesByPath: importResult.pythonSources,
  });
  const [nodes, edges] = buildNodesAndEdges(scan, structure, importMap, {
    emitPaths,
  });
  return {
    stats: graphStats(nodes, edges, scan),
    nodes,
    edges,
    evidence: { importMap: importResult.stats },
  };
}

/** Counts rows by a derived key. */
function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
