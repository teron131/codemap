/** Renders normalized CodebaseMemory backend results for Codemap commands. */
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

/** Prints graph-augmented CodebaseMemory source search results when available. */
export function printCodebaseMemorySearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const result = codebaseMemorySearch(root, searchText, limit);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory code matches:");
	console.log(renderCodebaseMemoryCodeSearch(result, { limit }));
	return true;
}

/** Prints CodebaseMemory graph search results for relationship-oriented search when available. */
export function printCodebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
	options: CodebaseMemoryGraphSearchOptions = {},
): boolean {
	const result = codebaseMemoryGraphSearch(root, searchText, limit, options);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory graph matches:");
	console.log(renderCodebaseMemoryGraphSearch(result, { limit }));
	return true;
}

/** Prints CodebaseMemory semantic graph matches for semantic search when available. */
export function printCodebaseMemorySemanticSearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const result = codebaseMemorySemanticSearch(root, searchText, limit);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory semantic matches:");
	console.log(renderCodebaseMemorySemanticSearch(result, { limit }));
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
		...options
	}: CodebaseMemoryTraceOptions & { jsonOutput?: boolean } = {},
): boolean {
	const result = codebaseMemoryCallTrace(root, name, options);
	if (result === null) {
		return false;
	}
	if (jsonOutput) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log("CodebaseMemory call trace:");
		console.log(renderCodebaseMemoryTrace(result));
	}
	return true;
}

/** Prints indexed CodebaseMemory projects. */
export function printCodebaseMemoryProjects(root: string): boolean {
	const result = codebaseMemoryProjects(root);
	if (result === null) {
		return false;
	}
	console.log(renderCodebaseMemoryProjects(result));
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
	console.log("# CodebaseMemory Architecture");
	console.log("");
	console.log(JSON.stringify(result, null, 2));
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
	{ limit }: { limit: number },
): string {
	const record = recordValue(value);
	const rows = arrayValue(record.results).slice(0, limit);
	const total = numberField(record.total_results) ?? rows.length;
	const grepTotal = numberField(record.total_grep_matches);
	const lines = [`results: ${total}`];
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
	if (total > rows.length) {
		lines.push("- ...");
	}
	return lines.join("\n");
}

/** Renders compact CodebaseMemory search_graph rows. */
function renderCodebaseMemoryGraphSearch(
	value: unknown,
	{ limit }: { limit: number },
): string {
	const record = recordValue(value);
	const rows = arrayValue(record.results).slice(0, limit);
	const total = numberField(record.total) ?? numberField(record.total_results);
	const lines = [
		`mode: ${stringField(record.search_mode) ?? "graph"}`,
		`results: ${total ?? rows.length}`,
	];
	if (rows.length === 0) {
		lines.push("  none");
		return lines.join("\n");
	}
	for (const item of rows) {
		lines.push(...renderSearchRow(item));
	}
	if (record.has_more) {
		lines.push("- ...");
	}
	return lines.join("\n");
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
		numberField(row.rerank_score) ??
		numberField(row.score) ??
		numberField(row.rank);
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
	{ limit }: { limit: number },
): string {
	const record = recordValue(value);
	const rows = arrayValue(record.semantic_results).slice(0, limit);
	const total = numberField(record.semantic_total) ?? rows.length;
	const lines = [
		`mode: ${stringField(record.search_mode) ?? "semantic"}`,
		`semantic results: ${total}`,
	];
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
	}
	return lines.join("\n");
}

/** Renders CodebaseMemory trace_path output without exposing raw JSON by default. */
function renderCodebaseMemoryTrace(value: unknown): string {
	const record = recordValue(value);
	const lines = [
		`function: ${stringField(record.function) ?? stringField(record.function_name) ?? "unknown"}`,
		`mode: ${stringField(record.mode) ?? "calls"}`,
		`direction: ${stringField(record.direction) ?? "both"}`,
	];
	appendTraceSection(lines, "Callers", record.callers);
	appendTraceSection(lines, "Callees", record.callees);
	appendTraceSection(lines, "Paths", tracePaths(record));
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
): void {
	const rows = arrayValue(value)
		.map(traceRow)
		.filter((item) => item !== null);
	if (rows.length === 0) {
		return;
	}
	lines.push(`${title}: ${rows.length}`);
	for (const row of rows) {
		lines.push(`- ${row}`);
	}
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
function traceRow(value: unknown): string | null {
	const record = recordValue(value);
	const name =
		stringField(record.name) ??
		stringField(record.qualified_name) ??
		edgeText(record);
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

/** Renders CodebaseMemory projects from list_projects. */
function renderCodebaseMemoryProjects(value: unknown): string {
	const projects = arrayValue(recordValue(value).projects);
	const lines = [`CodebaseMemory projects: ${projects.length}`];
	for (const item of projects) {
		const project = recordValue(item);
		const name = stringField(project.name);
		if (name === null) {
			continue;
		}
		const root = stringField(project.root_path);
		const nodes = numberField(project.nodes);
		const edges = numberField(project.edges);
		const detail = [
			root,
			nodes !== null ? `nodes=${nodes}` : null,
			edges !== null ? `edges=${edges}` : null,
		].filter((item) => item !== null);
		lines.push(
			`- ${name}${detail.length > 0 ? ` (${detail.join(", ")})` : ""}`,
		);
	}
	return lines.join("\n");
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
	const lines = [`CodebaseMemory query rows: ${total}`];
	for (const row of rows) {
		lines.push(`- ${rowValueText(row)}`);
	}
	if (rows.length === 0) {
		lines.push("  none");
	}
	return lines.join("\n");
}

/** Renders one query row without noisy JSON for scalar or single-column rows. */
function rowValueText(value: unknown): string {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
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
			lines.push(JSON.stringify(value, null, 2));
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
