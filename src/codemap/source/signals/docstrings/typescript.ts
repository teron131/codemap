/** Extracts TypeScript comments, signatures, classes, functions, and values. */
import { readFileSync } from "node:fs";

import type { FileReport } from "./models.js";

export const TYPESCRIPT_FUNCTION_DECL_RE =
	/^\s*(?:export\s+default\s+)?(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/gm;
export const TYPESCRIPT_ARROW_DECL_RE =
	/^\s*(?:export\s+default\s+)?(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*=>/gm;
export const TYPESCRIPT_CLASS_DECL_RE =
	/^\s*(?:export\s+default\s+)?(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm;
export const TYPESCRIPT_VALUE_DECL_RE =
	/^\s*(?:export\s+default\s+)?(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/gm;

type SeenFunctionKey = `${number}\0${string}`;

/** Calculates source offsets for every line start. */
export function lineStarts(source: string): number[] {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\n") {
			starts.push(index + 1);
		}
	}
	return starts;
}

/** Maps a source byte offset to a line index. */
export function lineIndexForOffset(starts: number[], offset: number): number {
	let low = 0;
	let high = starts.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if ((starts[mid] ?? 0) <= offset) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return Math.max(0, low - 1);
}

/** Normalizes a TypeScript block comment body. */
export function cleanBlockComment(lines: string[]): string {
	const cleanedLines: string[] = [];
	for (const line of lines) {
		let stripped = line.trim();
		stripped = removePrefix(removePrefix(stripped, "/**"), "/*");
		stripped = removeSuffix(stripped, "*/");
		if (stripped.startsWith("*")) {
			stripped = stripped.slice(1);
		}
		cleanedLines.push(stripped.trim());
	}
	return cleanedLines.filter(Boolean).join("\n").trim();
}

/** Normalizes a TypeScript line comment body. */
export function cleanLineComment(lines: string[]): string {
	return lines
		.filter((line) => line.trim())
		.map((line) => removePrefix(line.trim(), "//").trim())
		.join("\n")
		.trim();
}

/** Checks whether a TypeScript file comment lacks useful intent. */
export function isIgnorableFileComment(comment: string): boolean {
	const lowered = comment.trim().toLowerCase();
	return (
		lowered.startsWith("eslint-") ||
		lowered.startsWith("@ts-") ||
		lowered.startsWith("biome-ignore") ||
		lowered.startsWith("oxlint-")
	);
}

/** Finds a meaningful TypeScript file-level comment. */
export function fileComment(lines: string[]): string | null {
	let lineIndex = 0;
	if ((lines[0] ?? "").startsWith("#!")) {
		lineIndex += 1;
	}
	while (lineIndex < lines.length) {
		while (lineIndex < lines.length && !(lines[lineIndex] ?? "").trim()) {
			lineIndex += 1;
		}
		if (lineIndex >= lines.length) {
			return null;
		}

		const firstLine = (lines[lineIndex] ?? "").trimStart();
		if (firstLine.startsWith("//")) {
			const commentLines: string[] = [];
			while (
				lineIndex < lines.length &&
				(lines[lineIndex] ?? "").trimStart().startsWith("//")
			) {
				commentLines.push(lines[lineIndex] ?? "");
				lineIndex += 1;
			}
			const comment = cleanLineComment(commentLines);
			if (comment && !isIgnorableFileComment(comment)) {
				return comment;
			}
			continue;
		}

		if (firstLine.startsWith("/*")) {
			const commentLines = [lines[lineIndex] ?? ""];
			while (!(lines[lineIndex] ?? "").includes("*/")) {
				lineIndex += 1;
				if (lineIndex >= lines.length) {
					return null;
				}
				commentLines.push(lines[lineIndex] ?? "");
			}
			lineIndex += 1;
			const comment = cleanBlockComment(commentLines);
			if (comment && !isIgnorableFileComment(comment)) {
				return comment;
			}
			continue;
		}

		return null;
	}
	return null;
}

/** Finds the nearest useful TypeScript comment for a declaration. */
export function declarationComment(
	lines: string[],
	declarationLineIndex: number,
): string | null {
	if (declarationLineIndex <= 0) {
		return null;
	}

	let lineIndex = declarationLineIndex - 1;
	if (!(lines[lineIndex] ?? "").trim()) {
		return null;
	}

	const stripped = (lines[lineIndex] ?? "").trimStart();
	if (stripped.startsWith("//")) {
		const commentLines: string[] = [];
		while (
			lineIndex >= 0 &&
			(lines[lineIndex] ?? "").trimStart().startsWith("//")
		) {
			commentLines.push(lines[lineIndex] ?? "");
			lineIndex -= 1;
		}
		const comment = cleanLineComment(commentLines.reverse());
		return comment || null;
	}

	if (!stripped.includes("*/")) {
		return null;
	}

	const commentLines = [lines[lineIndex] ?? ""];
	while (!(lines[lineIndex] ?? "").includes("/*")) {
		lineIndex -= 1;
		if (lineIndex < 0) {
			return null;
		}
		commentLines.push(lines[lineIndex] ?? "");
	}
	const comment = cleanBlockComment(commentLines.reverse());
	return comment || null;
}

/** Checks whether a TypeScript declaration has a leading block doc comment. */
export function hasLeadingBlockComment(
	lines: string[],
	declarationLineIndex: number,
): boolean {
	if (declarationLineIndex <= 0) {
		return false;
	}
	const lineIndex = declarationLineIndex - 1;
	if (!(lines[lineIndex] ?? "").trim()) {
		return false;
	}
	return (lines[lineIndex] ?? "").includes("*/");
}

/** Formats TypeScript parameter text for report output. */
export function formatTypescriptParams(rawParams: string): string {
	const normalized = rawParams
		.replaceAll("\n", " ")
		.trim()
		.split(/\s+/)
		.join(" ");
	return normalized || "none";
}

/** Adds documented TypeScript function declarations to a file report. */
export function appendFunctionDeclarations(
	report: FileReport,
	source: string,
	lines: string[],
	starts: number[],
	seenFunctionKeys: Set<SeenFunctionKey>,
): void {
	for (const match of source.matchAll(TYPESCRIPT_FUNCTION_DECL_RE)) {
		const lineIndex = lineIndexForOffset(starts, match.index ?? 0);
		const name = match[1] ?? "";
		seenFunctionKeys.add(functionKey(lineIndex, name));
		report.functions.push({
			name,
			lineno: lineIndex + 1,
			inputs: formatTypescriptParams(match[2] ?? ""),
			outputs: "unannotated",
			docstring: declarationComment(lines, lineIndex),
			nestedFunctions: [],
		});
	}
}

/** Adds undocumented arrow-function declarations to the docstring report. */
export function appendArrowDeclarations(
	report: FileReport,
	source: string,
	lines: string[],
	starts: number[],
	seenFunctionKeys: Set<SeenFunctionKey>,
): void {
	for (const match of source.matchAll(TYPESCRIPT_ARROW_DECL_RE)) {
		const lineIndex = lineIndexForOffset(starts, match.index ?? 0);
		const name = match[1] ?? "";
		seenFunctionKeys.add(functionKey(lineIndex, name));
		const params = match[2] ?? match[3] ?? "";
		report.functions.push({
			name,
			lineno: lineIndex + 1,
			inputs: formatTypescriptParams(params),
			outputs: "unannotated",
			docstring: declarationComment(lines, lineIndex),
			nestedFunctions: [],
		});
	}
}

/** Marks exported or local TypeScript values that already have doc comments. */
export function appendDocumentedValues(
	report: FileReport,
	source: string,
	lines: string[],
	starts: number[],
	seenFunctionKeys: Set<SeenFunctionKey>,
): void {
	for (const match of source.matchAll(TYPESCRIPT_VALUE_DECL_RE)) {
		const lineIndex = lineIndexForOffset(starts, match.index ?? 0);
		const name = match[1] ?? "";
		if (
			seenFunctionKeys.has(functionKey(lineIndex, name)) ||
			!hasLeadingBlockComment(lines, lineIndex)
		) {
			continue;
		}
		const comment = declarationComment(lines, lineIndex);
		if (!comment) {
			continue;
		}
		report.functions.push({
			name,
			lineno: lineIndex + 1,
			inputs: "none",
			outputs: "unannotated",
			docstring: comment,
			nestedFunctions: [],
		});
	}
}

/** Adds TypeScript class declarations to the docstring coverage report. */
export function appendClassDeclarations(
	report: FileReport,
	source: string,
	lines: string[],
	starts: number[],
): void {
	for (const match of source.matchAll(TYPESCRIPT_CLASS_DECL_RE)) {
		const lineIndex = lineIndexForOffset(starts, match.index ?? 0);
		report.classes.push({
			name: match[1] ?? "",
			lineno: lineIndex + 1,
			docstring: declarationComment(lines, lineIndex),
			methods: [],
			nestedClasses: [],
		});
	}
}

/** Builds a comment coverage report for one TypeScript-family source file. */
export function buildTypescriptFileReport(
	filePath: string,
	{ displayPath }: { displayPath: string },
): FileReport {
	const report: FileReport = {
		path: filePath,
		displayPath,
		fileDocstring: null,
		functions: [],
		classes: [],
		parseError: null,
	};
	let source: string;
	try {
		source = readFileSync(filePath, "utf8");
	} catch (error) {
		report.parseError = error instanceof Error ? error.message : String(error);
		return report;
	}

	const lines = splitLines(source);
	const starts = lineStarts(source);
	report.fileDocstring = fileComment(lines);

	const seenFunctionKeys = new Set<SeenFunctionKey>();
	appendFunctionDeclarations(report, source, lines, starts, seenFunctionKeys);
	appendArrowDeclarations(report, source, lines, starts, seenFunctionKeys);
	appendDocumentedValues(report, source, lines, starts, seenFunctionKeys);
	appendClassDeclarations(report, source, lines, starts);

	report.functions.sort(
		(left, right) =>
			left.lineno - right.lineno || stringCompare(left.name, right.name),
	);
	report.classes.sort(
		(left, right) =>
			left.lineno - right.lineno || stringCompare(left.name, right.name),
	);
	return report;
}

/** Builds a stable key for TypeScript function report sorting. */
function functionKey(lineIndex: number, name: string): SeenFunctionKey {
	return `${lineIndex}\0${name}`;
}

/** Normalizes source text to newline-delimited lines. */
function splitLines(source: string): string[] {
	const lines = source.split(/\r?\n/);
	if (source.endsWith("\n") || source.endsWith("\r\n")) {
		lines.pop();
	}
	return lines;
}

/** Removes a prefix from text when present. */
function removePrefix(value: string, prefix: string): string {
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Removes a suffix from text when present. */
function removeSuffix(value: string, suffix: string): string {
	return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

/** Sorts text values with stable lexical ordering. */
function stringCompare(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
