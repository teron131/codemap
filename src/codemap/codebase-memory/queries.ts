/** Provides normalized CodebaseMemory backend query results for CLI rendering. */
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
	arrayValue,
	callCodebaseMemoryTool,
	codebaseMemoryReadyProject,
	recordValue,
} from "./client.js";

export type CodebaseMemoryInspectResult = {
	name: string;
	qualifiedName: string;
	filePath: string | null;
	startLine: number | null;
	endLine: number | null;
	matchRank: number | null;
	matchScore: number | null;
	signalFacts: string[];
	graphFacts: string[];
	signature: string | null;
	source: string | null;
	callers: string[];
	callees: string[];
	related: string[];
	graphNeighbors: string[];
};

export type CodebaseMemoryStatusResult = {
	projectName: string;
	status: string;
	nodes: number | null;
	edges: number | null;
	schemaNodeLabels: number | null;
	schemaEdgeTypes: number | null;
};

export type CodebaseMemoryIndexResult = CodebaseMemoryStatusResult & {
	elapsedMs: number;
};

/** Reads graph-augmented CodebaseMemory source search results when available. */
export function codebaseMemorySearch(
	root: string,
	searchText: string,
	limit: number,
): unknown | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const result = callCodebaseMemoryTool("search_code", {
		project: project.name,
		pattern: searchText,
		limit,
		context: 1,
	});
	if (!result.ok) {
		return null;
	}
	if (
		!hasSearchAnswer(
			result.value,
			["results", "raw_matches"],
			["total_results"],
		)
	) {
		return null;
	}
	return result.value;
}

/** Reads CodebaseMemory graph search results when available. */
export function codebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
): unknown | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const result = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: searchText,
		limit,
		include_connected: true,
	});
	if (!result.ok) {
		return null;
	}
	if (
		!hasSearchAnswer(
			result.value,
			["results", "semantic_results", "raw_matches"],
			["total_results", "total"],
		)
	) {
		return null;
	}
	return result.value;
}

/** Reads CodebaseMemory semantic graph search results when available. */
export function codebaseMemorySemanticSearch(
	root: string,
	searchText: string,
	limit: number,
): unknown | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const result = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: searchText,
		semantic_query: semanticTerms(searchText),
		limit,
		include_connected: true,
	});
	if (!result.ok) {
		return null;
	}
	if (
		!hasSearchAnswer(
			result.value,
			["results", "semantic_results", "raw_matches"],
			["total_results", "total"],
		)
	) {
		return null;
	}
	return result.value;
}

/** Reads and normalizes a CodebaseMemory symbol inspection result when available. */
export function codebaseMemoryInspect(
	root: string,
	target: string,
	limit: number,
): CodebaseMemoryInspectResult | null {
	if (target.includes("/") || target.includes("\\")) {
		return null;
	}
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const searchResult = callCodebaseMemoryTool("search_graph", {
		project: project.name,
		query: target,
		limit,
		include_connected: true,
	});
	if (!searchResult.ok) {
		return null;
	}
	const match = firstGraphMatch(searchResult.value);
	const qualifiedName = stringField(match.qualified_name);
	if (qualifiedName === null) {
		return null;
	}
	const snippetResult = callCodebaseMemoryTool("get_code_snippet", {
		project: project.name,
		qualified_name: qualifiedName,
		include_neighbors: true,
	});
	if (!snippetResult.ok) {
		return null;
	}
	const traceResult = callCodebaseMemoryTool("trace_path", {
		project: project.name,
		function_name: qualifiedName,
		mode: "calls",
		direction: "both",
		depth: 2,
		risk_labels: true,
	});
	return inspectResultFromPayloads(
		target,
		root,
		match,
		searchResult.value,
		snippetResult.value,
		traceResult.ok ? traceResult.value : null,
	);
}

/** Reads CodebaseMemory caller/callee traces when available. */
export function codebaseMemoryCallTrace(
	root: string,
	name: string,
): unknown | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const result = callCodebaseMemoryTool("trace_path", {
		project: project.name,
		function_name: name,
		mode: "calls",
		direction: "both",
		depth: 2,
	});
	if (!result.ok) {
		return null;
	}
	if (
		!hasSearchAnswer(
			result.value,
			["paths", "call_paths", "traces", "results", "callers", "callees"],
			["total_paths", "path_count", "total_results", "total"],
		)
	) {
		return null;
	}
	return result.value;
}

/** Reads CodebaseMemory's architecture and cluster summary when available. */
export function codebaseMemoryArchitectureSummary(
	root: string,
): unknown | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const result = callCodebaseMemoryTool("get_architecture", {
		project: project.name,
		aspects: ["all"],
	});
	if (!result.ok) {
		return null;
	}
	return result.value;
}

/** Reads CodebaseMemory index status and schema metadata when available. */
export function codebaseMemoryStatus(
	root: string,
): CodebaseMemoryStatusResult | null {
	const project = codebaseMemoryReadyProject(root);
	if (project === null) {
		return null;
	}
	const schemaResult = callCodebaseMemoryTool("get_graph_schema", {
		project: project.name,
	});
	const schema = schemaResult.ok ? recordValue(schemaResult.value) : {};
	return {
		projectName: project.name,
		status: project.status,
		nodes: project.nodes,
		edges: project.edges,
		schemaNodeLabels: schemaResult.ok
			? arrayValue(schema.node_labels).length
			: null,
		schemaEdgeTypes: schemaResult.ok
			? arrayValue(schema.edge_types).length
			: null,
	};
}

/** Explicitly refreshes CodebaseMemory and returns timing plus status metadata. */
export function codebaseMemoryIndex(
	root: string,
): CodebaseMemoryIndexResult | null {
	const start = performance.now();
	const status = codebaseMemoryStatus(root);
	if (status === null) {
		return null;
	}
	return {
		...status,
		elapsedMs: performance.now() - start,
	};
}

/** Normalizes inspect search, snippet, and trace payloads into one view object. */
function inspectResultFromPayloads(
	target: string,
	root: string,
	match: Record<string, unknown>,
	searchValue: unknown,
	snippetValue: unknown,
	traceValue: unknown,
): CodebaseMemoryInspectResult {
	const snippet = recordValue(snippetValue);
	const trace = recordValue(traceValue);
	const name = stringField(snippet.name) ?? stringField(match.name) ?? target;
	const qualifiedName =
		stringField(snippet.qualified_name) ??
		stringField(match.qualified_name) ??
		target;
	const filePath = displayFilePath(
		stringField(snippet.file_path) ?? stringField(match.file_path),
		root,
	);
	return {
		name,
		qualifiedName,
		filePath,
		startLine: numberField(snippet.start_line) ?? numberField(match.start_line),
		endLine: numberField(snippet.end_line) ?? numberField(match.end_line),
		matchRank: ordinalRank(numberField(match.rank)),
		matchScore: matchScore(match),
		signalFacts: signalFacts(snippet),
		graphFacts: graphFacts(match),
		signature: signatureText(snippet),
		source: stringField(snippet.source),
		callers: traceRows(trace.callers),
		callees: traceRows(trace.callees),
		related: uniqueRows([
			...stringArray(snippet.caller_names),
			...stringArray(snippet.callee_names),
			...traceNames(trace.callers),
			...traceNames(trace.callees),
		]).filter((item) => !testLikeName(item)),
		graphNeighbors: graphNeighbors(searchValue, qualifiedName).filter(
			(item) => !testLikeName(item),
		),
	};
}

/** Reads an ordinal graph result rank when the backend supplies one. */
function ordinalRank(value: number | null): number | null {
	return value !== null && Number.isInteger(value) && value > 0 ? value : null;
}

/** Reads the best available graph match confidence score. */
function matchScore(match: Record<string, unknown>): number | null {
	const score =
		numberField(match.rerank_score) ??
		numberField(match.score) ??
		numberField(match.similarity);
	if (score !== null) {
		return score;
	}
	const rank = numberField(match.rank);
	return ordinalRank(rank) === null ? rank : null;
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

/** Extracts the first graph search result record. */
function firstGraphMatch(value: unknown): Record<string, unknown> {
	const record = recordValue(value);
	for (const key of ["results", "semantic_results"]) {
		for (const item of arrayValue(record[key])) {
			const itemRecord = recordValue(item);
			if (stringField(itemRecord.qualified_name) !== null) {
				return itemRecord;
			}
		}
	}
	for (const item of arrayValue(record.results)) {
		const nested = recordValue(recordValue(item).node);
		if (stringField(nested.qualified_name) !== null) {
			return nested;
		}
	}
	return {};
}

/** Builds compact complexity and graph degree facts from a snippet payload. */
function signalFacts(snippet: Record<string, unknown>): string[] {
	return [
		["complexity", numberField(snippet.complexity)],
		["cognitive", numberField(snippet.cognitive)],
		["lines", numberField(snippet.lines)],
		["callers", numberField(snippet.callers)],
		["callees", numberField(snippet.callees)],
	]
		.filter((item): item is [string, number] => item[1] !== null)
		.map(([name, value]) => `${name}=${value}`);
}

/** Builds compact node metadata facts from a graph search match. */
function graphFacts(match: Record<string, unknown>): string[] {
	return [
		["label", stringField(match.label) ?? stringField(match.node_label)],
		["kind", stringField(match.kind) ?? stringField(match.type)],
		["package", stringField(match.package) ?? stringField(match.package_name)],
		["language", stringField(match.language)],
	]
		.filter((item): item is [string, string] => item[1] !== null)
		.map(([name, value]) => `${name}=${value}`);
}

/** Extracts readable neighbor rows from common graph search payload shapes. */
function graphNeighbors(value: unknown, qualifiedName: string): string[] {
	const record = recordValue(value);
	return uniqueRows([
		...neighborRows(record.connected_nodes, qualifiedName),
		...neighborRows(record.neighbors, qualifiedName),
		...relationshipRows(record.relationships, qualifiedName),
		...relationshipRows(record.edges, qualifiedName),
	]);
}

/** Extracts graph neighbor rows from node-like arrays. */
function neighborRows(value: unknown, qualifiedName: string): string[] {
	return arrayValue(value)
		.map((item) => {
			const record = recordValue(item);
			const name =
				stringField(record.name) ??
				stringField(record.qualified_name) ??
				stringField(record.target);
			if (name === null || name === qualifiedName) {
				return null;
			}
			const relation =
				stringField(record.relationship) ??
				stringField(record.edge_type) ??
				stringField(record.type);
			return relation === null ? name : `${relation}: ${name}`;
		})
		.filter((item) => item !== null);
}

/** Extracts graph neighbor rows from edge-like arrays. */
function relationshipRows(value: unknown, qualifiedName: string): string[] {
	return arrayValue(value)
		.map((item) => {
			const record = recordValue(item);
			const source =
				stringField(record.source) ??
				stringField(record.from) ??
				stringField(record.source_name);
			const target =
				stringField(record.target) ??
				stringField(record.to) ??
				stringField(record.target_name);
			const relation =
				stringField(record.type) ??
				stringField(record.relationship) ??
				stringField(record.edge_type);
			const other =
				source === qualifiedName
					? target
					: target === qualifiedName
						? source
						: null;
			if (other === null || other === undefined || other === qualifiedName) {
				return null;
			}
			return relation === null ? other : `${relation}: ${other}`;
		})
		.filter((item) => item !== null);
}

/** Builds a compact signature row from CodebaseMemory snippet fields. */
function signatureText(snippet: Record<string, unknown>): string | null {
	const signature = stringField(snippet.signature);
	const returnType = stringField(snippet.return_type);
	if (signature === null) {
		return null;
	}
	return `${signature}${returnType ?? ""}`.replace(/\s+/g, " ").trim();
}

/** Builds readable trace rows from Codebase Memory trace arrays. */
function traceRows(value: unknown): string[] {
	return arrayValue(value)
		.map((item) => {
			const record = recordValue(item);
			const name =
				stringField(record.name) ?? stringField(record.qualified_name);
			if (name === null) {
				return null;
			}
			const hop = numberField(record.hop);
			const risk = stringField(record.risk);
			const facts = [
				hop !== null ? `hop ${hop}` : null,
				risk !== null ? risk.toLowerCase() : null,
			].filter((item) => item !== null);
			return facts.length > 0 ? `${name} (${facts.join(", ")})` : name;
		})
		.filter((item) => item !== null);
}

/** Extracts names from trace records for the next-read section. */
function traceNames(value: unknown): string[] {
	return arrayValue(value)
		.map((item) => {
			const record = recordValue(item);
			return stringField(record.name) ?? stringField(record.qualified_name);
		})
		.filter((item) => item !== null);
}

/** Reads string fields while rejecting empty values. */
function stringField(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads number fields while rejecting other values. */
function numberField(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

/** Reads string arrays from untrusted payloads. */
function stringArray(value: unknown): string[] {
	return arrayValue(value).filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
}

/** Deduplicates short rows while preserving first-seen order. */
function uniqueRows(rows: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const row of rows) {
		if (seen.has(row)) {
			continue;
		}
		seen.add(row);
		unique.push(row);
	}
	return unique;
}

/** Shortens absolute paths when Codebase Memory returns them. */
function displayFilePath(value: string | null, root: string): string | null {
	if (value === null) {
		return null;
	}
	if (path.isAbsolute(value)) {
		return path.relative(root, value).split(path.sep).join("/");
	}
	return value;
}

/** Filters likely test names out of default next-read suggestions. */
function testLikeName(value: string): boolean {
	const lower = value.toLowerCase();
	return (
		lower.includes("/test") ||
		lower.includes(".test.") ||
		lower.includes("_test.")
	);
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
