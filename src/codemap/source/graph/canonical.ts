/** Builds canonical current-tree graph payloads and relationship helpers. */
import type { ScanEntry } from "../extraction/index.js";
import {
	type ImportMapPayload,
	runImportMap,
	runScan,
	runStructure,
} from "../extraction/index.js";
import { runSignalsExport } from "../signals/index.js";
import type { StructureEntry } from "./builder.js";
import { buildNodesAndEdges } from "./builder.js";
import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
	GraphStats,
} from "./schema.js";

type ScanPayload = {
	files?: ScanEntry[];
	stats?: {
		byLanguage?: Record<string, number>;
		byCategory?: Record<string, number>;
	};
};

type StructurePayload = {
	results?: StructureEntry[];
};

/** Summarizes canonical graph size, languages, categories, and edge types. */
export function graphStats(
	nodes: GraphNode[],
	edges: GraphEdge[],
	scan: ScanPayload,
): GraphStats {
	return {
		files: scan.files?.length ?? 0,
		nodes: nodes.length,
		edges: edges.length,
		nodeTypes: countBy(nodes, (node) => String(node.type ?? "unknown")),
		edgeTypes: countBy(edges, (edge) => String(edge.type ?? "unknown")),
		languages: scan.stats?.byLanguage ?? {},
		categories: scan.stats?.byCategory ?? {},
	};
}

/** Returns graph edges touching a node id. */
export function relatedEdges(
	graph: GraphPayload,
	nodeId: string,
	edgeType: string | null = null,
): GraphEdge[] {
	let edges = graph.edges.filter(
		(edge) => edge.source === nodeId || edge.target === nodeId,
	);
	if (edgeType) {
		edges = edges.filter((edge) => edge.type === edgeType);
	}
	return edges;
}

/** Builds the graph payload directly from the current project tree. */
export function currentTreeGraph(
	root: string,
	{
		includeSignals = true,
		emitPaths = null,
	}: { includeSignals?: boolean; emitPaths?: Set<string> | null } = {},
): GraphPayload {
	const scan = runScan(root, { persist: false });
	const importResult = runImportMap(root, scan.files, { persist: false });
	const importMap = importResult.importMap;
	let structureFiles = scan.files;
	if (emitPaths !== null) {
		structureFiles = structureFiles.filter((item) => emitPaths.has(item.path));
	}
	const structure = runStructure(root, structureFiles, importMap, {
		label: "current",
		persist: false,
		fileMetricsByPath: importResult._typescriptMetrics,
		pythonTreesByPath: importResult._pythonTrees,
	});
	return buildGraphPayload(root, scan, structure, importResult, {
		includeSignals,
		emitPaths,
	});
}

/** Builds the canonical graph payload from scan, import, and structure data. */
export function buildGraphPayload(
	root: string,
	scan: ScanPayload,
	structure: StructurePayload,
	importResult: Pick<ImportMapPayload, "importMap" | "stats">,
	{
		includeSignals = true,
		emitPaths = null,
	}: { includeSignals?: boolean; emitPaths?: Set<string> | null } = {},
): GraphPayload {
	const importMap = importResult.importMap;
	const [nodes, edges] = buildNodesAndEdges(scan, structure, importMap, {
		emitPaths,
	});
	const evidence: GraphPayload["evidence"] = {
		importMap: importResult.stats,
	};
	if (includeSignals) {
		evidence.codeSignals = runSignalsExport(root);
	}
	return {
		stats: graphStats(nodes, edges, scan),
		nodes,
		edges,
		evidence,
	};
}

/** Counts rows by a derived key. */
function countBy<T>(
	items: T[],
	keyFor: (item: T) => string,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const key = keyFor(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}
