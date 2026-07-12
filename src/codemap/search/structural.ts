/** Runs explicit ast-grep pattern, call, and rule searches. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	contextLines,
	loadRule,
	matchConfigFromRule,
	normalizeLanguage,
	resolveProjectFile,
	ruleMatches,
	SYNTAX_SUFFIXES_BY_LANGUAGE,
	type SyntaxMatch,
	syntaxMatches,
	targetFiles,
} from "../ast-grep/index.js";
import { expandUser } from "../common.js";

const CALL_TARGET_RE =
	/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** Finds function or method call sites through structural search. */
export function callMatches(
	root: string,
	language: string,
	name: string,
	paths: string[],
): SyntaxMatch[] | null {
	const target = callTarget(name);
	const searchPaths = shouldPrefilterCalls(language)
		? callCandidatePaths(root, language, target, paths)
		: paths;
	const matches =
		searchPaths.length === 0
			? []
			: syntaxMatches(root, language, `${target}($$$ARGS)`, searchPaths);
	if (matches === null && pythonLanguage(language)) {
		return pythonCallMatches(root, target, paths);
	}
	return matches;
}

/** Runs ast-grep YAML rule search for target paths. */
export function searchRuleMatches(
	root: string,
	ruleFile: string,
	paths: string[],
): SyntaxMatch[] | null {
	const rulePath = resolveProjectFile(root, ruleFile);
	const rule = loadRule(rulePath);
	return ruleMatches(
		root,
		String(rule.language ?? ""),
		matchConfigFromRule(rule),
		paths,
	);
}

/** Resolves CLI target paths while keeping them inside the project root. */
export function resolveTargetPaths(root: string, paths: string[]): string[] {
	if (paths.length === 0) {
		return ["."];
	}
	const resolved = [];
	const rootResolved = path.resolve(root);
	for (const rawPath of paths) {
		const candidate = expandUser(rawPath);
		if (path.isAbsolute(candidate)) {
			const resolvedCandidate = path.resolve(candidate);
			const relative = path.relative(rootResolved, resolvedCandidate);
			if (relative.startsWith("..") || path.isAbsolute(relative)) {
				throw new Error(`search path is outside project root: ${rawPath}`);
			}
			resolved.push(relative.split(path.sep).join("/"));
		} else {
			resolved.push(relativeTargetPath(rootResolved, candidate));
		}
	}
	return resolved;
}

/** Validates and normalizes a function or dotted call target. */
function callTarget(name: string): string {
	if (!CALL_TARGET_RE.test(name)) {
		throw new Error(`Invalid call target: ${name}`);
	}
	return name;
}

/** Resolves relative target paths from project root or the current directory. */
function relativeTargetPath(root: string, rawPath: string): string {
	const rootPath = path.resolve(root, rawPath);
	if (existsSync(rootPath)) {
		return rawPath;
	}
	const cwdPath = path.resolve(process.cwd(), rawPath);
	const relative = path.relative(root, cwdPath);
	if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
		return relative.split(path.sep).join("/");
	}
	return rawPath;
}

/** Chooses the ast-grep language name for Python structural searches. */
function pythonLanguage(language: string): boolean {
	return language === "python" || language === "py";
}

/** Detects call-search patterns that can be narrowed before ast-grep runs. */
function shouldPrefilterCalls(language: string): boolean {
	return Object.hasOwn(
		SYNTAX_SUFFIXES_BY_LANGUAGE,
		normalizeLanguage(language),
	);
}

/** Finds Python files whose text contains a likely callee name. */
function callCandidatePaths(
	root: string,
	language: string,
	target: string,
	paths: string[],
): string[] {
	const pattern = callTextPattern(target);
	const candidates: string[] = [];
	for (const filePath of targetFiles(
		root,
		paths,
		normalizeLanguage(language),
	)) {
		try {
			if (pattern.test(readFileSync(filePath, "utf8"))) {
				candidates.push(
					path.relative(root, filePath).split(path.sep).join("/"),
				);
			}
		} catch {}
	}
	return candidates;
}

/** Extracts a plain callee name from a Python call-search pattern. */
function callTextPattern(
	target: string,
	{ global = false }: { global?: boolean } = {},
): RegExp {
	const parts = target.split(".").map((part) => escapeRegExp(part));
	const callPrefix =
		parts.length === 1 ? parts[0] : parts.join(String.raw`\s*\.\s*`);
	return new RegExp(
		`(^|[^A-Za-z0-9_.$])${callPrefix}\\s*\\(`,
		global ? "g" : "",
	);
}

/** Finds Python call expressions with text matching the requested callee. */
function pythonCallMatches(
	root: string,
	target: string,
	paths: string[],
): SyntaxMatch[] {
	const matches: SyntaxMatch[] = [];
	for (const filePath of targetFiles(root, paths, "python")) {
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
		for (let index = 0; index < sourceLines.length; index += 1) {
			const line = sourceLines[index] ?? "";
			if (pythonDefinitionLine(line, target)) {
				continue;
			}
			for (const found of line.matchAll(
				callTextPattern(target, { global: true }),
			)) {
				const prefix = found[1] ?? "";
				const column = Number(found.index) + prefix.length + 1;
				matches.push({
					engine: "regex",
					filePath: path.relative(root, filePath).split(path.sep).join("/"),
					text: line.trim(),
					line: index + 1,
					column,
					endLine: index + 1,
					endColumn: line.length + 1,
					lines: contextLines(sourceLines, index, index),
				});
			}
		}
	}
	return matches;
}

/** Excludes Python function or class definitions from approximate call rows. */
function pythonDefinitionLine(line: string, target: string): boolean {
	if (target.includes(".")) {
		return false;
	}
	const name = escapeRegExp(target);
	return new RegExp(`^\\s*(?:(?:async\\s+)?def|class)\\s+${name}\\s*\\(`).test(
		line,
	);
}

/** Escapes text for literal use inside regular expressions. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
