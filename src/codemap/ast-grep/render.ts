/** Formats ast-grep matches and rewrites for text and JSON output. */
import type { SyntaxMatch, SyntaxRewriteResult } from "./adapter.js";

/** Prints syntax matches as text or JSON. */
export function printSyntaxMatches(
	matches: SyntaxMatch[],
	{ jsonOutput }: { jsonOutput: boolean },
): void {
	if (jsonOutput) {
		console.log(pythonJsonDumps(matches.map((match) => matchJson(match))));
		return;
	}
	for (const match of matches) {
		const lines = match.text.trimEnd().split(/\r?\n/);
		const text = lines.length > 1 ? `${lines[0] ?? ""} ...` : (lines[0] ?? "");
		console.log(`${match.filePath}:${match.line}:${match.column}: ${text}`);
	}
}

/** Prints syntax rewrite results as text or JSON. */
export function printRewriteResults(
	results: SyntaxRewriteResult[],
	{
		fullOutput = false,
		jsonOutput = false,
	}: { fullOutput?: boolean; jsonOutput?: boolean } = {},
): void {
	if (jsonOutput) {
		console.log(pythonJsonDumps(results.map((result) => rewriteJson(result))));
		return;
	}
	for (const result of results) {
		const suffix = result.matchCount !== 1 ? "es" : "";
		console.log(`# ${result.filePath}: ${result.matchCount} match${suffix}`);
		console.log(rewritePreviewText(result, { fullOutput }));
	}
}

/** Serializes one syntax match for JSON output. */
export function matchJson(match: SyntaxMatch): Record<string, unknown> {
	return {
		text: match.text,
		range: {
			start: { line: match.line - 1, column: match.column - 1 },
			end: { line: match.endLine - 1, column: match.endColumn - 1 },
		},
		file: match.filePath,
		lines: match.lines,
		language: "ast-grep",
	};
}

/** Serializes one syntax rewrite result for JSON output. */
export function rewriteJson(
	result: SyntaxRewriteResult,
): Record<string, unknown> {
	return {
		file: result.filePath,
		matchCount: result.matchCount,
		text: result.text,
		language: "ast-grep",
	};
}

/** Formats rewrite output as full text or compact changed-line hunks. */
function rewritePreviewText(
	result: SyntaxRewriteResult,
	{ fullOutput }: { fullOutput: boolean },
): string {
	if (fullOutput || result.previewText === undefined) {
		return result.text.trimEnd();
	}
	return result.previewText;
}

/** Formats JS values as Python literals for ast-grep snippets. */
function pythonJsonDumps(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => pythonJsonDumps(item)).join(", ")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.map(([key, item]) => `${JSON.stringify(key)}: ${pythonJsonDumps(item)}`)
			.join(", ")}}`;
	}
	return JSON.stringify(value);
}
