/** Renders rough CodebaseMemory MCP output for Codemap commands. */
import {
	arrayValue,
	callCodebaseMemoryTool,
	codebaseMemoryReadyProject,
	recordValue,
} from "./client.js";

/** Tries to print graph-augmented CodebaseMemory source search results. */
export function tryPrintCodebaseMemorySearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const result = callCodebaseMemoryTool("search_code", {
		project: project.name,
		pattern: searchText,
		limit,
		context: 1,
	});
	if (!result.ok) {
		return false;
	}
	if (!hasCodebaseMemorySearchAnswer(result.value)) {
		return false;
	}
	console.log("\nCodebaseMemory code matches:");
	printJsonSummary(result.value);
	return true;
}

/** Tries to print CodebaseMemory graph search results for relationship-oriented search. */
export function tryPrintCodebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const result = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: searchText,
		limit,
		include_connected: true,
	});
	if (!result.ok) {
		return false;
	}
	if (!hasCodebaseMemoryGraphAnswer(result.value)) {
		return false;
	}
	console.log("\nCodebaseMemory graph matches:");
	printJsonSummary(result.value);
	return true;
}

/** Tries to print CodebaseMemory semantic graph matches for semantic search. */
export function tryPrintCodebaseMemorySemanticSearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const result = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: searchText,
		semantic_query: semanticTerms(searchText),
		limit,
		include_connected: true,
	});
	if (!result.ok) {
		return false;
	}
	if (!hasCodebaseMemoryGraphAnswer(result.value)) {
		return false;
	}
	console.log("\nCodebaseMemory semantic matches:");
	printJsonSummary(result.value);
	return true;
}

/** Tries to print a CodebaseMemory snippet for a symbol inspection target. */
export function tryPrintCodebaseMemoryInspect(
	root: string,
	target: string,
	limit: number,
): boolean {
	if (target.includes("/") || target.includes("\\")) {
		return false;
	}
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const searchResult = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: target,
		limit,
		include_connected: true,
	});
	if (!searchResult.ok) {
		return false;
	}
	const qualifiedName = firstQualifiedName(searchResult.value);
	if (qualifiedName === null) {
		return false;
	}
	const snippetResult = callCodebaseMemoryTool("get_code_snippet", {
		project: project.name,
		qualified_name: qualifiedName,
		include_neighbors: true,
	});
	if (!snippetResult.ok) {
		return false;
	}
	console.log(`# ${target}`);
	console.log("");
	console.log("CodebaseMemory snippet:");
	printJsonSummary(snippetResult.value);
	return true;
}

/** Tries to print CodebaseMemory caller/callee traces for search calls. */
export function tryPrintCodebaseMemoryCallTrace(
	root: string,
	name: string,
	{ jsonOutput = false }: { jsonOutput?: boolean } = {},
): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const result = callCodebaseMemoryTool("trace_path", {
		project: project.name,
		function_name: name,
		mode: "calls",
		direction: "both",
		depth: 2,
	});
	if (!result.ok) {
		return false;
	}
	if (!hasCodebaseMemoryTraceAnswer(result.value)) {
		return false;
	}
	if (jsonOutput) {
		console.log(JSON.stringify(result.value, null, 2));
	} else {
		console.log("CodebaseMemory call trace:");
		printJsonSummary(result.value);
	}
	return true;
}

/** Tries to print CodebaseMemory's architecture and cluster summary. */
export function tryPrintCodebaseMemoryArchitectureSummary(
	root: string,
): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const result = callCodebaseMemoryTool("get_architecture", {
		project: project.name,
		aspects: ["all"],
	});
	if (!result.ok) {
		return false;
	}
	console.log("# CodebaseMemory Architecture");
	console.log("");
	printJsonSummary(result.value);
	return true;
}

/** Tries to print CodebaseMemory index status and graph schema. */
export function tryPrintCodebaseMemoryStatus(root: string): boolean {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return false;
	}
	const schemaResult = callCodebaseMemoryTool("get_graph_schema", {
		project: project.name,
	});
	console.log(`CodebaseMemory index: ${project.name}`);
	console.log(`status: ${project.status}`);
	console.log(`nodes: ${project.nodes ?? "unknown"}`);
	console.log(`edges: ${project.edges ?? "unknown"}`);
	console.log(`changed files: ${project.changedCount}`);
	if (schemaResult.ok) {
		const schema = recordValue(schemaResult.value);
		const nodeLabels = arrayValue(schema.node_labels).length;
		const edgeTypes = arrayValue(schema.edge_types).length;
		console.log(`schema: ${nodeLabels} node labels, ${edgeTypes} edge types`);
	}
	return true;
}

/** Prints compact JSON with stable rough formatting. */
function printJsonSummary(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

/** Checks whether a CodebaseMemory search_code payload contains any matches. */
function hasCodebaseMemorySearchAnswer(value: unknown): boolean {
	return hasSearchAnswer(value, ["results", "raw_matches"], ["total_results"]);
}

/** Checks whether a CodebaseMemory search_graph payload contains any matches. */
function hasCodebaseMemoryGraphAnswer(value: unknown): boolean {
	return hasSearchAnswer(
		value,
		["results", "semantic_results", "raw_matches"],
		["total_results", "total"],
	);
}

/** Checks whether a CodebaseMemory trace_path payload contains any traces. */
function hasCodebaseMemoryTraceAnswer(value: unknown): boolean {
	return hasSearchAnswer(
		value,
		["paths", "call_paths", "traces", "results", "callers", "callees"],
		["total_paths", "path_count", "total_results", "total"],
	);
}

/** Checks common CodebaseMemory search payload fields for no-answer responses. */
function hasSearchAnswer(
	value: unknown,
	arrayKeys: string[],
	countKeys: string[],
): boolean {
	const record = recordValue(value);
	const arrays = arrayKeys.map((key) => arrayValue(record[key]));
	if (arrays.some((items) => items.length > 0)) {
		return true;
	}
	const hasKnownEmptyArray = arrayKeys.some((key) =>
		Array.isArray(record[key]),
	);
	const hasZeroCount = countKeys.some((key) => record[key] === 0);
	if (hasKnownEmptyArray || hasZeroCount) {
		return false;
	}
	return true;
}

/** Extracts a likely qualified name from CodebaseMemory search results. */
function firstQualifiedName(value: unknown): string | null {
	const record = recordValue(value);
	for (const key of ["results", "semantic_results"]) {
		for (const item of arrayValue(record[key])) {
			const itemRecord = recordValue(item);
			const qualifiedName = itemRecord.qualified_name;
			if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
				return qualifiedName;
			}
		}
	}
	const nestedResults = arrayValue(record.results)
		.map((item) => recordValue(item).node)
		.map(recordValue);
	for (const item of nestedResults) {
		const qualifiedName = item.qualified_name;
		if (typeof qualifiedName === "string" && qualifiedName.length > 0) {
			return qualifiedName;
		}
	}
	return null;
}

/** Splits user search text into a small CodebaseMemory semantic keyword array. */
function semanticTerms(searchText: string): string[] {
	const terms = searchText
		.split(/\s+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.slice(0, 8);
	return terms.length > 0 ? terms : [searchText];
}
