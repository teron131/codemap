/** Renders normalized CodebaseMemory backend results for Codemap commands. */

import { matchesGlobFilter, matchesTextFilter } from "../search/filters.js";
import {
	type CodebaseMemoryChangeOptions,
	type CodebaseMemoryGraphSearchOptions,
	type CodebaseMemoryIndexResult,
	type CodebaseMemoryInspectResult,
	type CodebaseMemoryStatusResult,
	type CodebaseMemoryTraceOptions,
	codebaseMemoryArchitectureSummary,
	codebaseMemoryCallTrace,
	codebaseMemoryChanges,
	codebaseMemoryGraphSearch,
	codebaseMemoryIndex,
	codebaseMemoryInspect,
	codebaseMemoryProjects,
	codebaseMemoryQuery,
	codebaseMemorySchema,
	codebaseMemorySearch,
	codebaseMemorySemanticSearch,
	codebaseMemoryStatus,
} from "./queries.js";

type BackendRenderOptions = {
	includeTests?: boolean;
};

type BackendGraphRenderOptions = BackendRenderOptions &
	Pick<
		CodebaseMemoryGraphSearchOptions,
		| "excludeEntryPoints"
		| "filePattern"
		| "label"
		| "maxDegree"
		| "minDegree"
		| "namePattern"
		| "qnPattern"
		| "relationship"
	>;

const GENERIC_BACKEND_NAMES = new Set([
	"append",
	"clear",
	"close",
	"connect",
	"exists",
	"get",
	"items",
	"json",
	"keys",
	"open",
	"read",
	"read_text",
	"run",
	"set",
	"send",
	"update",
	"values",
	"write",
	"write_text",
]);

/** Prints graph-augmented CodebaseMemory source search results when available. */
export function printCodebaseMemorySearch(
	root: string,
	searchText: string,
	limit: number,
	options: BackendRenderOptions = {},
): boolean {
	const result = codebaseMemorySearch(
		root,
		searchText,
		backendFetchLimit(limit, options),
	);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory code matches:");
	console.log(renderCodebaseMemoryCodeSearch(result, { limit, ...options }));
	return true;
}

/** Prints CodebaseMemory graph search results for relationship-oriented search when available. */
export function printCodebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
	options: CodebaseMemoryGraphSearchOptions & BackendRenderOptions = {},
): boolean {
	const { includeTests = false, ...backendOptions } = options;
	const result = codebaseMemoryGraphSearch(
		root,
		searchText,
		backendFetchLimit(limit, { includeTests }),
		backendOptions,
	);
	if (result === null) {
		return false;
	}
	if (!hasVisibleGraphSearchRows(result, { includeTests, ...backendOptions })) {
		return false;
	}
	console.log("\nCodebaseMemory graph matches:");
	console.log(
		renderCodebaseMemoryGraphSearch(result, {
			limit,
			includeTests,
			...backendOptions,
		}),
	);
	return true;
}

/** Prints CodebaseMemory semantic graph matches for semantic search when available. */
export function printCodebaseMemorySemanticSearch(
	root: string,
	searchText: string,
	limit: number,
	options: BackendRenderOptions = {},
): boolean {
	const result = codebaseMemorySemanticSearch(
		root,
		searchText,
		backendFetchLimit(limit, options),
	);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory semantic matches:");
	console.log(
		renderCodebaseMemorySemanticSearch(result, { limit, ...options }),
	);
	return true;
}

/** Prints a CodebaseMemory snippet for a symbol inspection target when available. */
export function printCodebaseMemoryInspect(
	root: string,
	target: string,
	limit: number,
): boolean {
	const result = codebaseMemoryInspect(root, target, limit);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryInspect(result, { limit }));
	return true;
}

/** Prints CodebaseMemory caller/callee traces for search calls when available. */
export function printCodebaseMemoryCallTrace(
	root: string,
	name: string,
	{
		jsonOutput = false,
		limit = 8,
		...options
	}: CodebaseMemoryTraceOptions & { jsonOutput?: boolean; limit?: number } = {},
): boolean {
	const result = codebaseMemoryCallTrace(root, name, options);
	if (result === null) {
		return false;
	}
	if (jsonOutput) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log("CodebaseMemory call trace:");
		console.log(renderCodebaseMemoryTrace(result, { limit }));
	}
	return true;
}

/** Prints indexed CodebaseMemory projects. */
export function printCodebaseMemoryProjects(root: string): boolean {
	const result = codebaseMemoryProjects(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryProjects(result, root));
	return true;
}

/** Prints CodebaseMemory graph schema details. */
export function printCodebaseMemorySchema(root: string): boolean {
	const result = codebaseMemorySchema(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemorySchema(result));
	return true;
}

/** Prints a CodebaseMemory Cypher query result. */
export function printCodebaseMemoryQuery(
	root: string,
	query: string,
	{ jsonOutput = false, maxRows }: { jsonOutput?: boolean; maxRows?: number },
): boolean {
	const result = codebaseMemoryQuery(root, query, maxRows);
	if (result === null) {
		return false;
	}
	console.log(
		jsonOutput ? JSON.stringify(result, null, 2) : renderRows(result),
	);
	return true;
}

/** Prints CodebaseMemory changed-code impact results. */
export function printCodebaseMemoryChanges(
	root: string,
	options: CodebaseMemoryChangeOptions & { jsonOutput?: boolean },
): boolean {
	const result = codebaseMemoryChanges(root, options);
	if (result === null) {
		return false;
	}
	console.log(
		options.jsonOutput
			? JSON.stringify(result, null, 2)
			: renderCodebaseMemoryChanges(result),
	);
	return true;
}

/** Prints CodebaseMemory's architecture and cluster summary when available. */
export function printCodebaseMemoryArchitectureSummary(root: string): boolean {
	const result = codebaseMemoryArchitectureSummary(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryArchitectureSummary(result));
	return true;
}

/** Prints CodebaseMemory index status and graph schema when available. */
export function printCodebaseMemoryStatus(root: string): boolean {
	const result = codebaseMemoryStatus(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryStatus(result));
	return true;
}

/** Prints an explicit CodebaseMemory refresh result with elapsed time. */
export function printCodebaseMemoryIndex(root: string): boolean {
	const result = codebaseMemoryIndex(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryIndex(result));
	return true;
}

/** Renders compact CodebaseMemory search_code rows. */
function renderCodebaseMemoryCodeSearch(
	value: unknown,
	{ includeTests = false, limit }: BackendRenderOptions & { limit: number },
): string {
	const record = recordValue(value);
	const allRows = arrayValue(record.results);
	const filteredRows = searchRows(allRows, { includeTests });
	const rows = filteredRows.slice(0, limit);
	const hiddenRows = includeTests ? 0 : allRows.length - filteredRows.length;
	const visibleRows = filteredRows.length;
	const grepTotal = numberField(record.total_grep_matches);
	const lines = [`results: ${rows.length}`];
	if (hiddenRows > 0) {
		lines.push(`hidden tests: ${hiddenRows} (use --include-tests)`);
	}
	if (grepTotal !== null) {
		lines.push(`grep matches: ${grepTotal}`);
	}
	if (rows.length === 0) {
		lines.push("  none");
		return lines.join("\n");
	}
	for (const item of rows) {
		lines.push(...renderSearchRow(item));
	}
	if (visibleRows > rows.length) {
		lines.push("- ...");
	}
	return lines.join("\n");
}

/** Renders compact CodebaseMemory search_graph rows. */
function renderCodebaseMemoryGraphSearch(
	value: unknown,
	options: BackendGraphRenderOptions & { limit: number },
): string {
	const { includeTests = false, limit } = options;
	const record = recordValue(value);
	const { allRows, testFilteredRows, filteredRows } = graphSearchRows(
		value,
		options,
	);
	const rows = filteredRows.slice(0, limit);
	const hiddenTestRows = includeTests
		? 0
		: allRows.length - testFilteredRows.length;
	const hiddenFilterRows = testFilteredRows.length - filteredRows.length;
	const lines = [
		`mode: ${stringField(record.search_mode) ?? "graph"}`,
		`results: ${rows.length}`,
	];
	if (hiddenTestRows > 0) {
		lines.push(`hidden tests: ${hiddenTestRows} (use --include-tests)`);
	}
	if (hiddenFilterRows > 0) {
		lines.push(`hidden filtered: ${hiddenFilterRows}`);
	}
	if (rows.length === 0) {
		lines.push("  none");
		return lines.join("\n");
	}
	for (const item of rows) {
		lines.push(...renderSearchRow(item));
	}
	if (record.has_more) {
		lines.push("- ...");
	} else if (filteredRows.length > rows.length) {
		lines.push("- ...");
	}
	return lines.join("\n");
}

/** Returns whether graph search has rows visible after CLI-side filters. */
function hasVisibleGraphSearchRows(
	value: unknown,
	options: BackendGraphRenderOptions,
): boolean {
	return graphSearchRows(value, options).filteredRows.length > 0;
}

/** Applies test and graph filters to backend graph search rows. */
function graphSearchRows(
	value: unknown,
	options: BackendGraphRenderOptions,
): {
	allRows: unknown[];
	testFilteredRows: unknown[];
	filteredRows: unknown[];
} {
	const allRows = arrayValue(recordValue(value).results);
	const testFilteredRows = searchRows(allRows, options);
	const filteredRows = testFilteredRows.filter((row) =>
		graphSearchRowMatches(row, options),
	);
	return { allRows, testFilteredRows, filteredRows };
}

/** Checks output-side graph filters when the backend returns broader rows. */
function graphSearchRowMatches(
	value: unknown,
	options: BackendGraphRenderOptions,
): boolean {
	const row = recordValue(value);
	const nested = recordValue(row.node);
	const label = stringField(row.label) ?? stringField(nested.label);
	const name =
		stringField(row.name) ??
		stringField(row.node) ??
		stringField(nested.name) ??
		stringField(row.qualified_name) ??
		stringField(nested.qualified_name);
	const qualifiedName =
		stringField(row.qualified_name) ?? stringField(nested.qualified_name);
	const filePath =
		stringField(row.file) ??
		stringField(row.file_path) ??
		stringField(nested.file_path);
	const degree = graphSearchRowDegree(row, nested);
	return (
		matchesTextFilter(label, options.label, { exact: true }) &&
		matchesTextFilter(name, options.namePattern, { exact: false }) &&
		matchesTextFilter(qualifiedName, options.qnPattern, { exact: false }) &&
		matchesGlobFilter(filePath, options.filePattern) &&
		graphSearchRowMatchesRelationship(row, nested, options.relationship) &&
		(options.minDegree === undefined || degree >= options.minDegree) &&
		(options.maxDegree === undefined || degree <= options.maxDegree) &&
		(options.excludeEntryPoints !== true ||
			!graphSearchRowIsEntryPoint(row, nested))
	);
}

/** Reads a best-effort graph degree from common backend row shapes. */
function graphSearchRowDegree(
	row: Record<string, unknown>,
	nested: Record<string, unknown>,
): number {
	return (
		numberField(row.degree) ??
		numberField(nested.degree) ??
		sumDegreeFields(row) ??
		sumDegreeFields(nested) ??
		graphSearchRelationshipRows(row, nested).length
	);
}

/** Reads in/out graph degree fields when the backend exposes them separately. */
function sumDegreeFields(row: Record<string, unknown>): number | null {
	const inDegree = numberField(row.in_degree);
	const outDegree = numberField(row.out_degree);
	if (inDegree === null && outDegree === null) {
		return null;
	}
	return (inDegree ?? 0) + (outDegree ?? 0);
}

/** Checks backend graph rows against a requested relationship type. */
function graphSearchRowMatchesRelationship(
	row: Record<string, unknown>,
	nested: Record<string, unknown>,
	relationship: string | undefined,
): boolean {
	if (relationship === undefined) {
		return true;
	}
	return graphSearchRelationshipRows(row, nested).some(
		(candidate) => candidate === relationship,
	);
}

/** Extracts relationship labels from node, edge, and nested backend payload shapes. */
function graphSearchRelationshipRows(
	row: Record<string, unknown>,
	nested: Record<string, unknown>,
): string[] {
	const direct = [
		stringField(row.relationship),
		stringField(row.relationship_type),
		stringField(row.edge_type),
		stringField(nested.relationship),
		stringField(nested.relationship_type),
		stringField(nested.edge_type),
	];
	const relatedRows = [
		...arrayValue(row.relationships),
		...arrayValue(row.edges),
		...arrayValue(row.connected_edges),
		...arrayValue(nested.relationships),
		...arrayValue(nested.edges),
	];
	return uniqueStrings(
		[...direct, ...relatedRows.flatMap(relationshipNames)].filter(
			(item): item is string => item !== null,
		),
	);
}

/** Reads relationship names from one backend edge-like value. */
function relationshipNames(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	const record = recordValue(value);
	return [
		stringField(record.relationship),
		stringField(record.relationship_type),
		stringField(record.edge_type),
		stringField(record.type),
	].filter((item): item is string => item !== null);
}

/** Detects entrypoint-tagged backend rows for output-side filtering. */
function graphSearchRowIsEntryPoint(
	row: Record<string, unknown>,
	nested: Record<string, unknown>,
): boolean {
	const textFields = [
		stringField(row.label),
		stringField(row.kind),
		stringField(row.type),
		stringField(nested.label),
		stringField(nested.kind),
		stringField(nested.type),
		...arrayValue(row.tags).filter(
			(item): item is string => typeof item === "string",
		),
		...arrayValue(nested.tags).filter(
			(item): item is string => typeof item === "string",
		),
	].filter((item): item is string => item !== null);
	return textFields.some((item) => item.toLowerCase().startsWith("entry"));
}

/** Returns backend search rows after applying output-only filters. */
function searchRows(value: unknown, options: BackendRenderOptions): unknown[] {
	return arrayValue(value).filter(
		(item) => options.includeTests === true || !testLikeSearchRow(item),
	);
}

/** Renders one backend search row with stable score and location fields. */
function renderSearchRow(value: unknown): string[] {
	const row = recordValue(value);
	const nested = recordValue(row.node);
	const name =
		stringField(row.name) ??
		stringField(row.node) ??
		stringField(nested.name) ??
		stringField(row.qualified_name) ??
		stringField(nested.qualified_name);
	if (name === null) {
		return [];
	}
	const qualifiedName =
		stringField(row.qualified_name) ?? stringField(nested.qualified_name);
	const filePath =
		stringField(row.file) ??
		stringField(row.file_path) ??
		stringField(nested.file_path);
	const startLine =
		numberField(row.start_line) ?? numberField(nested.start_line);
	const endLine = numberField(row.end_line) ?? numberField(nested.end_line);
	const score =
		nonNegativeNumberField(row.rerank_score) ??
		nonNegativeNumberField(row.score) ??
		nonNegativeNonOrdinalRank(row.rank);
	const label = stringField(row.label) ?? stringField(nested.label);
	const degrees = degreeFacts(row);
	const detail = [
		label,
		filePath !== null
			? `${filePath}${startLine !== null ? `:${startLine}` : ""}${endLine !== null && endLine !== startLine ? `-${endLine}` : ""}`
			: null,
		score !== null ? `score=${formatScore(score)}` : null,
		...degrees,
	].filter((item) => item !== null);
	const lines = [
		`- ${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`,
	];
	if (qualifiedName !== null && qualifiedName !== name) {
		lines.push(`  ${qualifiedName}`);
	}
	const context = stringField(row.context);
	if (context !== null) {
		const contextLine = context.trim().split(/\r?\n/).find(Boolean);
		if (contextLine !== undefined) {
			lines.push(`  ${contextLine.trim()}`);
		}
	}
	return lines;
}

/** Detects likely test rows in common Codebase Memory search payload shapes. */
function testLikeSearchRow(value: unknown): boolean {
	const row = recordValue(value);
	const nested = recordValue(row.node);
	const text = [
		stringField(row.name),
		stringField(row.node),
		stringField(row.qualified_name),
		stringField(row.file),
		stringField(row.file_path),
		stringField(nested.name),
		stringField(nested.qualified_name),
		stringField(nested.file_path),
	]
		.filter((item) => item !== null)
		.join(" ");
	return /(^|[./_-])(__tests__|tests|specs)([./_-]|$)|(^|[./_-])test_[^/]*|[._-](test|spec)\.[cm]?[jt]sx?$|(^|[._-])test[A-Z_]/i.test(
		text,
	);
}

/** Over-fetches backend rows so default test suppression can still fill the limit. */
function backendFetchLimit(
	limit: number,
	{ includeTests = false }: BackendRenderOptions,
): number {
	return includeTests ? limit : Math.max(limit * 3, limit);
}

/** Renders graph degree facts when Codebase Memory includes them. */
function degreeFacts(row: Record<string, unknown>): string[] {
	return [
		numberField(row.in_degree) !== null
			? `in=${numberField(row.in_degree)}`
			: null,
		numberField(row.out_degree) !== null
			? `out=${numberField(row.out_degree)}`
			: null,
	].filter((item) => item !== null);
}

/** Renders CodebaseMemory architecture output as compact source orientation. */
export function renderCodebaseMemoryArchitectureSummary(
	value: unknown,
): string {
	const record = recordValue(value);
	const countFacts = [
		countFact("nodes", record.total_nodes),
		countFact("edges", record.total_edges),
	].filter((item) => item !== null);
	const lines = ["# CodebaseMemory Architecture", ""];
	lines.push(`project: ${stringField(record.project) ?? "unknown"}`);
	if (countFacts.length > 0) {
		lines.push(countFacts.join(", "));
	}
	appendNamedCountLine(lines, "languages", record.languages, "language");
	appendNamedCountLine(lines, "node labels", record.node_labels, "label");
	appendNamedCountLine(lines, "edge types", record.edge_types, "type");
	appendSparseSymbolNote(lines, record.node_labels);
	appendHotspots(lines, record.hotspots);
	appendClusters(lines, record.clusters);
	appendEntryPoints(lines, record.entry_points);
	return lines.join("\n");
}

/** Adds one comma-separated named count line when backend rows exist. */
function appendNamedCountLine(
	lines: string[],
	label: string,
	value: unknown,
	nameKey: string,
): void {
	const facts = arrayValue(value)
		.slice(0, 6)
		.map((item) => namedCountFact(item, nameKey))
		.filter((item) => item !== null);
	if (facts.length > 0) {
		lines.push(`${label}: ${facts.join(", ")}`);
	}
}

/** Adds the highest fan-in backend hotspots. */
function appendHotspots(lines: string[], value: unknown): void {
	const allRows = arrayValue(value);
	const genericCount = allRows.filter((item) => {
		const row = recordValue(item);
		const name = stringField(row.name) ?? stringField(row.qualified_name);
		return name !== null && genericBackendName(name);
	}).length;
	const hotspots = allRows
		.filter((item) => {
			const row = recordValue(item);
			const name = stringField(row.name) ?? stringField(row.qualified_name);
			return name !== null && !genericBackendName(name);
		})
		.slice(0, 6)
		.map((item) => {
			const row = recordValue(item);
			const name = stringField(row.name) ?? stringField(row.qualified_name);
			if (name === null) {
				return null;
			}
			const fanIn = numberField(row.fan_in);
			const file = stringField(row.file);
			const qualifiedName = stringField(row.qualified_name);
			const location = file ?? qualifiedNameSuffix(qualifiedName, name);
			const facts = [
				fanIn !== null ? `fan-in ${fanIn}` : null,
				location,
			].filter((fact) => fact !== null);
			return `- ${name}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`;
		})
		.filter((item) => item !== null);
	if (hotspots.length === 0) {
		return;
	}
	lines.push("");
	lines.push(
		`## Hotspots${genericCount > 0 ? ` (hidden generic: ${genericCount})` : ""}`,
	);
	lines.push(...hotspots);
}

/** Adds compact backend cluster summaries without member dumps. */
function appendClusters(lines: string[], value: unknown): void {
	const clusters = arrayValue(value)
		.slice(0, 5)
		.map((item) => {
			const row = recordValue(item);
			const label =
				stringField(row.label) ?? `cluster ${numberField(row.id) ?? "?"}`;
			const members = numberField(row.members);
			const cohesion = numberField(row.cohesion);
			const topNodes = uniqueStrings(
				arrayValue(row.top_nodes)
					.map((node) => stringField(node))
					.filter(
						(node): node is string =>
							node !== null && !genericBackendName(node),
					),
			).slice(0, 4);
			const facts = [
				members !== null ? `${members} nodes` : null,
				cohesion !== null ? `cohesion=${formatScore(cohesion)}` : null,
				topNodes.length > 0 ? `top: ${topNodes.join(", ")}` : null,
			].filter((fact) => fact !== null);
			return `- ${label}${facts.length > 0 ? ` (${facts.join("; ")})` : ""}`;
		});
	if (clusters.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Clusters");
	lines.push(...clusters);
}

/** Adds a note when Codebase Memory indexed only coarse file/module nodes. */
function appendSparseSymbolNote(lines: string[], nodeLabels: unknown): void {
	const labels = new Map(
		arrayValue(nodeLabels).map((item) => {
			const row = recordValue(item);
			return [stringField(row.label), numberField(row.count) ?? 0] as const;
		}),
	);
	const symbolCount =
		(labels.get("Function") ?? 0) +
		(labels.get("Class") ?? 0) +
		(labels.get("Method") ?? 0);
	if (symbolCount > 0) {
		return;
	}
	lines.push(
		"note: no function/class/method nodes; summary is file-level only.",
	);
}

/** Adds likely backend entry points when the architecture payload includes them. */
function appendEntryPoints(lines: string[], value: unknown): void {
	const entries = arrayValue(value)
		.slice(0, 6)
		.map((item) => {
			const row = recordValue(item);
			const name = stringField(row.name) ?? stringField(row.qualified_name);
			if (name === null) {
				return null;
			}
			const file = stringField(row.file);
			return `- ${name}${file !== null ? `, ${file}` : ""}`;
		})
		.filter((item) => item !== null);
	if (entries.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Entry Points");
	lines.push(...entries);
}

/** Renders a backend named count row. */
function namedCountFact(value: unknown, nameKey: string): string | null {
	const row = recordValue(value);
	const name = stringField(row[nameKey]) ?? stringField(row.name);
	if (name === null) {
		return null;
	}
	const count = numberField(row.count) ?? numberField(row.file_count);
	return count === null ? name : `${name} ${count}`;
}

/** Renders a numeric count field. */
function countFact(label: string, value: unknown): string | null {
	const count = numberField(value);
	return count === null ? null : `${label}: ${count}`;
}

/** Builds a short disambiguating suffix from a backend qualified name. */
function qualifiedNameSuffix(
	qualifiedName: string | null,
	name: string,
): string | null {
	if (qualifiedName === null || qualifiedName === name) {
		return null;
	}
	const parts = qualifiedName.split(".").filter(Boolean);
	return parts.length > 1 ? parts.slice(-4).join(".") : qualifiedName;
}

/** Deduplicates strings while preserving backend rank order. */
function uniqueStrings(values: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const value of values) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		unique.push(value);
	}
	return unique;
}

/** Renders CodebaseMemory status lines. */
export function renderCodebaseMemoryStatus(
	result: CodebaseMemoryStatusResult,
): string {
	const lines = [
		`CodebaseMemory index: ${result.projectName}`,
		`status: ${result.status}`,
		`nodes: ${result.nodes ?? "unknown"}`,
		`edges: ${result.edges ?? "unknown"}`,
	];
	if (result.schemaNodeLabels !== null && result.schemaEdgeTypes !== null) {
		lines.push(
			`schema: ${result.schemaNodeLabels} node labels, ${result.schemaEdgeTypes} edge types`,
		);
	}
	return lines.join("\n");
}

/** Renders an explicit CodebaseMemory refresh result with elapsed time. */
export function renderCodebaseMemoryIndex(
	result: CodebaseMemoryIndexResult,
): string {
	return [
		"CodebaseMemory refresh complete",
		`elapsed: ${formatElapsedMs(result.elapsedMs)}`,
		renderCodebaseMemoryStatus(result),
	].join("\n");
}

/** Renders CodebaseMemory semantic graph search rows. */
function renderCodebaseMemorySemanticSearch(
	value: unknown,
	{ includeTests = false, limit }: BackendRenderOptions & { limit: number },
): string {
	const record = recordValue(value);
	const allRows = arrayValue(record.semantic_results);
	const filteredRows = searchRows(allRows, { includeTests });
	const rows = filteredRows.slice(0, limit);
	const hiddenRows = includeTests ? 0 : allRows.length - filteredRows.length;
	const visibleRows = filteredRows.length;
	const lines = [
		`mode: ${stringField(record.search_mode) ?? "semantic"}`,
		`semantic results: ${rows.length}`,
	];
	if (hiddenRows > 0) {
		lines.push(`hidden tests: ${hiddenRows} (use --include-tests)`);
	}
	if (rows.length === 0) {
		lines.push("  none");
		return lines.join("\n");
	}
	for (const item of rows) {
		const row = recordValue(item);
		const name = stringField(row.name) ?? stringField(row.qualified_name);
		if (name === null) {
			continue;
		}
		const label = stringField(row.label);
		const filePath = stringField(row.file_path);
		const score = numberField(row.score);
		const detail = [
			label,
			filePath,
			score !== null ? `score=${formatScore(score)}` : null,
		].filter((item) => item !== null);
		lines.push(
			`- ${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`,
		);
		const qualifiedName = stringField(row.qualified_name);
		if (qualifiedName !== null && qualifiedName !== name) {
			lines.push(`  ${qualifiedName}`);
		}
	}
	if (record.has_more) {
		lines.push("- ...");
	} else if (visibleRows > rows.length) {
		lines.push("- ...");
	}
	return lines.join("\n");
}

/** Renders CodebaseMemory trace_path output without exposing raw JSON by default. */
function renderCodebaseMemoryTrace(
	value: unknown,
	{ limit }: { limit: number },
): string {
	const record = recordValue(value);
	const functionName =
		stringField(record.function) ??
		stringField(record.function_name) ??
		"unknown";
	const excluded = excludedTraceNames([functionName]);
	const lines = [
		`function: ${functionName}`,
		`mode: ${stringField(record.mode) ?? "calls"}`,
		`direction: ${stringField(record.direction) ?? "both"}`,
	];
	appendTraceSection(lines, "Callers", record.callers, excluded, { limit });
	appendTraceSection(lines, "Callees", record.callees, excluded, { limit });
	appendTraceSection(lines, "Paths", tracePaths(record), excluded, { limit });
	if (lines.length === 3) {
		lines.push("  none");
	}
	return lines.join("\n");
}

/** Adds a trace section when rows exist. */
function appendTraceSection(
	lines: string[],
	title: string,
	value: unknown,
	excluded: Set<string>,
	{ limit }: { limit: number },
): void {
	const allRows = uniqueTextRows(
		arrayValue(value)
			.map((item) => traceRow(item, excluded))
			.filter((item) => item !== null),
	);
	const specificRows = allRows.filter((row) => !genericTraceRow(row));
	const rows = specificRows.slice(0, limit);
	const hiddenGeneric = allRows.length - specificRows.length;
	if (rows.length === 0) {
		return;
	}
	lines.push(
		`${title}: ${rows.length}${hiddenGeneric > 0 ? ` (hidden generic: ${hiddenGeneric})` : ""}`,
	);
	for (const row of rows) {
		lines.push(`- ${row}`);
	}
	if (specificRows.length > rows.length) {
		lines.push("- ...");
	}
}

/** Deduplicates printed text rows while preserving first-seen order. */
function uniqueTextRows(rows: string[]): string[] {
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

/** Reads path-like trace rows from common backend shapes. */
function tracePaths(record: Record<string, unknown>): unknown[] {
	return [
		...arrayValue(record.paths),
		...arrayValue(record.call_paths),
		...arrayValue(record.traces),
		...arrayValue(record.results),
	];
}

/** Renders one caller, callee, or path row. */
function traceRow(value: unknown, excluded: Set<string>): string | null {
	const record = recordValue(value);
	const name =
		stringField(record.name) ??
		stringField(record.qualified_name) ??
		edgeText(record);
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
	const risk = stringField(record.risk);
	const facts = [
		hop !== null ? `hop ${hop}` : null,
		risk !== null ? risk.toLowerCase() : null,
	].filter((item) => item !== null);
	return facts.length > 0 ? `${name} (${facts.join(", ")})` : name;
}

/** Detects generic low-level trace rows that rarely help source navigation. */
function genericTraceRow(value: string): boolean {
	return genericBackendName(value);
}

/** Detects generic backend names that should not dominate summary slots. */
function genericBackendName(value: string): boolean {
	const name =
		value
			.replace(/\s+\(.*/, "")
			.split(".")
			.pop() ?? value;
	return GENERIC_BACKEND_NAMES.has(name);
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

/** Formats a from/to edge row when trace output uses path records. */
function edgeText(record: Record<string, unknown>): string | null {
	const from = stringField(record.from) ?? stringField(record.source);
	const to = stringField(record.to) ?? stringField(record.target);
	if (from === null || to === null) {
		return null;
	}
	return `${from} -> ${to}`;
}

/** Renders CodebaseMemory projects from list_projects with the active root first. */
function renderCodebaseMemoryProjects(
	value: unknown,
	currentRoot: string,
): string {
	const projects = arrayValue(recordValue(value).projects)
		.map(projectRecord)
		.filter((project) => project !== null);
	const currentProject = projects.find(
		(project) => project.root === currentRoot,
	);
	const otherProjects = projects.filter(
		(project) =>
			project !== currentProject && !ephemeralProjectRoot(project.root),
	);
	const hiddenEphemeral =
		projects.length -
		otherProjects.length -
		(currentProject === undefined ? 0 : 1);
	const shownOthers = otherProjects.slice(0, 8);
	const lines = [
		`CodebaseMemory projects: ${projects.length}${hiddenEphemeral > 0 ? ` (hidden work: ${hiddenEphemeral})` : ""}`,
	];
	if (currentProject !== undefined) {
		lines.push(`current: ${projectRow(currentProject)}`);
	}
	if (shownOthers.length > 0) {
		lines.push("other projects:");
		lines.push(...shownOthers.map((project) => `- ${projectRow(project)}`));
	}
	if (otherProjects.length > shownOthers.length) {
		lines.push(`- ... ${otherProjects.length - shownOthers.length} more`);
	}
	return lines.join("\n");
}

/** Normalizes one list_projects row. */
function projectRecord(value: unknown): {
	name: string;
	root: string | null;
	nodes: number | null;
	edges: number | null;
} | null {
	const project = recordValue(value);
	const name = stringField(project.name);
	if (name === null) {
		return null;
	}
	return {
		name,
		root: stringField(project.root_path),
		nodes: numberField(project.nodes),
		edges: numberField(project.edges),
	};
}

/** Renders one project row without raw JSON. */
function projectRow(project: {
	name: string;
	root: string | null;
	nodes: number | null;
	edges: number | null;
}): string {
	const detail = [
		project.root,
		project.nodes !== null ? `nodes=${project.nodes}` : null,
		project.edges !== null ? `edges=${project.edges}` : null,
	].filter((item) => item !== null);
	return `${project.name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
}

/** Hides stale test work indexes from normal project listing output. */
function ephemeralProjectRoot(root: string | null): boolean {
	return root !== null && /[/\\]test[/\\]\.work[/\\]/.test(root);
}

/** Renders CodebaseMemory schema labels and edge types. */
function renderCodebaseMemorySchema(value: unknown): string {
	const record = recordValue(value);
	const nodeLabels = arrayValue(record.node_labels);
	const edgeTypes = arrayValue(record.edge_types);
	return [
		`CodebaseMemory schema: ${nodeLabels.length} node labels, ${edgeTypes.length} edge types`,
		...nodeLabels.map((item) => `- node: ${schemaRow(item)}`),
		...edgeTypes.map((item) => `- edge: ${schemaRow(item)}`),
	].join("\n");
}

/** Renders one schema count row from object or string payloads. */
function schemaRow(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	const record = recordValue(value);
	const name =
		stringField(record.label) ?? stringField(record.type) ?? "unknown";
	const count = numberField(record.count);
	return count === null ? name : `${name} (${count})`;
}

/** Renders arbitrary CodebaseMemory query rows compactly. */
function renderRows(value: unknown): string {
	const record = recordValue(value);
	const rows =
		arrayValue(record.rows).length > 0
			? arrayValue(record.rows)
			: arrayValue(record.results);
	const total = numberField(record.total) ?? rows.length;
	const renderedRows = uniqueRenderedRows(rows.map((row) => rowValueText(row)));
	const hiddenDuplicates = rows.length - renderedRows.length;
	const lines = [
		`CodebaseMemory query rows: ${total}${hiddenDuplicates > 0 ? ` (hidden duplicates: ${hiddenDuplicates})` : ""}`,
	];
	for (const row of renderedRows) {
		lines.push(`- ${row}`);
	}
	if (renderedRows.length === 0) {
		lines.push("  none");
	}
	return lines.join("\n");
}

/** Deduplicates already rendered backend query rows. */
function uniqueRenderedRows(rows: string[]): string[] {
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

/** Renders one query row without noisy JSON for scalar or single-column rows. */
function rowValueText(value: unknown): string {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return scalarRowText(value);
	}
	const values = arrayValue(value);
	if (values.length === 1) {
		return rowValueText(values[0]);
	}
	if (values.length > 1) {
		return values.map(rowValueText).join(" | ");
	}
	return JSON.stringify(value);
}

/** Renders scalar query values while decoding JSON-encoded backend cells. */
function scalarRowText(value: string | number | boolean): string {
	if (typeof value !== "string") {
		return String(value);
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
		return value;
	}
	try {
		return rowValueText(JSON.parse(trimmed));
	} catch {
		return value;
	}
}

/** Renders CodebaseMemory changed-code impact output. */
function renderCodebaseMemoryChanges(value: unknown): string {
	const record = recordValue(value);
	const lines = ["CodebaseMemory changed-code impact:"];
	const changedFiles = arrayValue(record.changed_files).filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
	if (changedFiles.length > 0) {
		lines.push(`changed files: ${changedFiles.length}`);
		appendJsonRows(lines, changedFiles, (item) => item);
	}
	const impactedSymbols = arrayValue(record.impacted_symbols);
	if (impactedSymbols.length > 0) {
		lines.push(`impacted symbols: ${impactedSymbols.length}`);
		appendJsonRows(lines, impactedSymbols, symbolImpactRow);
	}
	const rows = [
		...arrayValue(record.changes),
		...arrayValue(record.impacts),
		...arrayValue(record.results),
	];
	if (rows.length === 0) {
		if (changedFiles.length === 0 && impactedSymbols.length === 0) {
			lines.push("none");
			const depth = numberField(record.depth);
			if (depth !== null) {
				lines.push(`depth: ${depth}`);
			}
		}
		return lines.join("\n");
	}
	appendJsonRows(lines, rows, (row) => JSON.stringify(row));
	return lines.join("\n");
}

/** Appends a bounded list of JSON-derived rows. */
function appendJsonRows<T>(
	lines: string[],
	rows: T[],
	render: (row: T) => string,
): void {
	const shown = rows.slice(0, 20);
	for (const row of shown) {
		lines.push(`- ${render(row)}`);
	}
	if (rows.length > shown.length) {
		lines.push("- ...");
	}
}

/** Renders one impacted symbol row from detect_changes. */
function symbolImpactRow(value: unknown): string {
	const record = recordValue(value);
	const name = stringField(record.name) ?? JSON.stringify(value);
	const label = stringField(record.label);
	const file = stringField(record.file);
	const detail = [label, file].filter((item) => item !== null);
	return `${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`;
}

/** Renders a compact backend-first inspect report. */
export function renderCodebaseMemoryInspect(
	result: CodebaseMemoryInspectResult,
	{ limit }: { limit: number },
): string {
	const lines = [
		`# Inspect: ${result.name}`,
		"",
		"Backend: Codebase Memory",
		`Qualified: ${result.qualifiedName}`,
	];
	if (result.filePath !== null) {
		lines.push(
			`Source: ${result.filePath}${result.startLine !== null ? `:${result.startLine}` : ""}${result.endLine !== null && result.endLine !== result.startLine ? `-${result.endLine}` : ""}`,
		);
	}
	appendCodebaseMemoryMatchLines(lines, result);
	appendCodebaseMemorySignalLines(lines, result.signalFacts);
	appendCodebaseMemoryCode(lines, result, { limit });
	appendCodebaseMemoryTrace(lines, result, { limit });
	appendCodebaseMemoryGraphNeighbors(lines, result.graphNeighbors, { limit });
	appendCodebaseMemoryRelated(lines, result.related, { limit });
	return lines.join("\n").trim();
}

/** Adds backend graph match rank and node metadata. */
function appendCodebaseMemoryMatchLines(
	lines: string[],
	result: CodebaseMemoryInspectResult,
): void {
	const matchFacts = [
		result.matchRank !== null ? `rank=${result.matchRank}` : null,
		result.matchScore !== null
			? `score=${formatScore(result.matchScore)}`
			: null,
		...result.graphFacts,
	].filter((item) => item !== null);
	if (matchFacts.length === 0) {
		return;
	}
	lines.push(`Match: ${matchFacts.join(", ")}`);
}

/** Adds compact complexity and graph degree facts from a snippet payload. */
function appendCodebaseMemorySignalLines(
	lines: string[],
	facts: string[],
): void {
	if (facts.length === 0) {
		return;
	}
	lines.push(`Signals: ${facts.join(", ")}`);
}

/** Adds a concise source section from Codebase Memory snippet payloads. */
function appendCodebaseMemoryCode(
	lines: string[],
	result: CodebaseMemoryInspectResult,
	{ limit }: { limit: number },
): void {
	if (result.signature === null && result.source === null) {
		return;
	}
	lines.push("");
	lines.push("## Code");
	if (result.signature !== null) {
		lines.push(`Signature: ${result.signature}`);
	}
	if (result.source === null) {
		return;
	}
	const sourceLines = result.source.trimEnd().split("\n");
	const shownLines = sourceLines.slice(0, Math.max(limit * 4, 12));
	lines.push("");
	lines.push(`\`\`\`${codeFenceLanguage(result.filePath)}`);
	lines.push(...shownLines);
	if (sourceLines.length > shownLines.length) {
		lines.push(`// ... ${sourceLines.length - shownLines.length} more lines`);
	}
	lines.push("```");
}

/** Adds compact caller and callee rows from Codebase Memory traces. */
function appendCodebaseMemoryTrace(
	lines: string[],
	result: CodebaseMemoryInspectResult,
	{ limit }: { limit: number },
): void {
	const callers = result.callers.slice(0, limit);
	const callees = result.callees.slice(0, limit);
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

/** Adds graph-neighborhood rows supplied by Codebase Memory search. */
function appendCodebaseMemoryGraphNeighbors(
	lines: string[],
	neighbors: string[],
	{ limit }: { limit: number },
): void {
	const shown = neighbors.slice(0, limit);
	if (shown.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Graph Neighborhood");
	for (const item of shown) {
		lines.push(`- ${item}`);
	}
	if (neighbors.length > shown.length) {
		lines.push("- ...");
	}
}

/** Adds a short next-read list from trace and snippet neighbors. */
function appendCodebaseMemoryRelated(
	lines: string[],
	related: string[],
	{ limit }: { limit: number },
): void {
	const shown = related.slice(0, limit);
	if (shown.length === 0) {
		return;
	}
	lines.push("");
	lines.push("## Next Reads");
	for (const item of shown) {
		lines.push(`- ${item}`);
	}
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

/** Formats backend confidence scores without noisy floating-point tails. */
function formatScore(value: number): string {
	return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Formats elapsed milliseconds for human CLI output. */
function formatElapsedMs(value: number): string {
	if (value < 1000) {
		return `${value.toFixed(1)} ms`;
	}
	return `${(value / 1000).toFixed(2)} s`;
}

/** Reads object records while rejecting arrays and primitives. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads arrays while rejecting other values. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads string fields while rejecting empty values. */
function stringField(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads number fields while rejecting other values. */
function numberField(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

/** Reads a nonnegative numeric score while rejecting backend cost/rank values. */
function nonNegativeNumberField(value: unknown): number | null {
	const parsed = numberField(value);
	return parsed !== null && parsed >= 0 ? parsed : null;
}

/** Reads score-like rank fields without treating ordinal ranks as confidence scores. */
function nonNegativeNonOrdinalRank(value: unknown): number | null {
	const parsed = nonNegativeNumberField(value);
	return parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)
		? parsed
		: null;
}
