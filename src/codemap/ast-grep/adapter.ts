/** Adapts ast-grep NAPI and CLI behavior to Codemap syntax operations. */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { Lang, type NapiConfig, parse, type SgNode } from "@ast-grep/napi";
import { parse as parseYaml } from "yaml";

import { expandUser } from "../common.js";

export const META_VAR_RE =
	/(\$\$\$[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*)/g;

export const LANGUAGE_ALIASES: Record<string, string> = {
	javascript: "javascript",
	js: "javascript",
	jsx: "jsx",
	py: "python",
	python: "python",
	ts: "typescript",
	tsx: "tsx",
	typescript: "typescript",
};

export const SYNTAX_SUFFIXES_BY_LANGUAGE: Record<string, Set<string>> = {
	javascript: new Set([".js", ".jsx", ".mjs"]),
	jsx: new Set([".jsx"]),
	python: new Set([".py"]),
	tsx: new Set([".tsx"]),
	typescript: new Set([".ts", ".tsx"]),
};

export const AST_GREP_IGNORED_DIR_NAMES = new Set([
	".cache",
	".context-graph",
	".git",
	".mypy_cache",
	".next",
	".pytest_cache",
	".ruff_cache",
	".turbo",
	".venv",
	"__pycache__",
	"_build",
	"_generated",
	"_next",
	"build",
	"coverage",
	"deps",
	"dist",
	"node_modules",
	"out",
	"target",
	"venv",
	"vendor",
]);

export type SyntaxMatch = {
	filePath: string;
	text: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	lines: string;
};

export type SyntaxRewriteResult = {
	filePath: string;
	matchCount: number;
	previewText?: string | undefined;
	text: string;
};

const INFERRED_SYNTAX_LANGUAGES = [
	{ language: "typescript", suffixes: new Set([".ts"]) },
	{ language: "tsx", suffixes: new Set([".tsx"]) },
	{ language: "javascript", suffixes: new Set([".js", ".mjs"]) },
	{ language: "jsx", suffixes: new Set([".jsx"]) },
	{ language: "python", suffixes: new Set([".py"]) },
];

const RENAME_IDENTIFIER_KINDS = new Set(["identifier", "type_identifier"]);
const RENAME_SHORTHAND_KINDS = new Set([
	"shorthand_property_identifier",
	"shorthand_property_identifier_pattern",
]);

type AstGrepCliMatch = {
	text?: string;
	file?: string;
	lines?: string;
	range?: {
		byteOffset?: { start?: number; end?: number };
		start?: { line?: number; column?: number };
		end?: { line?: number; column?: number };
	};
	replacement?: string;
	replacementOffsets?: { start?: number; end?: number };
};

/** Parses source text into an ast-grep root node for a language. */
export function astGrepRoot(source: string, language: string): SgNode | null {
	const napiLanguage = napiLanguageFor(normalizeLanguage(language));
	if (napiLanguage === null) {
		return null;
	}
	try {
		return parse(napiLanguage, source).root();
	} catch {
		return null;
	}
}

/** Finds syntax matches for a simple ast-grep pattern. */
export function syntaxMatches(
	root: string,
	lang: string,
	pattern: string,
	paths: string[],
	{ limit = null }: { limit?: number | null } = {},
): SyntaxMatch[] | null {
	return ruleMatches(root, lang, { rule: { pattern } }, paths, { limit });
}

/** Runs a simple ast-grep pattern rewrite. */
export function syntaxRewrite(
	root: string,
	lang: string,
	pattern: string,
	rewrite: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): SyntaxRewriteResult[] | null {
	return ruleRewrite(root, lang, { rule: { pattern } }, rewrite, paths, {
		apply,
	});
}

/** Renames identifier-like syntax nodes across resolved target files. */
export function renameIdentifiers(
	root: string,
	lang: string,
	oldName: string,
	newName: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): SyntaxRewriteResult[] | null {
	const language = normalizeLanguage(lang);
	if (napiLanguageFor(language) === null) {
		return null;
	}
	const results: SyntaxRewriteResult[] = [];
	for (const filePath of targetFiles(root, paths, language)) {
		const relPath = path.relative(root, filePath).split(path.sep).join("/");
		try {
			const source = readFileSync(filePath, "utf8");
			const syntaxRoot = astGrepRoot(source, language);
			if (syntaxRoot === null) {
				continue;
			}
			const edits = identifierRenameEdits(syntaxRoot, oldName, newName);
			if (edits.length === 0) {
				continue;
			}
			const rewritten = syntaxRoot.commitEdits(edits);
			if (apply) {
				writeFileSync(filePath, rewritten, "utf8");
			}
			results.push({
				filePath: relPath,
				matchCount: edits.length,
				previewText: changedLinePreview(source, rewritten),
				text: rewritten,
			});
		} catch {}
	}
	return results;
}

/** Finds ast-grep rule matches across resolved target files. */
export function ruleMatches(
	root: string,
	lang: string,
	matchConfig: NapiConfig,
	paths: string[],
	{ limit = null }: { limit?: number | null } = {},
): SyntaxMatch[] | null {
	const language = normalizeLanguage(lang);
	if (napiLanguageFor(language) === null) {
		if (language === "python") {
			const pattern = patternFromMatchConfig(matchConfig);
			return pattern === null
				? null
				: cliPatternMatches(root, language, pattern, paths, { limit });
		}
		return null;
	}
	const matches: SyntaxMatch[] = [];
	for (const filePath of targetFiles(root, paths, language)) {
		if (limit !== null && matches.length >= limit) {
			break;
		}
		const relPath = path.relative(root, filePath).split(path.sep).join("/");
		try {
			const text = readFileSync(filePath, "utf8");
			const syntaxRoot = astGrepRoot(text, language);
			if (syntaxRoot === null) {
				continue;
			}
			const matchedNodes = syntaxRoot.findAll(matchConfig);
			const sourceLines = splitLines(text);
			for (const node of matchedNodes) {
				if (limit !== null && matches.length >= limit) {
					break;
				}
				const nodeRange = node.range();
				matches.push({
					filePath: relPath,
					text: node.text(),
					line: nodeRange.start.line + 1,
					column: nodeRange.start.column + 1,
					endLine: nodeRange.end.line + 1,
					endColumn: nodeRange.end.column + 1,
					lines: contextLines(
						sourceLines,
						nodeRange.start.line,
						nodeRange.end.line,
					),
				});
			}
		} catch {}
	}
	return matches;
}

/** Applies ast-grep rule rewrites in preview or write mode. */
export function ruleRewrite(
	root: string,
	lang: string,
	matchConfig: NapiConfig,
	rewrite: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): SyntaxRewriteResult[] | null {
	const language = normalizeLanguage(lang);
	if (napiLanguageFor(language) === null) {
		if (language === "python") {
			const pattern = patternFromMatchConfig(matchConfig);
			return pattern === null
				? null
				: cliPatternRewrite(root, language, pattern, rewrite, paths, { apply });
		}
		return null;
	}
	const results: SyntaxRewriteResult[] = [];
	for (const filePath of targetFiles(root, paths, language)) {
		const relPath = path.relative(root, filePath).split(path.sep).join("/");
		try {
			const source = readFileSync(filePath, "utf8");
			const syntaxRoot = astGrepRoot(source, language);
			if (syntaxRoot === null) {
				continue;
			}
			const matchedNodes = syntaxRoot.findAll(matchConfig);
			const edits = matchedNodes.map((node) =>
				node.replace(expandRewrite(node, rewrite, source)),
			);
			if (edits.length === 0) {
				continue;
			}
			const rewritten = syntaxRoot.commitEdits(edits);
			if (apply) {
				writeFileSync(filePath, rewritten, "utf8");
			}
			results.push({
				filePath: relPath,
				matchCount: edits.length,
				previewText: changedLinePreview(source, rewritten),
				text: rewritten,
			});
		} catch {}
	}
	return results;
}

/** Builds syntax edits for one identifier rename inside a parsed file. */
function identifierRenameEdits(
	rootNode: SgNode,
	oldName: string,
	newName: string,
): ReturnType<SgNode["replace"]>[] {
	const edits: ReturnType<SgNode["replace"]>[] = [];
	function visit(node: SgNode): void {
		if (node.text() === oldName) {
			const kind = String(node.kind());
			if (RENAME_IDENTIFIER_KINDS.has(kind)) {
				edits.push(node.replace(newName));
			} else if (RENAME_SHORTHAND_KINDS.has(kind)) {
				edits.push(node.replace(`${oldName}: ${newName}`));
			}
		}
		for (const child of node.children()) {
			visit(child);
		}
	}
	visit(rootNode);
	return edits;
}

/** Expands ast-grep rewrite metavariables from captured nodes. */
export function expandRewrite(
	node: SgNode,
	rewrite: string,
	source: string,
): string {
	return rewrite.replace(META_VAR_RE, (token) => {
		const variadic = token.startsWith("$$$");
		const name = variadic ? token.slice(3) : token.slice(1);
		const transformed = node.getTransformed(name);
		if (transformed !== null) {
			return transformed;
		}
		const captured = node.getMatch(name);
		if (captured !== null) {
			return captured.text();
		}
		const captures = node.getMultipleMatches(name);
		if (captures.length > 0) {
			const firstCapture = captures[0];
			if (firstCapture === undefined) {
				return token;
			}
			const start = firstCapture.range().start.index;
			const end = captures.at(-1)?.range().end.index ?? start;
			return source.slice(start, end);
		}
		return token;
	});
}

/** Builds AST, CST, S-expression, or pattern debug output. */
export function syntaxDebugPayload(
	lang: string,
	pattern: string,
	outputFormat: string,
): Record<string, unknown> {
	const language = normalizeLanguage(lang);
	const root = astGrepRoot(pattern, language);
	if (root === null) {
		if (language === "python") {
			return {
				language,
				format: outputFormat,
				pattern,
				rootKind: "module",
				rootText: pattern,
				note: "Codemap debug reports parse summary; run raw ast-grep only when you need full CST/AST dumps.",
			};
		}
		throw new Error("Unavailable: ast-grep-py not installed.");
	}
	return {
		language,
		format: outputFormat,
		pattern,
		rootKind: root.kind(),
		rootText: root.text(),
		note: "Codemap debug reports parse summary; run raw ast-grep only when you need full CST/AST dumps.",
	};
}

/** Runs an ast-grep rule and returns match and rewrite details. */
export function ruleResults(
	root: string,
	rulePath: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): [SyntaxMatch[] | null, SyntaxRewriteResult[] | null, string] {
	const rule = loadRule(rulePath);
	const language = String(rule.language ?? "");
	if (normalizeLanguage(language) === "python") {
		const [matches, rewrites] = cliRuleResults(root, rulePath, paths, {
			apply,
		});
		return [matches, rewrites, language];
	}
	const matchConfig = matchConfigFromRule(rule);
	const fix = rule.fix;
	if (fix !== undefined && fix !== null) {
		const results = ruleRewrite(
			root,
			language,
			matchConfig,
			String(fix),
			paths,
			{ apply },
		);
		return [null, results, language];
	}
	const matches = ruleMatches(root, language, matchConfig, paths);
	return [matches, null, language];
}

/** Loads and parses an ast-grep YAML rule file. */
export function loadRule(rulePath: string): Record<string, unknown> {
	const data = parseYaml(readFileSync(rulePath, "utf8"));
	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(`Invalid ast-grep rule file: ${rulePath}`);
	}
	const rule = data as Record<string, unknown>;
	if (
		rule.rule === null ||
		typeof rule.rule !== "object" ||
		Array.isArray(rule.rule)
	) {
		throw new Error(
			`ast-grep rule file must contain a rule mapping: ${rulePath}`,
		);
	}
	if (!rule.language) {
		throw new Error(`ast-grep rule file must contain language: ${rulePath}`);
	}
	return rule;
}

/** Builds an ast-grep NAPI match config from a YAML rule. */
export function matchConfigFromRule(rule: Record<string, unknown>): NapiConfig {
	const matchConfig: Record<string, unknown> = { rule: rule.rule };
	for (const key of ["constraints", "utils", "transform"]) {
		const value = rule[key];
		if (value !== undefined && value !== null) {
			matchConfig[key] = value;
		}
	}
	return matchConfig as unknown as NapiConfig;
}

/** Normalizes language aliases for ast-grep. */
export function normalizeLanguage(lang: string): string {
	return LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang;
}

/** Resolves project target files for ast-grep operations. */
export function targetFiles(
	root: string,
	paths: string[],
	language: string,
): string[] {
	const suffixes = SYNTAX_SUFFIXES_BY_LANGUAGE[language];
	const files: string[] = [];
	for (const rawPath of paths.length > 0 ? paths : ["."]) {
		const resolvedPath = resolveProjectFile(root, rawPath);
		let candidates: string[] = [];
		if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
			candidates = [resolvedPath];
		} else if (
			existsSync(resolvedPath) &&
			statSync(resolvedPath).isDirectory()
		) {
			candidates = recursiveFiles(resolvedPath).filter((item) =>
				shouldScanAstGrepFile(item, root),
			);
		}
		for (const candidate of candidates) {
			if (!shouldScanAstGrepFile(candidate, root)) {
				continue;
			}
			if (suffixes !== undefined && !suffixes.has(path.extname(candidate))) {
				continue;
			}
			files.push(candidate);
		}
	}
	return files;
}

/** Infers syntax languages from target file suffixes. */
export function targetLanguages(root: string, paths: string[]): string[] {
	const languages: string[] = [];
	for (const candidate of INFERRED_SYNTAX_LANGUAGES) {
		const files = targetFiles(root, paths, candidate.language).filter(
			(filePath) => candidate.suffixes.has(path.extname(filePath)),
		);
		if (files.length > 0) {
			languages.push(candidate.language);
		}
	}
	return languages;
}

/** Checks whether ast-grep should scan a filesystem path. */
export function shouldScanAstGrepFile(filePath: string, root: string): boolean {
	let relParts: string[];
	const relative = path.relative(root, filePath);
	if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
		relParts = relative.split(path.sep);
	} else {
		relParts = filePath.split(path.sep).filter(Boolean);
	}
	return !relParts
		.slice(0, -1)
		.some((part) => AST_GREP_IGNORED_DIR_NAMES.has(part));
}

/** Resolves a project-relative file and rejects paths outside the root. */
export function resolveProjectFile(root: string, rawPath: string): string {
	const expanded = expandUser(rawPath);
	const candidate = path.isAbsolute(expanded)
		? expanded
		: path.join(root, expanded);
	return path.resolve(candidate);
}

/** Builds context text around a syntax match range. */
export function contextLines(
	sourceLines: string[],
	startLine: number,
	endLine: number,
): string {
	if (sourceLines.length === 0) {
		return "";
	}
	const start = Math.max(0, startLine);
	const end = Math.min(sourceLines.length, endLine + 1);
	return sourceLines.slice(start, end).join("\n");
}

/** Runs ast-grep CLI pattern search and converts matches to codemap rows. */
function cliPatternMatches(
	root: string,
	language: string,
	pattern: string,
	paths: string[],
	{ limit = null }: { limit?: number | null } = {},
): SyntaxMatch[] | null {
	const files = targetFiles(root, paths, language);
	if (files.length === 0) {
		return [];
	}
	const result = spawnSync(
		"ast-grep",
		[
			"run",
			"--lang",
			language,
			"--pattern",
			pattern,
			"--json=compact",
			...files,
		],
		{ cwd: root, encoding: "utf8" },
	);
	if (result.error) {
		return null;
	}
	if (result.status !== 0 && result.status !== 1) {
		return null;
	}
	return cliJsonMatches(root, result.stdout).slice(
		0,
		limit === null ? undefined : limit,
	);
}

/** Runs ast-grep CLI rewrites and reports changed files or previews. */
function cliPatternRewrite(
	root: string,
	language: string,
	pattern: string,
	rewrite: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): SyntaxRewriteResult[] | null {
	const files = targetFiles(root, paths, language);
	if (files.length === 0) {
		return [];
	}
	const result = spawnSync(
		"ast-grep",
		[
			"run",
			"--lang",
			language,
			"--pattern",
			pattern,
			"--rewrite",
			rewrite,
			"--json=compact",
			...files,
		],
		{ cwd: root, encoding: "utf8" },
	);
	if (result.error) {
		return null;
	}
	if (result.status !== 0 && result.status !== 1) {
		return null;
	}
	return cliRewriteResults(root, result.stdout, { apply });
}

/** Runs an ast-grep YAML rule and separates search matches from rewrites. */
function cliRuleResults(
	root: string,
	rulePath: string,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): [SyntaxMatch[] | null, SyntaxRewriteResult[] | null] {
	const rule = loadRule(rulePath);
	const language = normalizeLanguage(String(rule.language ?? ""));
	const files = targetFiles(root, paths, language);
	if (files.length === 0) {
		return rule.fix === undefined || rule.fix === null
			? [[], null]
			: [null, []];
	}
	const result = spawnSync(
		"ast-grep",
		["scan", "--rule", rulePath, "--json=compact", ...files],
		{ cwd: root, encoding: "utf8" },
	);
	if (result.error) {
		return [null, null];
	}
	if (result.status !== 0 && result.status !== 1) {
		return [null, null];
	}
	if (rule.fix !== undefined && rule.fix !== null) {
		return [null, cliRewriteResults(root, result.stdout, { apply })];
	}
	return [cliJsonMatches(root, result.stdout), null];
}

/** Converts ast-grep JSON match rows into codemap syntax matches. */
function cliJsonMatches(root: string, stdout: string): SyntaxMatch[] {
	return cliRows(stdout).map((item) => {
		const range = recordValue(item.range);
		const start = recordValue(range.start);
		const end = recordValue(range.end);
		return {
			filePath: cliRelPath(root, String(item.file ?? "")),
			text: String(item.text ?? ""),
			line: numberValue(start.line) + 1,
			column: numberValue(start.column) + 1,
			endLine: numberValue(end.line) + 1,
			endColumn: numberValue(end.column) + 1,
			lines: String(item.lines ?? ""),
		};
	});
}

/** Groups ast-grep rewrite rows by file and captures before/after text. */
function cliRewriteResults(
	root: string,
	stdout: string,
	{ apply = false }: { apply?: boolean },
): SyntaxRewriteResult[] {
	const byFile = new Map<string, AstGrepCliMatch[]>();
	for (const row of cliRows(stdout)) {
		const filePath = path.resolve(root, String(row.file ?? ""));
		const rows = byFile.get(filePath) ?? [];
		rows.push(row);
		byFile.set(filePath, rows);
	}
	const results: SyntaxRewriteResult[] = [];
	for (const [filePath, rows] of byFile) {
		const source = readFileSync(filePath, "utf8");
		const rewritten = applyCliReplacements(source, rows);
		if (apply) {
			writeFileSync(filePath, rewritten, "utf8");
		}
		results.push({
			filePath: path.relative(root, filePath).split(path.sep).join("/"),
			matchCount: rows.length,
			previewText: changedLinePreview(source, rewritten),
			text: rewritten,
		});
	}
	return results.sort((left, right) =>
		compareText(left.filePath, right.filePath),
	);
}

/** Formats changed-line hunks while both source versions are available. */
function changedLinePreview(
	originalSource: string,
	rewrittenText: string,
): string {
	const originalLines = normalizedLines(originalSource);
	const rewrittenLines = normalizedLines(rewrittenText);
	const changedIndexes = rewrittenLines
		.map((line, index) => (line === originalLines[index] ? -1 : index))
		.filter((index) => index >= 0);
	if (changedIndexes.length === 0) {
		return "(rewritten text unchanged)";
	}
	const ranges = previewRanges(changedIndexes, rewrittenLines.length, 2);
	const lines: string[] = [];
	for (const range of ranges) {
		lines.push(`@@ ${range.start + 1}-${range.end} @@`);
		for (let index = range.start; index < range.end; index += 1) {
			const original = originalLines[index];
			const rewritten = rewrittenLines[index] ?? "";
			if (original === rewritten) {
				lines.push(`  ${rewritten}`);
			} else {
				if (original !== undefined) {
					lines.push(`- ${original}`);
				}
				lines.push(`+ ${rewritten}`);
			}
		}
	}
	return lines.join("\n");
}

/** Builds merged changed-line preview ranges with local context. */
function previewRanges(
	changedIndexes: number[],
	lineCount: number,
	context: number,
): { start: number; end: number }[] {
	const ranges: { start: number; end: number }[] = [];
	for (const index of changedIndexes) {
		const nextRange = {
			start: Math.max(0, index - context),
			end: Math.min(lineCount, index + context + 1),
		};
		const previous = ranges.at(-1);
		if (previous && nextRange.start <= previous.end) {
			previous.end = Math.max(previous.end, nextRange.end);
		} else {
			ranges.push(nextRange);
		}
	}
	return ranges;
}

/** Splits source while ignoring the artificial trailing empty line. */
function normalizedLines(text: string): string[] {
	const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	return lines;
}

/** Applies byte-offset replacements returned by ast-grep CLI rewrites. */
function applyCliReplacements(source: string, rows: AstGrepCliMatch[]): string {
	let rewritten = source;
	const replacements = rows
		.map((row) => {
			const offsets = row.replacementOffsets ?? row.range?.byteOffset;
			return {
				start: numberValue(offsets?.start),
				end: numberValue(offsets?.end),
				text: String(row.replacement ?? row.text ?? ""),
			};
		})
		.sort((left, right) => right.start - left.start);
	for (const item of replacements) {
		const start = byteOffsetToStringIndex(source, item.start);
		const end = byteOffsetToStringIndex(source, item.end);
		rewritten = `${rewritten.slice(0, start)}${item.text}${rewritten.slice(end)}`;
	}
	return rewritten;
}

/** Parses ast-grep JSON output, treating empty output as no matches. */
function cliRows(stdout: string): AstGrepCliMatch[] {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return [];
	}
	const parsed = JSON.parse(trimmed) as unknown;
	return Array.isArray(parsed) ? (parsed as AstGrepCliMatch[]) : [];
}

/** Converts ast-grep CLI file names into project-relative paths. */
function cliRelPath(root: string, rawFile: string): string {
	const absolute = path.resolve(root, rawFile);
	return path.relative(root, absolute).split(path.sep).join("/");
}

/** Reads the top-level ast-grep pattern from a rule match config. */
function patternFromMatchConfig(matchConfig: NapiConfig): string | null {
	const config = matchConfig as unknown as Record<string, unknown>;
	const rule = recordValue(config.rule);
	const pattern = rule.pattern;
	return typeof pattern === "string" ? pattern : null;
}

/** Converts ast-grep byte offsets into JavaScript string indexes. */
function byteOffsetToStringIndex(source: string, offset: number): number {
	return Buffer.from(source, "utf8").subarray(0, offset).toString("utf8")
		.length;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads a numeric field from untrusted row data. */
function numberValue(value: unknown): number {
	return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

/** Maps normalized language names to ast-grep NAPI languages. */
function napiLanguageFor(language: string): Lang | null {
	const languages: Record<string, Lang> = {
		javascript: Lang.JavaScript,
		jsx: Lang.JavaScript,
		tsx: Lang.Tsx,
		typescript: Lang.TypeScript,
	};
	return languages[language] ?? null;
}

/** Lists target files recursively for ast-grep fallback scans. */
function recursiveFiles(directory: string): string[] {
	const files: string[] = [];
	let entries = [];
	try {
		entries = readdirSync(directory, { withFileTypes: true }).sort(
			(left, right) => compareText(left.name, right.name),
		);
	} catch {
		return files;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			continue;
		}
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (AST_GREP_IGNORED_DIR_NAMES.has(entry.name)) {
				continue;
			}
			files.push(...recursiveFiles(entryPath));
		} else if (entry.isFile()) {
			files.push(entryPath);
		}
	}
	return files;
}

/** Normalizes source text to newline-delimited lines. */
function splitLines(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const lines = normalized.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	return lines;
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
