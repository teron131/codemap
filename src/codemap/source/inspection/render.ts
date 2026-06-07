/** Formats inspection profiles and related graph context as text. */
import {
	type GraphEdge,
	type GraphNode,
	type GraphPayload,
	relatedEdges,
} from "../graph/index.js";
import {
	appendFileProfile,
	appendSymbolProfile,
	fileMetricsForPath,
	renderDirectoryProfile,
	renderVariableProfile,
} from "./profiles.js";
import { inspectCandidates, nodeLabel, normalizeTarget } from "./targets.js";

type Row = Record<string, unknown>;

/** Renders the opposite endpoint and direction for a graph edge. */
export function edgeEndpoint(
	edge: GraphEdge,
	nodeId: string,
	nodesById: Record<string, GraphNode | undefined>,
): string {
	const otherId = String(edge.source === nodeId ? edge.target : edge.source);
	const other = nodesById[otherId];
	const label = other ? nodeLabel(other) : otherId;
	const direction = edge.source === nodeId ? "out" : "in";
	return `${direction} ${edge.type}: ${label}`;
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
}

/** Appends related import and symbol sections to inspection output. */
export function appendRelatedSections(
	lines: string[],
	graph: GraphPayload,
	nodeId: string,
	nodesById: Record<string, GraphNode | undefined>,
	{ limit }: { limit: number },
): void {
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
	appendContainsSection(lines, containsEdges, nodesById, { limit });
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
	{ limit }: { limit: number },
): string | null {
	const target = normalizeTarget(root, rawTarget);
	const directoryProfile = renderDirectoryProfile(
		root,
		graph,
		metrics,
		target,
		{
			limit,
		},
	);
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
	const lines = [
		`# ${nodeLabel(node)}`,
		"",
		String(node.summary ?? "").trim(),
		`Type: ${String(node.type)} | Complexity: ${String(node.complexity ?? "unknown")}`,
	];
	if (node.metrics) {
		const nodeMetrics = node.metrics as Row;
		lines.push(
			`Lines: ${String(nodeMetrics.lines ?? 0)} | Fan-out: ${String(nodeMetrics.fanOut ?? 0)}`,
		);
	}

	appendSymbolProfile(lines, node);
	appendRelatedSections(lines, graph, nodeId, nodesById, { limit });
	if (relPath) {
		appendFileProfile(lines, fileMetricsForPath(metrics, relPath), { limit });
	}

	if (candidates.length > 1) {
		lines.push("");
		lines.push("## Other Matches");
		for (const item of candidates.slice(1, limit)) {
			lines.push(`- ${nodeLabel(item)}`);
		}
	}
	return lines
		.filter((line) => line !== undefined && line !== null)
		.join("\n")
		.trim();
}
