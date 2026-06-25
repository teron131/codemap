/** Renders rough CodebaseMemory MCP output for Codemap commands. */
import path from "node:path";

import {
	arrayValue,
	callCodebaseMemoryTool,
	codebaseMemoryReadyProject,
	recordValue,
} from "./client.js";

/** Prints graph-augmented CodebaseMemory source search results when available. */
export function printCodebaseMemorySearch(
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
	if (
		!hasSearchAnswer(
			result.value,
			["results", "raw_matches"],
			["total_results"],
		)
	) {
		return false;
	}
	console.log("\nCodebaseMemory code matches:");
	console.log(JSON.stringify(result.value, null, 2));
	return true;
}

/** Prints CodebaseMemory graph search results for relationship-oriented search when available. */
export function printCodebaseMemoryGraphSearch(
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
	if (
		!hasSearchAnswer(
			result.value,
			["results", "semantic_results", "raw_matches"],
			["total_results", "total"],
		)
	) {
		return false;
	}
	console.log("\nCodebaseMemory graph matches:");
	console.log(JSON.stringify(result.value, null, 2));
	return true;
}

/** Prints CodebaseMemory semantic graph matches for semantic search when available. */
export function printCodebaseMemorySemanticSearch(
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
	if (
		!hasSearchAnswer(
			result.value,
			["results", "semantic_results", "raw_matches"],
			["total_results", "total"],
		)
	) {
		return false;
	}
	console.log("\nCodebaseMemory semantic matches:");
	console.log(JSON.stringify(result.value, null, 2));
	return true;
}

/** Prints a CodebaseMemory snippet for a symbol inspection target when available. */
export function printCodebaseMemoryInspect(
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
	const match = firstGraphMatch(searchResult.value);
	const qualifiedName = stringField(match.qualified_name);
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
	const traceResult = callCodebaseMemoryTool("trace_path", {
		project: project.name,
		function_name: qualifiedName,
		mode: "calls",
		direction: "both",
		depth: 2,
		risk_labels: true,
	});
	console.log(
		renderCodebaseMemoryInspect(
			target,
			root,
			match,
			snippetResult.value,
			traceResult.ok ? traceResult.value : null,
			{ limit },
		),
	);
	return true;
}

/** Prints CodebaseMemory caller/callee traces for search calls when available. */
export function printCodebaseMemoryCallTrace(
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
	if (
		!hasSearchAnswer(
			result.value,
			["paths", "call_paths", "traces", "results", "callers", "callees"],
			["total_paths", "path_count", "total_results", "total"],
		)
	) {
		return false;
	}
	if (jsonOutput) {
		console.log(JSON.stringify(result.value, null, 2));
	} else {
		console.log("CodebaseMemory call trace:");
		console.log(JSON.stringify(result.value, null, 2));
	}
	return true;
}

/** Prints CodebaseMemory's architecture and cluster summary when available. */
export function printCodebaseMemoryArchitectureSummary(root: string): boolean {
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
	console.log(JSON.stringify(result.value, null, 2));
	return true;
}

/** Prints CodebaseMemory index status and graph schema when available. */
export function printCodebaseMemoryStatus(root: string): boolean {
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

/** Renders a compact backend-first inspect report. */
function renderCodebaseMemoryInspect(
	target: string,
	root: string,
	match: Record<string, unknown>,
	snippetValue: unknown,
	traceValue: unknown,
	{ limit }: { limit: number },
): string {
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
	const startLine =
		numberField(snippet.start_line) ?? numberField(match.start_line);
	const endLine = numberField(snippet.end_line) ?? numberField(match.end_line);
	const lines = [
		`# Inspect: ${name}`,
		"",
		"Backend: Codebase Memory",
		`Qualified: ${qualifiedName}`,
	];
	if (filePath !== null) {
		lines.push(
			`Source: ${filePath}${startLine !== null ? `:${startLine}` : ""}${endLine !== null && endLine !== startLine ? `-${endLine}` : ""}`,
		);
	}
	appendCodebaseMemorySignalLines(lines, snippet);
	appendCodebaseMemoryCode(lines, snippet, filePath, { limit });
	appendCodebaseMemoryTrace(lines, trace, { limit });
	appendCodebaseMemoryRelated(lines, snippet, trace, { limit });
	return lines.join("\n").trim();
}

/** Adds compact complexity and graph degree facts from a snippet payload. */
function appendCodebaseMemorySignalLines(
	lines: string[],
	snippet: Record<string, unknown>,
): void {
	const facts = [
		["complexity", numberField(snippet.complexity)],
		["cognitive", numberField(snippet.cognitive)],
		["lines", numberField(snippet.lines)],
		["callers", numberField(snippet.callers)],
		["callees", numberField(snippet.callees)],
	]
		.filter((item): item is [string, number] => item[1] !== null)
		.map(([name, value]) => `${name}=${value}`);
	if (facts.length === 0) {
		return;
	}
	lines.push(`Signals: ${facts.join(", ")}`);
}

/** Adds a concise source section from Codebase Memory snippet payloads. */
function appendCodebaseMemoryCode(
	lines: string[],
	snippet: Record<string, unknown>,
	filePath: string | null,
	{ limit }: { limit: number },
): void {
	const signature = stringField(snippet.signature);
	const returnType = stringField(snippet.return_type);
	const source = stringField(snippet.source);
	if (signature === null && source === null) {
		return;
	}
	lines.push("");
	lines.push("## Code");
	if (signature !== null) {
		lines.push(
			`Signature: ${`${signature}${returnType ?? ""}`.replace(/\s+/g, " ").trim()}`,
		);
	}
	if (source === null) {
		return;
	}
	const sourceLines = source.trimEnd().split("\n");
	const shownLines = sourceLines.slice(0, Math.max(limit * 4, 12));
	lines.push("");
	lines.push(`\`\`\`${codeFenceLanguage(filePath)}`);
	lines.push(...shownLines);
	if (sourceLines.length > shownLines.length) {
		lines.push(`// ... ${sourceLines.length - shownLines.length} more lines`);
	}
	lines.push("```");
}

/** Adds compact caller and callee rows from Codebase Memory traces. */
function appendCodebaseMemoryTrace(
	lines: string[],
	trace: Record<string, unknown>,
	{ limit }: { limit: number },
): void {
	const callers = traceRows(trace.callers, { limit });
	const callees = traceRows(trace.callees, { limit });
	if (callers.length === 0 && callees.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Calls");
	if (callers.length > 0) {
		lines.push(`Inbound: ${callers.length}`);
		for (const item of callers) {
			lines.push(`- ${item}`);
		}
	}
	if (callees.length > 0) {
		lines.push(`Outbound: ${callees.length}`);
		for (const item of callees) {
			lines.push(`- ${item}`);
		}
	}
}

/** Adds a short next-read list from trace and snippet neighbors. */
function appendCodebaseMemoryRelated(
	lines: string[],
	snippet: Record<string, unknown>,
	trace: Record<string, unknown>,
	{ limit }: { limit: number },
): void {
	const related = uniqueRows([
		...stringArray(snippet.caller_names),
		...stringArray(snippet.callee_names),
		...traceNames(trace.callers),
		...traceNames(trace.callees),
	])
		.filter((item) => !testLikeName(item))
		.slice(0, limit);
	if (related.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Next Reads");
	for (const item of related) {
		lines.push(`- ${item}`);
	}
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

/** Builds readable trace rows from Codebase Memory trace arrays. */
function traceRows(value: unknown, { limit }: { limit: number }): string[] {
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
		.filter((item) => item !== null)
		.slice(0, limit);
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

/** Chooses a compact Markdown code fence hint from a source path. */
function codeFenceLanguage(filePath: string | null): string {
	if (filePath === null) {
		return "";
	}
	if (/\.[cm]?tsx?$/.test(filePath)) {
		return "ts";
	}
	if (filePath.endsWith(".py")) {
		return "py";
	}
	if (filePath.endsWith(".json")) {
		return "json";
	}
	return "";
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
