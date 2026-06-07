/** Combines ast-grep symbol hits and ripgrep text hits into source matches. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NapiConfig } from "@ast-grep/napi";

import {
	contextLines,
	ruleMatches,
	type SyntaxMatch,
	targetFiles,
} from "../ast-grep/index.js";

export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const SYMBOL_KINDS_BY_LANGUAGE: Record<string, string[]> = {
	typescript: [
		"function_declaration",
		"class_declaration",
		"lexical_declaration",
		"variable_declaration",
	],
	tsx: [
		"function_declaration",
		"class_declaration",
		"lexical_declaration",
		"variable_declaration",
	],
	javascript: [
		"function_declaration",
		"class_declaration",
		"lexical_declaration",
		"variable_declaration",
	],
	jsx: [
		"function_declaration",
		"class_declaration",
		"lexical_declaration",
		"variable_declaration",
	],
	python: ["function_definition", "class_definition", "assignment"],
};

export type SourceMatch = {
	engine: "ast-grep" | "rg";
	kind: string;
	filePath: string;
	line: number;
	column: number;
	text: string;
};

export type JsonMatchParser = (
	payload: Record<string, unknown>,
) => SourceMatch | null;

/** Searches source text and symbols across target files. */
export function sourceMatches(
	root: string,
	searchText: string,
	{ limit }: { limit: number },
): SourceMatch[] {
	const matches: SourceMatch[] = [];
	const seen = new Set<string>();
	if (IDENTIFIER_RE.test(searchText)) {
		for (const sourceMatch of astGrepSymbolMatches(root, searchText, {
			limit,
		})) {
			appendMatch(matches, seen, sourceMatch, { limit });
			if (matches.length >= limit) {
				return matches;
			}
		}
	}
	for (const sourceMatch of ripgrepMatches(root, searchText, {
		limit: limit - matches.length,
	})) {
		appendMatch(matches, seen, sourceMatch, { limit });
		if (matches.length >= limit) {
			break;
		}
	}
	return matches;
}

/** Finds likely symbol matches with ast-grep before rg fallback. */
export function astGrepSymbolMatches(
	root: string,
	symbol: string,
	{ limit }: { limit: number },
): SourceMatch[] {
	const matches: SourceMatch[] = [];
	for (const [language, kinds] of Object.entries(SYMBOL_KINDS_BY_LANGUAGE)) {
		const symbolMatches = ruleMatches(
			root,
			language,
			symbolMatchConfig(symbol, kinds),
			["."],
			{ limit: limit - matches.length },
		);
		if (symbolMatches === null) {
			if (language === "python") {
				matches.push(
					...pythonSymbolMatches(root, symbol, {
						limit: limit - matches.length,
					}),
				);
				return matches.slice(0, limit);
			}
			return matches;
		}
		for (const match of symbolMatches) {
			matches.push(astGrepMatch(match));
		}
		if (matches.length >= limit) {
			return matches;
		}
	}
	return matches;
}

/** Finds Python definitions or assignments that match a symbol name. */
export function pythonSymbolMatches(
	root: string,
	symbol: string,
	{ limit }: { limit: number },
): SourceMatch[] {
	const matches: SourceMatch[] = [];
	for (const filePath of targetFiles(root, ["."], "python")) {
		if (matches.length >= limit) {
			break;
		}
		let source = "";
		try {
			source = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		const sourceLines = source
			.replace(/\r\n/g, "\n")
			.replace(/\r/g, "\n")
			.split("\n");
		const relPath = filePathRelative(root, filePath);
		for (let index = 0; index < sourceLines.length; index += 1) {
			if (matches.length >= limit) {
				break;
			}
			const line = sourceLines[index] ?? "";
			const definition = pythonDefinitionMatch(line, symbol);
			if (definition !== null) {
				const endIndex = pythonBlockEnd(sourceLines, index, definition.indent);
				matches.push(
					astGrepMatch({
						filePath: relPath,
						text: sourceLines.slice(index, endIndex + 1).join("\n"),
						line: index + 1,
						column: definition.column,
						endLine: endIndex + 1,
						endColumn: (sourceLines[endIndex] ?? "").length + 1,
						lines: contextLines(sourceLines, index, endIndex),
					}),
				);
				continue;
			}
			const assignment = pythonAssignmentMatch(line, symbol);
			if (assignment !== null) {
				matches.push(
					astGrepMatch({
						filePath: relPath,
						text: line,
						line: index + 1,
						column: assignment.column,
						endLine: index + 1,
						endColumn: line.length + 1,
						lines: line,
					}),
				);
			}
		}
	}
	return matches;
}

/** Builds ast-grep patterns for function, class, and export symbol queries. */
export function symbolMatchConfig(symbol: string, kinds: string[]): NapiConfig {
	const escaped = escapeRegExp(symbol);
	return {
		rule: {
			any: kinds.map((kind) => ({
				kind,
				has: {
					kind: "identifier",
					regex: `^${escaped}$`,
				},
			})),
		},
	};
}

/** Finds ast-grep pattern matches for one source string. */
export function astGrepMatch(match: SyntaxMatch): SourceMatch {
	const text = (match.lines || match.text)
		.split(/\s+/)
		.filter(Boolean)
		.join(" ");
	return {
		engine: "ast-grep",
		kind: "symbol",
		filePath: match.filePath,
		line: match.line,
		column: match.column,
		text: text.slice(0, 240),
	};
}

/** Runs ripgrep and converts output to source match rows. */
export function ripgrepMatches(
	root: string,
	searchText: string,
	{ limit }: { limit: number },
): SourceMatch[] {
	if (limit <= 0) {
		return [];
	}
	return streamedJsonMatches(
		[
			"rg",
			"--json",
			"--fixed-strings",
			"--ignore-case",
			"--line-number",
			"--column",
			"--max-count",
			"2",
			"--max-columns",
			"240",
			"--glob",
			"!.context-graph/**",
			"--",
			searchText,
			".",
		],
		root,
		ripgrepMatch,
		{ limit },
	);
}

/** Parses streamed ripgrep JSON into source match rows. */
export function streamedJsonMatches(
	command: string[],
	root: string,
	parser: JsonMatchParser,
	{ limit }: { limit: number },
): SourceMatch[] {
	if (limit <= 0) {
		return [];
	}
	const result = spawnSync(command[0] ?? "", command.slice(1), {
		cwd: root,
		encoding: "utf8",
	});
	if (result.error || !result.stdout) {
		return [];
	}
	const matches: SourceMatch[] = [];
	for (const line of result.stdout.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		let sourceMatch: SourceMatch | null = null;
		try {
			sourceMatch = parser(JSON.parse(line));
		} catch {
			sourceMatch = null;
		}
		if (sourceMatch === null) {
			continue;
		}
		matches.push(sourceMatch);
		if (matches.length >= limit) {
			break;
		}
	}
	return matches;
}

/** Runs ripgrep for one query and returns the first text match. */
export function ripgrepMatch(
	rgEvent: Record<string, unknown>,
): SourceMatch | null {
	if (rgEvent.type !== "match") {
		return null;
	}
	const matchData = recordValue(rgEvent.data);
	const pathText = recordValue(matchData.path).text;
	const lineText = recordValue(matchData.lines).text;
	if (!pathText || !lineText) {
		return null;
	}
	const submatches = arrayValue(matchData.submatches);
	const firstSubmatch = recordValue(submatches[0]);
	const column = Number(firstSubmatch.start ?? 0) + 1;
	return {
		engine: "rg",
		kind: "text",
		filePath: String(pathText),
		line: Number(matchData.line_number ?? 0),
		column,
		text: String(lineText).split(/\s+/).filter(Boolean).join(" ").slice(0, 240),
	};
}

/** Adds a source match once while respecting the result limit. */
export function appendMatch(
	matches: SourceMatch[],
	seen: Set<string>,
	sourceMatch: SourceMatch,
	{ limit }: { limit: number },
): void {
	if (matches.length >= limit) {
		return;
	}
	const key = JSON.stringify([
		sourceMatch.filePath,
		sourceMatch.line,
		sourceMatch.text,
	]);
	if (seen.has(key)) {
		return;
	}
	seen.add(key);
	matches.push(sourceMatch);
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Escapes text for literal use inside regular expressions. */
function escapeRegExp(value: string): string {
	return value.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Locates a Python function, async function, or class definition line. */
function pythonDefinitionMatch(
	line: string,
	symbol: string,
): { indent: number; column: number } | null {
	const escaped = escapeRegExp(symbol);
	const match = new RegExp(
		`^(\\s*)(?:async\\s+def|def|class)\\s+${escaped}\\b`,
	).exec(line);
	if (!match) {
		return null;
	}
	const indent = match[1]?.length ?? 0;
	return { indent, column: indent + 1 };
}

/** Locates a Python assignment line for a requested symbol. */
function pythonAssignmentMatch(
	line: string,
	symbol: string,
): { column: number } | null {
	const escaped = escapeRegExp(symbol);
	const match = new RegExp(`^(\\s*)${escaped}\\s*(?::[^=]+)?=`).exec(line);
	if (!match) {
		return null;
	}
	return { column: (match[1]?.length ?? 0) + 1 };
}

/** Finds where a Python definition block ends by indentation. */
function pythonBlockEnd(
	lines: string[],
	startIndex: number,
	baseIndent: number,
): number {
	let endIndex = startIndex;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			endIndex = index;
			continue;
		}
		const indent = leadingWhitespaceLength(line);
		if (indent <= baseIndent) {
			break;
		}
		endIndex = index;
	}
	return endIndex;
}

/** Counts indentation characters before non-whitespace text. */
function leadingWhitespaceLength(value: string): number {
	return value.match(/^\s*/)?.[0].length ?? 0;
}

/** Returns a project-relative path when a file is inside the root. */
function filePathRelative(root: string, filePath: string): string {
	return filePath.startsWith(`${root}/`)
		? filePath.slice(root.length + 1)
		: filePath;
}
