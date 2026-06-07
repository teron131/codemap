/** Extracts Python docstring coverage and signature details. */
import { readFileSync } from "node:fs";

import { ClassReport, FileReport, FunctionReport } from "./models.js";

type DefinitionKind = "function" | "class";

type Definition = {
	kind: DefinitionKind;
	name: string;
	lineno: number;
	lineIndex: number;
	indent: number;
	header: string;
	bodyStart: number;
	bodyEnd: number;
	parents: string[];
};

type ParsedArg = {
	name: string;
	annotation?: string | null;
	defaultValue?: string | null;
	prefix?: string;
};

/** Formats a Python annotation expression for display. */
export function renderAnnotation(node: string | null): string {
	return node === null ? "unannotated" : node;
}

/** Formats a Python default value expression for display. */
export function renderDefault(node: string | null): string {
	return node === null ? "" : ` = ${node}`;
}

/** Formats one Python function argument for report output. */
export function formatArg(
	arg: ParsedArg,
	defaultValue: string | null = arg.defaultValue ?? null,
	{ prefix = arg.prefix ?? "" }: { prefix?: string } = {},
): string {
	let rendered = `${prefix}${arg.name}`;
	if (arg.annotation) {
		rendered += `: ${arg.annotation}`;
	}
	rendered += renderDefault(defaultValue);
	return rendered;
}

/** Formats a Python function signature for report output. */
export function formatSignature(
	rawArguments: string,
	rawReturns: string | null,
): [string, string] {
	const inputs = splitPythonArgs(rawArguments)
		.map((arg) => renderSignatureArg(arg))
		.join(", ");
	return [inputs || "none", renderAnnotation(rawReturns)];
}

/** Builds a docstring report for one Python function definition. */
export function buildFunctionReport(
	definition: Definition,
	definitions: Definition[],
	lines: string[],
): FunctionReport {
	const [inputs, outputs] = formatSignature(
		functionArguments(definition.header),
		functionReturns(definition.header),
	);
	const nestedFunctions = childDefinitions(definition, definitions)
		.filter((child) => child.kind === "function")
		.map((child) => buildFunctionReport(child, definitions, lines));
	return new FunctionReport({
		name: definition.name,
		lineno: definition.lineno,
		inputs,
		outputs,
		docstring: definitionDocstring(definition, lines),
		nestedFunctions,
	});
}

/** Builds a docstring report for one Python class definition. */
export function buildClassReport(
	definition: Definition,
	definitions: Definition[],
	lines: string[],
): ClassReport {
	const children = childDefinitions(definition, definitions);
	const methods = children
		.filter((child) => child.kind === "function")
		.map((child) => buildFunctionReport(child, definitions, lines));
	const nestedClasses = children
		.filter((child) => child.kind === "class")
		.map((child) => buildClassReport(child, definitions, lines));
	return new ClassReport({
		name: definition.name,
		lineno: definition.lineno,
		docstring: definitionDocstring(definition, lines),
		methods,
		nestedClasses,
	});
}

/** Builds a docstring report for one Python source file. */
export function buildPythonFileReport(
	filePath: string,
	{ displayPath }: { displayPath: string },
): FileReport {
	const report = new FileReport({
		path: filePath,
		displayPath,
		fileDocstring: null,
	});
	let source: string;
	try {
		source = readFileSync(filePath, "utf8");
	} catch (error) {
		report.parseError = error instanceof Error ? error.message : String(error);
		return report;
	}

	const parseError = pythonParseError(source);
	if (parseError !== null) {
		report.parseError = parseError;
		return report;
	}

	const lines = splitLines(source);
	const definitions = pythonDefinitions(lines);
	report.fileDocstring = moduleDocstring(lines);
	for (const definition of definitions) {
		if (definition.parents.length !== 0) {
			continue;
		}
		if (definition.kind === "function") {
			report.functions.push(
				buildFunctionReport(definition, definitions, lines),
			);
		} else {
			report.classes.push(buildClassReport(definition, definitions, lines));
		}
	}
	return report;
}

/** Parses Python definitions and nested structure from source lines. */
function pythonDefinitions(lines: string[]): Definition[] {
	const rawDefinitions: Array<Omit<Definition, "parents">> = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const stripped = line.trim();
		const indent = indentOf(line);
		const functionMatch =
			/^(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(stripped);
		const classMatch =
			/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*?)\))?\s*:/.exec(stripped);
		if (functionMatch) {
			rawDefinitions.push({
				kind: "function",
				name: functionMatch[1] ?? "",
				lineno: index + 1,
				lineIndex: index,
				indent,
				header: stripped,
				bodyStart: index + 1,
				bodyEnd: blockEnd(lines, index, indent),
			});
		} else if (classMatch) {
			rawDefinitions.push({
				kind: "class",
				name: classMatch[1] ?? "",
				lineno: index + 1,
				lineIndex: index,
				indent,
				header: stripped,
				bodyStart: index + 1,
				bodyEnd: blockEnd(lines, index, indent),
			});
		}
	}
	return rawDefinitions.map((definition, index) => ({
		...definition,
		parents: parentNames(rawDefinitions, index),
	}));
}

/** Finds definitions nested inside another Python definition body. */
function childDefinitions(
	definition: Definition,
	definitions: Definition[],
): Definition[] {
	return definitions.filter(
		(candidate) =>
			candidate.lineIndex > definition.lineIndex &&
			candidate.lineIndex < definition.bodyEnd &&
			candidate.indent > definition.indent &&
			candidate.parents.at(-1) === definition.name &&
			candidate.parents.length === definition.parents.length + 1,
	);
}

/** Finds containing parent names for nested Python definitions. */
function parentNames(
	definitions: Array<Omit<Definition, "parents">>,
	index: number,
): string[] {
	const child = definitions[index];
	if (child === undefined) {
		return [];
	}
	const parents: string[] = [];
	let currentIndent = child.indent;
	for (
		let candidateIndex = index - 1;
		candidateIndex >= 0;
		candidateIndex -= 1
	) {
		const candidate = definitions[candidateIndex];
		if (
			candidate !== undefined &&
			candidate.indent < currentIndent &&
			candidate.lineIndex < child.lineIndex &&
			candidate.bodyEnd > child.lineIndex
		) {
			parents.unshift(candidate.name);
			currentIndent = candidate.indent;
		}
	}
	return parents;
}

/** Reads the Python module docstring from source lines. */
function moduleDocstring(lines: string[]): string | null {
	let lineIndex = 0;
	while (lineIndex < lines.length && !(lines[lineIndex] ?? "").trim()) {
		lineIndex += 1;
	}
	return readDocstringAt(lines, lineIndex);
}

/** Reads the docstring attached to a Python definition. */
function definitionDocstring(
	definition: Definition,
	lines: string[],
): string | null {
	let lineIndex = definition.bodyStart;
	while (lineIndex < definition.bodyEnd && !(lines[lineIndex] ?? "").trim()) {
		lineIndex += 1;
	}
	if (
		lineIndex >= definition.bodyEnd ||
		indentOf(lines[lineIndex] ?? "") <= definition.indent
	) {
		return null;
	}
	return readDocstringAt(lines, lineIndex);
}

/** Reads a Python docstring beginning at a line index. */
function readDocstringAt(lines: string[], startIndex: number): string | null {
	const line = lines[startIndex] ?? "";
	const stripped = line.trim();
	const quote = docstringQuote(stripped);
	if (quote === null) {
		return null;
	}
	const afterStart = stripped.slice(quote.length);
	const sameLineEnd = afterStart.indexOf(quote);
	if (sameLineEnd >= 0) {
		return cleanDocstring(afterStart.slice(0, sameLineEnd));
	}

	const rawLines = [afterStart];
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		const currentLine = lines[index] ?? "";
		const endIndex = currentLine.indexOf(quote);
		if (endIndex >= 0) {
			rawLines.push(currentLine.slice(0, endIndex));
			return cleanDocstring(rawLines.join("\n"));
		}
		rawLines.push(currentLine);
	}
	return null;
}

/** Normalizes Python docstring text for previews and reports. */
function cleanDocstring(value: string): string {
	const lines = value.replace(/\r\n/g, "\n").split("\n");
	while (lines.length > 0 && !(lines[0] ?? "").trim()) {
		lines.shift();
	}
	while (lines.length > 0 && !(lines.at(-1) ?? "").trim()) {
		lines.pop();
	}
	const indents = lines
		.filter((line) => line.trim())
		.map((line) => indentOf(line));
	const margin = indents.length > 0 ? Math.min(...indents) : 0;
	return lines.map((line) => line.slice(margin).trimEnd()).join("\n");
}

/** Detects the triple-quote delimiter that starts a Python docstring. */
function docstringQuote(stripped: string): string | null {
	for (const quote of ['"""', "'''"]) {
		if (stripped.startsWith(quote)) {
			return quote;
		}
	}
	return null;
}

/** Extracts Python function arguments from a definition header. */
function functionArguments(header: string): string {
	const start = header.indexOf("(");
	const end = header.lastIndexOf(")");
	if (start < 0 || end < start) {
		return "";
	}
	return header.slice(start + 1, end);
}

/** Extracts Python return annotation text from a definition header. */
function functionReturns(header: string): string | null {
	const afterArgs = header.slice(header.lastIndexOf(")") + 1);
	const match = /^\s*->\s*(.*?)\s*:/.exec(afterArgs);
	return match?.[1]?.trim() || null;
}

/** Normalizes one Python signature argument for docstring reports. */
function renderSignatureArg(rawArg: string): string {
	const trimmed = rawArg.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed === "*") {
		return "*";
	}
	if (trimmed.startsWith("**")) {
		return formatArg({ name: trimmed.slice(2), prefix: "**" });
	}
	if (trimmed.startsWith("*")) {
		return formatArg({ name: trimmed.slice(1), prefix: "*" });
	}

	const { left, defaultValue } = splitDefault(trimmed);
	const annotationParts = left.split(":", 2);
	if (annotationParts.length === 2) {
		return formatArg({
			name: annotationParts[0]?.trim() ?? "",
			annotation: annotationParts[1]?.trim() ?? null,
			defaultValue,
		});
	}
	return formatArg({ name: left.trim(), defaultValue });
}

/** Splits a Python argument into name and default value. */
function splitDefault(value: string): {
	left: string;
	defaultValue: string | null;
} {
	const index = value.indexOf("=");
	if (index < 0) {
		return { left: value, defaultValue: null };
	}
	return {
		left: value.slice(0, index).trimEnd(),
		defaultValue: normalizePythonLiteral(value.slice(index + 1).trimStart()),
	};
}

/** Normalizes Python literal text for report display. */
function normalizePythonLiteral(value: string): string {
	if (value === "False" || value === "True" || value === "None") {
		return value;
	}
	return value;
}

/** Splits Python argument text while respecting nested delimiters. */
function splitPythonArgs(rawArguments: string): string[] {
	const args: string[] = [];
	let current = "";
	let depth = 0;
	let quote: string | null = null;
	for (let index = 0; index < rawArguments.length; index += 1) {
		const char = rawArguments[index] ?? "";
		if (quote !== null) {
			current += char;
			if (char === quote && rawArguments[index - 1] !== "\\") {
				quote = null;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if (["(", "[", "{"].includes(char)) {
			depth += 1;
		} else if ([")", "]", "}"].includes(char)) {
			depth -= 1;
		} else if (char === "," && depth === 0) {
			args.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	if (current.trim()) {
		args.push(current.trim());
	}
	return args;
}

/** Finds the last line belonging to an indented Python block. */
function blockEnd(lines: string[], startIndex: number, indent: number): number {
	let endIndex = startIndex + 1;
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			continue;
		}
		if (indentOf(line) <= indent) {
			break;
		}
		endIndex = index + 1;
	}
	return endIndex;
}

/** Builds a parse-error report for Python docstring extraction. */
function pythonParseError(source: string): string | null {
	for (const line of source.split(/\r?\n/)) {
		const stripped = line.trim();
		if (
			/^(?:async\s+def|def)\b/.test(stripped) &&
			!/^async\s+def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*(?:->\s*.*?)?:/.test(
				stripped,
			) &&
			!/^def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*(?:->\s*.*?)?:/.test(stripped)
		) {
			return "invalid syntax";
		}
		if (
			/^class\b/.test(stripped) &&
			!/^class\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:\(.*\))?\s*:/.test(stripped)
		) {
			return "invalid syntax";
		}
	}
	return null;
}

/** Normalizes source text to newline-delimited lines. */
function splitLines(source: string): string[] {
	const lines = source.split(/\r?\n/);
	if (source.endsWith("\n") || source.endsWith("\r\n")) {
		lines.pop();
	}
	return lines;
}

/** Counts leading spaces for Python indentation-sensitive parsing. */
function indentOf(line: string): number {
	return line.match(/^[ \t]*/)?.[0]?.length ?? 0;
}
