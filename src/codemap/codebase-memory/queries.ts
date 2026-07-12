/** Provides normalized CodebaseMemory backend query results for CLI rendering. */
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
	arrayValue,
	type CodebaseMemoryReadyProject,
	callCodebaseMemoryTool,
	canonicalPath,
	recordValue,
	withFreshCodebaseMemoryProject,
} from "./client.js";

export type CodebaseMemoryInspectResult = {
	name: string;
	filePath: string | null;
	startLine: number | null;
	endLine: number | null;
	signalFacts: string[];
	signature: string | null;
	source: string | null;
	callers: string[];
	callees: string[];
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

export type CodebaseMemoryGraphSearchOptions = {
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

export type CodebaseMemoryChangeOptions = {
	scope?: string;
	depth?: number;
	baseBranch?: string;
	since?: string;
};

type CodebaseMemoryProjectQueryResult = {
	freshness: CodebaseMemoryReadyProject["status"];
	value: unknown;
};

const MIN_SEMANTIC_SCORE = 0.2;
const JSON_FORMAT = { format: "json" } as const;

/** Reads graph-augmented CodebaseMemory source search results when available. */
export function codebaseMemorySearch(
	root: string,
	searchText: string,
	limit: number,
): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("search_code", {
			project: project.name,
			pattern: searchText,
			limit,
			context: 1,
			...JSON_FORMAT,
		});
		if (!result.ok) {
			return null;
		}
		if (!hasSearchAnswer(result.value, ["results", "raw_matches"])) {
			return null;
		}
		return result.value;
	});
}

/** Reads CodebaseMemory graph search results when available. */
export function codebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
	options: CodebaseMemoryGraphSearchOptions = {},
): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("search_graph", {
			project: project.name,
			query: searchText,
			...graphSearchArgs(options),
			limit,
			include_connected: true,
			...JSON_FORMAT,
		});
		if (!result.ok) {
			return null;
		}
		if (
			!hasSearchAnswer(result.value, [
				"results",
				"semantic_results",
				"raw_matches",
			])
		) {
			return null;
		}
		return result.value;
	});
}

/** Reads CodebaseMemory semantic graph search results when available. */
export function codebaseMemorySemanticSearch(
	root: string,
	searchText: string,
	limit: number,
): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("search_graph", {
			project: project.name,
			semantic_query: semanticTerms(searchText),
			limit,
			include_connected: true,
			...JSON_FORMAT,
		});
		if (!result.ok) {
			return null;
		}
		const payload = semanticSearchPayload(result.value);
		if (!hasSearchAnswer(payload, ["semantic_results"])) {
			return null;
		}
		return payload;
	});
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
	return withFreshCodebaseMemoryProject(root, (project) => {
		const searchResult = callCodebaseMemoryTool("search_graph", {
			project: project.name,
			query: target,
			limit,
			include_connected: true,
			...JSON_FORMAT,
		});
		if (!searchResult.ok) {
			return null;
		}
		const match = firstGraphMatch(searchResult.value, target);
		const qualifiedName = stringField(match.qualified_name);
		if (qualifiedName === null) {
			return null;
		}
		const snippetResult = callCodebaseMemoryTool("get_code_snippet", {
			project: project.name,
			qualified_name: qualifiedName,
			include_neighbors: true,
			...JSON_FORMAT,
		});
		if (!snippetResult.ok || !hasSnippetAnswer(snippetResult.value)) {
			return null;
		}
		const traceResult = callCodebaseMemoryTool("trace_path", {
			project: project.name,
			function_name: qualifiedName,
			mode: "calls",
			direction: "both",
			depth: 2,
			risk_labels: false,
			...JSON_FORMAT,
		});
		return inspectResultFromPayloads(
			target,
			root,
			match,
			snippetResult.value,
			traceResult.ok ? traceResult.value : null,
		);
	});
}

/** Requires source-owned snippet data before backend inspect can replace local output. */
function hasSnippetAnswer(value: unknown): boolean {
	return stringField(recordValue(value).source) !== null;
}

/** Lists indexed CodebaseMemory projects after refreshing the current root. */
export function codebaseMemoryProjects(root: string): unknown | null {
	return withFreshCodebaseMemoryProject(root, () => {
		const result = callCodebaseMemoryTool("list_projects", {});
		return result.ok ? result.value : null;
	});
}

/** Reads CodebaseMemory graph schema details for the current project. */
export function codebaseMemorySchema(root: string): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("get_graph_schema", {
			project: project.name,
			...JSON_FORMAT,
		});
		return result.ok ? result.value : null;
	});
}

/** Executes a read-oriented CodebaseMemory Cypher query for advanced graph analysis. */
export function codebaseMemoryQuery(
	root: string,
	query: string,
	maxRows: number | undefined,
): unknown | null {
	return codebaseMemoryQueryWithProject(root, query, maxRows)?.value ?? null;
}

/** Executes a graph query and retains the indexed project freshness metadata. */
export function codebaseMemoryQueryWithProject(
	root: string,
	query: string,
	maxRows: number | undefined,
): CodebaseMemoryProjectQueryResult | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("query_graph", {
			project: project.name,
			query,
			...(maxRows !== undefined ? { max_rows: maxRows } : {}),
			...JSON_FORMAT,
		});
		return result.ok
			? { freshness: project.status, value: result.value }
			: null;
	});
}

/** Normalizes query_graph column/row payloads into named records. */
export function codebaseMemoryQueryRows(
	value: unknown,
	requiredColumns: string[] = [],
): Record<string, unknown>[] | null {
	const payload = recordValue(value);
	if (!Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
		return null;
	}
	const columns = arrayValue(payload.columns).filter(
		(column): column is string => typeof column === "string",
	);
	if (requiredColumns.some((column) => !columns.includes(column))) {
		return null;
	}
	return arrayValue(payload.rows)
		.map((row) => {
			if (Array.isArray(row) && columns.length > 0) {
				return Object.fromEntries(
					columns.map((column, index) => [column, row[index]]),
				);
			}
			return recordValue(row);
		})
		.filter((row) => Object.keys(row).length > 0);
}

/** Reads CodebaseMemory's changed-code impact summary for the current project. */
export function codebaseMemoryChanges(
	root: string,
	options: CodebaseMemoryChangeOptions,
): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("detect_changes", {
			project: project.name,
			...(options.scope !== undefined ? { scope: options.scope } : {}),
			...(options.depth !== undefined ? { depth: options.depth } : {}),
			...(options.baseBranch !== undefined
				? { base_branch: options.baseBranch }
				: {}),
			...(options.since !== undefined ? { since: options.since } : {}),
			...JSON_FORMAT,
		});
		return result.ok ? result.value : null;
	});
}

/** Reads CodebaseMemory's architecture and cluster summary when available. */
export function codebaseMemoryArchitectureSummary(
	root: string,
): unknown | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const result = callCodebaseMemoryTool("get_architecture", {
			project: project.name,
			aspects: ["all"],
			...JSON_FORMAT,
		});
		if (!result.ok) {
			return null;
		}
		return hasArchitectureAnswer(result.value) ? result.value : null;
	});
}

/** Rejects successful-but-unknown architecture payloads so summary can fall back. */
function hasArchitectureAnswer(value: unknown): boolean {
	const record = recordValue(value);
	if (stringField(record.project) === null) {
		return false;
	}
	return (
		numberField(record.total_nodes) !== null ||
		numberField(record.total_edges) !== null ||
		["languages", "node_labels", "edge_types", "hotspots", "clusters"].some(
			(key) => arrayValue(record[key]).length > 0,
		)
	);
}

/** Reads CodebaseMemory index status and schema metadata when available. */
export function codebaseMemoryStatus(
	root: string,
): CodebaseMemoryStatusResult | null {
	return withFreshCodebaseMemoryProject(root, (project) => {
		const schemaResult = callCodebaseMemoryTool("get_graph_schema", {
			project: project.name,
			...JSON_FORMAT,
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
	});
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
	const excludedNames = excludedTraceNames([name, qualifiedName]);
	const filePath = displayFilePath(
		stringField(snippet.file_path) ?? stringField(match.file_path),
		root,
	);
	return {
		name,
		filePath,
		startLine: numberField(snippet.start_line) ?? numberField(match.start_line),
		endLine: numberField(snippet.end_line) ?? numberField(match.end_line),
		signalFacts: signalFacts({ ...match, ...snippet }),
		signature: signatureText(snippet, name),
		source: stringField(snippet.source),
		callers: traceRows(trace.callers, excludedNames),
		callees: traceRows(trace.callees, excludedNames),
	};
}

/** Checks common CodebaseMemory search payload fields for no-answer responses. */
function hasSearchAnswer(value: unknown, arrayKeys: string[]): boolean {
	const record = recordValue(value);
	return arrayKeys.some((key) => arrayValue(record[key]).length > 0);
}

/** Converts optional graph search flags into CodebaseMemory search_graph arguments. */
function graphSearchArgs(
	options: CodebaseMemoryGraphSearchOptions,
): Record<string, unknown> {
	return {
		...(options.label !== undefined ? { label: options.label } : {}),
		...(options.namePattern !== undefined
			? { name_pattern: options.namePattern }
			: {}),
		...(options.qnPattern !== undefined
			? { qn_pattern: options.qnPattern }
			: {}),
		...(options.filePattern !== undefined
			? { file_pattern: options.filePattern }
			: {}),
		...(options.relationship !== undefined
			? { relationship: options.relationship }
			: {}),
		...(options.minDegree !== undefined
			? { min_degree: options.minDegree }
			: {}),
		...(options.maxDegree !== undefined
			? { max_degree: options.maxDegree }
			: {}),
		...(options.excludeEntryPoints !== undefined
			? { exclude_entry_points: options.excludeEntryPoints }
			: {}),
		...(options.offset !== undefined ? { offset: options.offset } : {}),
	};
}

/** Keeps only backend semantic search rows from a combined graph payload. */
function semanticSearchPayload(value: unknown): Record<string, unknown> {
	const record = recordValue(value);
	const semanticResults = arrayValue(record.semantic_results).filter(
		semanticResultHasSignal,
	);
	return {
		search_mode: "semantic",
		semantic_results: semanticResults,
		has_more:
			typeof record.semantic_has_more === "boolean"
				? record.semantic_has_more
				: false,
	};
}

/** Keeps only semantic rows whose score clears the useful-signal floor. */
function semanticResultHasSignal(value: unknown): boolean {
	const score = numberField(recordValue(value).score);
	return score !== null && score >= MIN_SEMANTIC_SCORE;
}

/** Extracts one unambiguous exact graph result for a symbol target. */
function firstGraphMatch(
	value: unknown,
	target: string,
): Record<string, unknown> {
	const record = recordValue(value);
	const candidates: Record<string, unknown>[] = [];
	for (const key of ["results", "semantic_results"]) {
		for (const item of arrayValue(record[key])) {
			const itemRecord = recordValue(item);
			if (stringField(itemRecord.qualified_name) !== null) {
				candidates.push(itemRecord);
			}
			const nested = recordValue(itemRecord.node);
			if (stringField(nested.qualified_name) !== null) {
				candidates.push(nested);
			}
		}
	}
	const exact = new Map<string, Record<string, unknown>>();
	for (const candidate of candidates) {
		const name = stringField(candidate.name);
		const qualifiedName = stringField(candidate.qualified_name);
		if (
			qualifiedName !== null &&
			(name === target ||
				qualifiedName === target ||
				qualifiedName.endsWith(`.${target}`))
		) {
			exact.set(qualifiedName, candidate);
		}
	}
	return exact.size === 1 ? ([...exact.values()][0] ?? {}) : {};
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

/** Builds a compact signature row from CodebaseMemory snippet fields. */
function signatureText(
	snippet: Record<string, unknown>,
	name: string,
): string | null {
	const signature = stringField(snippet.signature);
	const returnType = stringField(snippet.return_type);
	if (signature === null) {
		return null;
	}
	if (
		returnType === null ||
		signatureAlreadyIncludesReturnType(signature, returnType)
	) {
		return compactSignature(signature, name);
	}
	const separator = returnType.startsWith(":")
		? ""
		: returnType.startsWith("->")
			? " "
			: " -> ";
	return compactSignature(`${signature}${separator}${returnType}`, name);
}

/** Compacts backend signature fragments into a readable one-line signature. */
function compactSignature(signature: string, name: string): string {
	const text = signature
		.replace(/\s+/g, " ")
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.replace(/,\s*\)/g, ")")
		.trim();
	return text.startsWith("(") ? `${name}${text}` : text;
}

/** Detects return types already attached to the end of a backend signature. */
function signatureAlreadyIncludesReturnType(
	signature: string,
	returnType: string,
): boolean {
	const normalized = signature.replace(/\s+/g, " ").trim();
	const normalizedReturn = returnType.replace(/\s+/g, " ").trim();
	if (normalizedReturn.startsWith(":") || normalizedReturn.startsWith("->")) {
		return normalized.endsWith(normalizedReturn);
	}
	return (
		normalized.endsWith(`-> ${normalizedReturn}`) ||
		normalized.endsWith(`: ${normalizedReturn}`)
	);
}

/** Builds readable trace rows from Codebase Memory trace arrays. */
function traceRows(
	value: unknown,
	excluded: Set<string> = new Set(),
): string[] {
	return uniqueTraceRows(
		arrayValue(value)
			.map((item) => {
				const record = recordValue(item);
				const name =
					stringField(record.name) ?? stringField(record.qualified_name);
				if (name === null) {
					return null;
				}
				const qualifiedName = stringField(record.qualified_name);
				if (
					excluded.has(name) ||
					(qualifiedName !== null && excluded.has(qualifiedName))
				) {
					return null;
				}
				const hop = numberField(record.hop);
				return hop !== null && hop > 1 ? `${name} (hop ${hop})` : name;
			})
			.filter((item) => item !== null),
	);
}

/** Deduplicates trace rows by symbol name while preserving nearest-hop order. */
function uniqueTraceRows(rows: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const row of rows) {
		const key = row.replace(/\s+\(.*/, "");
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(row);
	}
	return unique;
}

/** Builds an exact-name exclusion set for target/self trace rows. */
function excludedTraceNames(names: string[]): Set<string> {
	const excluded = new Set<string>();
	for (const name of names) {
		excluded.add(name);
		const short = name.split(".").pop();
		if (short !== undefined && short.length > 0) {
			excluded.add(short);
		}
	}
	return excluded;
}

/** Reads string fields while rejecting empty values. */
function stringField(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads number fields while rejecting other values. */
function numberField(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

/** Shortens absolute paths when Codebase Memory returns them. */
function displayFilePath(value: string | null, root: string): string | null {
	if (value === null) {
		return null;
	}
	if (path.isAbsolute(value)) {
		return path
			.relative(canonicalPath(root), canonicalPath(value))
			.split(path.sep)
			.join("/");
	}
	return value;
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
