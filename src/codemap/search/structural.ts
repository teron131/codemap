/** Runs explicit ast-grep pattern, call, and rule searches. */
import { readFileSync } from "node:fs";
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

export const CALL_TARGET_RE =
	/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** Finds syntax-shaped matches across files with optional call prefiltering. */
export function structuralMatches(
	root: string,
	language: string,
	pattern: string,
	paths: string[],
): SyntaxMatch[] | null {
	return syntaxMatches(root, language, pattern, paths);
}

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
			resolved.push(candidate);
		}
	}
	return resolved;
}

/** Validates and normalizes a function or dotted call target. */
export function callTarget(name: string): string {
	if (!CALL_TARGET_RE.test(name)) {
		throw new Error(`Invalid call target: ${name}`);
	}
	return name;
}

/** Expands tilde-prefixed filesystem paths. */
function expandUser(rawPath: string): string {
	if (rawPath === "~") {
		return process.env.HOME ?? rawPath;
	}
	if (rawPath.startsWith("~/")) {
		return path.join(process.env.HOME ?? "~", rawPath.slice(2));
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
function callTextPattern(target: string): RegExp {
	const parts = target.split(".").map((part) => escapeRegExp(part));
	const callPrefix =
		parts.length === 1 ? parts[0] : parts.join(String.raw`\s*\.\s*`);
	return new RegExp(`(^|[^A-Za-z0-9_.$])${callPrefix}\\s*\\(`);
}

/** Finds Python call expressions with text matching the requested callee. */
function pythonCallMatches(
	root: string,
	target: string,
	paths: string[],
): SyntaxMatch[] {
	const matches: SyntaxMatch[] = [];
	const callPattern = callTextPattern(target);
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
			const found = callPattern.exec(line);
			if (found === null) {
				continue;
			}
			const prefix = found[1] ?? "";
			const column = found.index + prefix.length + 1;
			matches.push({
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
	return matches;
}

/** Escapes text for literal use inside regular expressions. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
