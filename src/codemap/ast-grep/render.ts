/** Formats ast-grep matches for text and JSON output. */
import type { SyntaxMatch } from "./adapter.js";

/** Prints syntax matches as text or JSON. */
export function printSyntaxMatches(
	matches: SyntaxMatch[],
	{ jsonOutput }: { jsonOutput: boolean },
): void {
	if (jsonOutput) {
		console.log(JSON.stringify(matches.map((match) => matchJson(match))));
		return;
	}
	for (const match of matches) {
		const lines = match.text.trimEnd().split(/\r?\n/);
		const text = lines.length > 1 ? `${lines[0] ?? ""} ...` : (lines[0] ?? "");
		const engine = match.engine === "regex" ? " [regex]" : "";
		console.log(
			`${match.filePath}:${match.line}:${match.column}${engine}: ${text}`,
		);
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
		engine: match.engine,
	};
}
