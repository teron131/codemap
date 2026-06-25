/** Searches derived graph relationship context for matching text. */
import {
	type GraphEdge,
	type GraphNode,
	type GraphPayload,
	relatedEdges,
} from "../source/graph/index.js";
import { isTestPath } from "../source/signals/policy.js";
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

/** Finds graph nodes and relationships matching search text. */
export function graphMatches(
	graph: GraphPayload,
	searchText: string,
	limit: number,
	options: GraphMatchOptions = {},
): GraphNode[] {
	const loweredSearch = searchText.toLowerCase();
	const cleanedSearch = [...searchText]
		.map((character) =>
			/[A-Za-z0-9]/.test(character) ? character.toLowerCase() : " ",
		)
		.join("");
	const terms = cleanedSearch.split(/\s+/).filter((term) => term.length > 1);
	const edgeTextByNode = new Map<string, string[]>();
	for (const edge of graph.edges ?? []) {
		const edgeText = `${String(edge.source ?? "")} ${String(edge.type ?? "")} ${String(edge.target ?? "")}`;
		appendEdgeText(edgeTextByNode, String(edge.source ?? ""), edgeText);
		appendEdgeText(edgeTextByNode, String(edge.target ?? ""), edgeText);
	}

	const scored: Array<[number, GraphNode]> = [];
	for (const node of graph.nodes ?? []) {
		if (!graphNodeMatchesFilters(graph, node, options)) {
			continue;
		}
		const nodeId = String(node.id ?? "");
		const nodeHaystack = [
			nodeId,
			String(node.name ?? ""),
			String(node.filePath ?? ""),
			String(node.summary ?? ""),
			(node.tags ?? []).join(" "),
		]
			.join(" ")
			.toLowerCase();
		const edgeHaystack = (edgeTextByNode.get(nodeId) ?? [])
			.slice(0, 20)
			.join(" ")
			.toLowerCase();
		const haystack = `${nodeHaystack} ${edgeHaystack}`;
		if (haystack.includes(loweredSearch)) {
			scored.push([100 + loweredSearch.length, node]);
			continue;
		}
		if (terms.length > 0 && terms.every((term) => haystack.includes(term))) {
			const nodeHits = terms.filter((term) =>
				nodeHaystack.includes(term),
			).length;
			const edgeHits = terms.filter((term) =>
				edgeHaystack.includes(term),
			).length;
			scored.push([nodeHits * 20 + edgeHits * 5, node]);
		}
	}
	scored.sort(
		(left, right) =>
			right[0] - left[0] ||
			compareText(
				String(left[1].filePath ?? ""),
				String(right[1].filePath ?? ""),
			) ||
			compareText(String(left[1].id ?? ""), String(right[1].id ?? "")),
	);
	const offset = Math.max(0, options.offset ?? 0);
	return scored.slice(offset, offset + limit).map(([, node]) => node);
}

/** Renders graph match lines output for search graph. */
export function renderGraphMatchLines(
	graph: GraphPayload,
	searchText: string,
	limit: number,
	options: GraphMatchOptions = {},
): string[] {
	const lines = ["", "Relationship matches:"];
	const matches = graphMatches(graph, searchText, limit, options);
	if (matches.length === 0) {
		lines.push("  none");
		return lines;
	}
	for (const node of matches) {
		const label = graphNodeLabel(node);
		lines.push(`  - ${label}: ${graphNodeSummary(node, label)}`);
		const hops = relatedEdges(graph, String(node.id)).slice(0, 5);
		for (const edge of hops) {
			lines.push(`      ${graphEdgeLabel(edge, node, graph)}`);
		}
	}
	return lines;
}

/** Checks whether a local graph node satisfies CLI graph filters. */
function graphNodeMatchesFilters(
	graph: GraphPayload,
	node: GraphNode,
	options: GraphMatchOptions,
): boolean {
	const degree = graphNodeDegree(graph, node);
	return (
		(options.includeTests === true ||
			!isTestPath(String(node.filePath ?? ""))) &&
		graphNodeMatchesLabel(node, options.label) &&
		matchesTextFilter(String(node.name ?? ""), options.namePattern) &&
		matchesTextFilter(graphNodeQualifiedName(node), options.qnPattern) &&
		matchesGlobFilter(String(node.filePath ?? ""), options.filePattern) &&
		graphNodeMatchesRelationship(graph, node, options.relationship) &&
		(options.minDegree === undefined || degree >= options.minDegree) &&
		(options.maxDegree === undefined || degree <= options.maxDegree) &&
		(options.excludeEntryPoints !== true ||
			!node.tags.some((tag) => tag.startsWith("entry-")))
	);
}

/** Checks Codebase Memory-style label names against local graph node types. */
function graphNodeMatchesLabel(
	node: GraphNode,
	label: string | undefined,
): boolean {
	if (label === undefined) {
		return true;
	}
	const normalizedLabel = label.toLowerCase();
	const type = String(node.type ?? "").toLowerCase();
	return normalizedLabel === type;
}

/** Builds a simple qualified-name surrogate for local graph fallback filtering. */
function graphNodeQualifiedName(node: GraphNode): string {
	return [node.filePath, node.name].filter(Boolean).join(":");
}

/** Checks whether a graph node has at least one relationship of a requested type. */
function graphNodeMatchesRelationship(
	graph: GraphPayload,
	node: GraphNode,
	relationship: string | undefined,
): boolean {
	if (relationship === undefined) {
		return true;
	}
	return relatedEdges(graph, String(node.id)).some(
		(edge) => edge.type === relationship,
	);
}

/** Counts all local graph edges touching a node. */
function graphNodeDegree(graph: GraphPayload, node: GraphNode): number {
	return relatedEdges(graph, String(node.id)).length;
}

/** Formats one graph node summary without repeating the already printed label. */
function graphNodeSummary(node: GraphNode, label: string): string {
	const summary = String(node.summary ?? "");
	const duplicatePrefix = `${label}: `;
	return summary.startsWith(duplicatePrefix)
		? summary.slice(duplicatePrefix.length)
		: summary;
}

/** Formats one graph node without exposing internal node ids. */
function graphNodeLabel(node: GraphNode): string {
	const name = String(node.name ?? "");
	const filePath = String(node.filePath ?? "");
	const nodeType = String(node.type ?? "");
	if (["function", "class"].includes(nodeType) && name && filePath) {
		return `${name} in ${filePath}`;
	}
	return filePath || name || String(node.id ?? "");
}

/** Formats one related graph edge from the matched node's point of view. */
function graphEdgeLabel(
	edge: GraphEdge,
	node: GraphNode,
	graph: GraphPayload,
): string {
	const nodeId = String(node.id ?? "");
	const otherId = String(edge.source === nodeId ? edge.target : edge.source);
	const otherNode = (graph.nodes ?? []).find(
		(candidate) => candidate.id === otherId,
	);
	const otherLabel = otherNode ? graphNodeLabel(otherNode) : otherId;
	return `${edgeRelationshipLabel(edge, nodeId)}: ${otherLabel}`;
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

/** Attaches printable graph-edge context to a search target node. */
function appendEdgeText(
	edgeTextByNode: Map<string, string[]>,
	nodeId: string,
	edgeText: string,
): void {
	edgeTextByNode.set(nodeId, [...(edgeTextByNode.get(nodeId) ?? []), edgeText]);
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
