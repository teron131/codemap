/** Converts graph nodes and relationships into semantic search cards. */
import type {
	GraphEdge,
	GraphNode,
	GraphPayload,
} from "../../source/graph/index.js";

export type SemanticCard = {
	id: string;
	kind: string;
	title: string;
	text: string;
	filePath: string;
	lineRange: Array<number | null>;
};

/** Builds semantic cards from graph nodes and relationships. */
export function semanticCardsFromGraph(
	graph: GraphPayload,
	{ maxRelationships = 8 }: { maxRelationships?: number } = {},
): SemanticCard[] {
	const nodes = graph.nodes ?? [];
	const nodesById = new Map(nodes.map((node) => [String(node.id ?? ""), node]));
	const relationships = relationshipsByNode(graph.edges ?? [], nodesById, {
		maxRelationships,
	});
	return nodes.map((node) =>
		cardFromNode(node, relationships.get(String(node.id ?? "")) ?? []),
	);
}

/** Groups semantic-card relationship text by graph node id. */
export function relationshipsByNode(
	edges: GraphEdge[],
	nodesById: Map<string, GraphNode>,
	{ maxRelationships }: { maxRelationships: number },
): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	for (const edge of edges) {
		const sourceId = String(edge.source ?? "");
		const targetId = String(edge.target ?? "");
		const edgeType = String(edge.type ?? "");
		const sourceLabel = nodeTitle(nodesById.get(sourceId) ?? {});
		const targetLabel = nodeTitle(nodesById.get(targetId) ?? {});
		appendRelationship(grouped, sourceId, `out ${edgeType}: ${targetLabel}`);
		appendRelationship(grouped, targetId, `in ${edgeType}: ${sourceLabel}`);
	}
	return new Map(
		[...grouped.entries()].map(([nodeId, items]) => [
			nodeId,
			items.slice(0, maxRelationships),
		]),
	);
}

/** Builds a semantic card from one graph node and relationship text. */
export function cardFromNode(
	node: GraphNode,
	relationships: string[],
): SemanticCard {
	const nodeId = String(node.id ?? "");
	const kind = String(node.type ?? "unknown");
	const title = nodeTitle(node);
	const filePath = String(node.filePath ?? "");
	const lineRange = normalizedLineRange(node.lineRange);
	const parts = [
		`kind: ${kind}`,
		`id: ${nodeId}`,
		`title: ${title}`,
		`file: ${filePath}`,
		`summary: ${String(node.summary ?? "")}`,
		`tags: ${(node.tags ?? []).map((tag) => String(tag)).join(", ")}`,
		`complexity: ${String(node.complexity ?? "")}`,
	];
	const metrics = node.metrics ?? {};
	if (Object.keys(metrics).length > 0) {
		parts.push(
			`metrics: ${Object.entries(metrics)
				.sort(([left], [right]) => compareText(left, right))
				.map(([key, value]) => `${key}=${String(value)}`)
				.join(", ")}`,
		);
	}
	if (lineRange.length > 0) {
		parts.push(
			`lines: ${pythonString(lineRange[0])}-${pythonString(lineRange[1])}`,
		);
	}
	if (relationships.length > 0) {
		parts.push(
			`relationships:\n${relationships.map((item) => `- ${item}`).join("\n")}`,
		);
	}
	return {
		id: nodeId,
		kind,
		title,
		text: parts.filter((part) => part.trim()).join("\n"),
		filePath,
		lineRange,
	};
}

/** Formats a graph node title for semantic cards. */
export function nodeTitle(
	node: Partial<GraphNode> | Record<string, unknown>,
): string {
	const filePath = String(node.filePath ?? "");
	const name = String(node.name ?? "");
	if (["function", "class"].includes(String(node.type ?? "")) && name) {
		return `${name} in ${filePath}`;
	}
	return filePath || name || String(node.id ?? "");
}

/** Normalizes unknown line range payloads into number pairs. */
export function normalizedLineRange(value: unknown): Array<number | null> {
	if (!Array.isArray(value) || value.length < 2) {
		return [];
	}
	return [asIntOrNull(value[0]), asIntOrNull(value[1])];
}

/** Parses optional numeric card metadata without inventing defaults. */
export function asIntOrNull(value: unknown): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	const parsed = Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? null : parsed;
}

/** Adds graph relationship text to a semantic card when nodes connect. */
function appendRelationship(
	grouped: Map<string, string[]>,
	nodeId: string,
	relationship: string,
): void {
	grouped.set(nodeId, [...(grouped.get(nodeId) ?? []), relationship]);
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

/** Formats values as Python-style strings for semantic card text. */
function pythonString(value: unknown): string {
	return value === null || value === undefined ? "None" : String(value);
}
