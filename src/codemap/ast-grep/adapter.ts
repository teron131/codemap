/** Adapts ast-grep NAPI and CLI behavior to Codemap syntax operations. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Lang, type NapiConfig, parse, type SgNode } from "@ast-grep/napi";
import { parse as parseYaml } from "yaml";

import { expandUser } from "../common.js";
import { IGNORED_DIR_NAMES } from "../source/scanner/constants.js";

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
	javascript: new Set([".cjs", ".js", ".jsx", ".mjs"]),
	jsx: new Set([".jsx"]),
	python: new Set([".py"]),
	tsx: new Set([".tsx"]),
	typescript: new Set([".cts", ".mts", ".ts", ".tsx"]),
};

export type SyntaxMatch = {
	engine: "ast-grep" | "regex";
	filePath: string;
	text: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	lines: string;
};

const INFERRED_SYNTAX_LANGUAGES = [
	{ language: "typescript", suffixes: new Set([".cts", ".mts", ".ts"]) },
	{ language: "tsx", suffixes: new Set([".tsx"]) },
	{ language: "javascript", suffixes: new Set([".cjs", ".js", ".mjs"]) },
	{ language: "jsx", suffixes: new Set([".jsx"]) },
	{ language: "python", suffixes: new Set([".py"]) },
];

type AstGrepCliMatch = {
	text?: string;
	file?: string;
	lines?: string;
	range?: {
		byteOffset?: { start?: number; end?: number };
		start?: { line?: number; column?: number };
		end?: { line?: number; column?: number };
	};
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
			const config = matchConfig as unknown as Record<string, unknown>;
			const patternValue = recordValue(config.rule).pattern;
			const pattern = typeof patternValue === "string" ? patternValue : null;
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
					engine: "ast-grep",
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
	return !relParts.slice(0, -1).some((part) => IGNORED_DIR_NAMES.has(part));
}

/** Resolves a project-relative file and rejects paths outside the root. */
export function resolveProjectFile(root: string, rawPath: string): string {
	const projectRoot = path.resolve(root);
	const expanded = expandUser(rawPath);
	const candidate = path.isAbsolute(expanded)
		? expanded
		: path.join(projectRoot, expanded);
	const resolved = path.resolve(candidate);
	const relative = path.relative(projectRoot, resolved);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error(`path is outside project root: ${rawPath}`);
	}
	return resolved;
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

/** Converts ast-grep JSON match rows into codemap syntax matches. */
function cliJsonMatches(root: string, stdout: string): SyntaxMatch[] {
	return cliRows(stdout).map((item) => {
		const range = recordValue(item.range);
		const start = recordValue(range.start);
		const end = recordValue(range.end);
		const absoluteFilePath = path.resolve(root, String(item.file ?? ""));
		return {
			engine: "ast-grep",
			filePath: path.relative(root, absoluteFilePath).split(path.sep).join("/"),
			text: String(item.text ?? ""),
			line: numberValue(start.line) + 1,
			column: numberValue(start.column) + 1,
			endLine: numberValue(end.line) + 1,
			endColumn: numberValue(end.column) + 1,
			lines: String(item.lines ?? ""),
		};
	});
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
			if (IGNORED_DIR_NAMES.has(entry.name)) {
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
