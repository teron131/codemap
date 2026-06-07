/** Searches derived graph relationship context for matching text. */
import {
	type GraphNode,
	type GraphPayload,
	relatedEdges,
} from "../source/graph/index.js";

/** Finds graph nodes and relationships matching search text. */
export function graphMatches(
	graph: GraphPayload,
	searchText: string,
	limit: number,
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
	return scored.slice(0, limit).map(([, node]) => node);
}

/** Renders graph match lines output for search graph. */
export function renderGraphMatchLines(
	graph: GraphPayload,
	searchText: string,
	limit: number,
): string[] {
	const lines = ["", "Relationship matches:"];
	const matches = graphMatches(graph, searchText, limit);
	if (matches.length === 0) {
		lines.push("  none");
		return lines;
	}
	for (const node of matches) {
		lines.push(`  - ${node.id} :: ${node.summary ?? ""}`);
		const hops = relatedEdges(graph, String(node.id)).slice(0, 5);
		for (const edge of hops) {
			lines.push(`      ${edge.source} --${edge.type}--> ${edge.target}`);
		}
	}
	return lines;
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
