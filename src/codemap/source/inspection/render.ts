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

export type LikelyEntryContext = {
	role?: unknown;
	reason?: unknown;
	description?: unknown;
};

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
			containsEdges.filter(
				(edge) => nodesById[String(edge.target)]?.type !== "class",
			),
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
	const lines = [`# ${nodeLabel(node)}`, "", String(node.summary ?? "").trim()];

	appendLikelyEntryContext(lines, likelyEntries[relPath]);
	appendSymbolProfile(lines, node);
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

/** Appends likely-entry navigation context for inspected files. */
export function appendLikelyEntryContext(
	lines: string[],
	context: LikelyEntryContext | undefined,
): void {
	if (context === undefined) {
		return;
	}
	const role = String(context.role ?? "").trim();
	const reason = String(context.reason ?? "").trim();
	const description = String(context.description ?? "").trim();
	if (!role && !reason && !description) {
		return;
	}
	lines.push("");
	lines.push("## Navigation Context");
	if (role) {
		lines.push(`- role: ${role}`);
	}
	if (reason) {
		lines.push(`- why: ${reason}`);
	}
	if (description) {
		lines.push(`- evidence: ${description}`);
	}
}

/** Marks list sections that were shortened by the display limit. */
function appendLimitMarker(
	lines: string[],
	total: number,
	shown: number,
): void {
	if (total > shown) {
		lines.push("- ...");
	}
}
