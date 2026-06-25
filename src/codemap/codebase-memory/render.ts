/** Renders normalized CodebaseMemory backend results for Codemap commands. */
import {
	type CodebaseMemoryIndexResult,
	type CodebaseMemoryInspectResult,
	type CodebaseMemoryStatusResult,
	codebaseMemoryArchitectureSummary,
	codebaseMemoryCallTrace,
	codebaseMemoryGraphSearch,
	codebaseMemoryIndex,
	codebaseMemoryInspect,
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
	console.log(JSON.stringify(result, null, 2));
	return true;
}

/** Prints CodebaseMemory graph search results for relationship-oriented search when available. */
export function printCodebaseMemoryGraphSearch(
	root: string,
	searchText: string,
	limit: number,
): boolean {
	const result = codebaseMemoryGraphSearch(root, searchText, limit);
	if (result === null) {
		return false;
	}
	console.log("\nCodebaseMemory graph matches:");
	console.log(JSON.stringify(result, null, 2));
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
	console.log(JSON.stringify(result, null, 2));
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
	{ jsonOutput = false }: { jsonOutput?: boolean } = {},
): boolean {
	const result = codebaseMemoryCallTrace(root, name);
	if (result === null) {
		return false;
	}
	if (jsonOutput) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log("CodebaseMemory call trace:");
		console.log(JSON.stringify(result, null, 2));
	}
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
