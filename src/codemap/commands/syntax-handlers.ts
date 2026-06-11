/** Runs syntax command actions after parser options are resolved. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	matchJson,
	printRewriteResults,
	printSyntaxMatches,
	renameIdentifiers,
	resolveProjectFile,
	rewriteJson,
	ruleResults,
	type SyntaxRewriteResult,
	syntaxDebugPayload,
	syntaxRewrite,
	targetLanguages,
} from "../ast-grep/index.js";
import { resolveProjectRoot } from "../common.js";
import {
	canApply,
	printRecipeCatalog,
	runRecipe,
	SYNTAX_RECIPES,
} from "../syntax/index.js";

export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const CALL_TARGET_RE =
	/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
export const DEBUG_FORMAT_CHOICES = ["pattern", "ast", "cst", "sexp"] as const;

export type SyntaxRewriteOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	pattern?: string | undefined;
	rewrite?: string | undefined;
	oldName?: string | undefined;
	newName?: string | undefined;
	paths?: string[] | undefined;
	apply?: boolean | undefined;
	yes?: boolean | undefined;
	allowEmpty?: boolean | undefined;
	full?: boolean | undefined;
};

export type SyntaxDebugOptions = {
	projectRoot?: string | undefined;
	lang: string;
	pattern: string;
	format?: string | undefined;
};

export type SyntaxPreviewOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	pattern: string;
	rewrite: string;
	codeFile?: string | undefined;
	full?: boolean | undefined;
};

export type SyntaxRecipeOptions = {
	projectRoot?: string | undefined;
	name?: string | undefined;
	paths?: string[] | undefined;
	limit?: string | number | undefined;
	json?: boolean | undefined;
	apply?: boolean | undefined;
	yes?: boolean | undefined;
};

export type SyntaxRuleOptions = {
	projectRoot?: string | undefined;
	rule: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
	apply?: boolean | undefined;
	yes?: boolean | undefined;
};

/** Resolves CLI target paths while keeping them inside the project root. */
export function resolveTargetPaths(root: string, paths: string[]): string[] {
	if (paths.length === 0) {
		return ["."];
	}
	const resolved: string[] = [];
	const rootResolved = path.resolve(root);
	for (const rawPath of paths) {
		const candidate = expandUser(rawPath);
		if (path.isAbsolute(candidate)) {
			const resolvedCandidate = path.resolve(candidate);
			const relative = path.relative(rootResolved, resolvedCandidate);
			if (relative.startsWith("..") || path.isAbsolute(relative)) {
				throw new Error(`syntax path is outside project root: ${rawPath}`);
			}
			resolved.push(relative.split(path.sep).join("/"));
		} else {
			resolved.push(relativeTargetPath(rootResolved, candidate));
		}
	}
	return resolved;
}

/** Runs syntax pattern replacement on selected files. */
export function commandSyntaxReplace(options: SyntaxRewriteOptions): number {
	const root = resolveCommandRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	if (options.apply && !options.yes) {
		console.log("Refusing write: add --yes or preview without --apply.");
		return 1;
	}
	const languages = syntaxLanguages(root, paths, options.lang);
	if (languages.length === 0) {
		printNoSyntaxTargets(paths);
		return options.allowEmpty ? 0 : 1;
	}
	const results: SyntaxRewriteResult[] = [];
	for (const language of languages) {
		const languageResults = syntaxRewrite(
			root,
			language,
			String(options.pattern ?? ""),
			String(options.rewrite ?? ""),
			paths,
			{ apply: Boolean(options.apply) },
		);
		if (languageResults === null) {
			console.log(
				`Unavailable: ast-grep is not available for language: ${language}.`,
			);
			return 127;
		}
		results.push(...languageResults);
	}
	if (results.length === 0) {
		printNoRewriteMatches(
			"syntax replace",
			paths,
			String(options.pattern ?? ""),
		);
		return options.allowEmpty ? 0 : 1;
	}
	printRewriteResults(results, { fullOutput: Boolean(options.full) });
	return 0;
}

/** Runs syntax identifier rename on selected files. */
export function commandSyntaxRename(options: SyntaxRewriteOptions): number {
	if (!IDENTIFIER_RE.test(String(options.oldName ?? ""))) {
		console.log(
			`Invalid old identifier for rename wrapper: ${options.oldName}`,
		);
		return 1;
	}
	if (!IDENTIFIER_RE.test(String(options.newName ?? ""))) {
		console.log(
			`Invalid new identifier for rename wrapper: ${options.newName}`,
		);
		return 1;
	}
	const root = resolveCommandRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	if (options.apply && !options.yes) {
		console.log("Refusing write: add --yes or preview without --apply.");
		return 1;
	}
	const oldName = String(options.oldName);
	const newName = String(options.newName);
	const languages = syntaxLanguages(root, paths, options.lang);
	if (languages.length === 0) {
		printNoSyntaxTargets(paths);
		return options.allowEmpty ? 0 : 1;
	}
	const results: SyntaxRewriteResult[] = [];
	for (const language of languages) {
		const languageResults =
			language === "python"
				? syntaxRewrite(root, language, oldName, newName, paths, {
						apply: Boolean(options.apply),
					})
				: renameIdentifiers(root, language, oldName, newName, paths, {
						apply: Boolean(options.apply),
					});
		if (languageResults === null) {
			console.log(
				`Unavailable: ast-grep is not available for language: ${language}.`,
			);
			return 127;
		}
		results.push(...languageResults);
	}
	if (results.length === 0) {
		printNoRewriteMatches("syntax rename", paths, `${oldName} -> ${newName}`);
		return options.allowEmpty ? 0 : 1;
	}
	printRewriteResults(results, { fullOutput: Boolean(options.full) });
	return 0;
}

/** Runs call-target replacement on selected files. */
export function commandSyntaxReplaceCall(
	options: SyntaxRewriteOptions,
): number {
	const oldTarget = callTarget(String(options.oldName ?? ""));
	const newTarget = callTarget(String(options.newName ?? ""));
	return commandSyntaxReplace({
		...options,
		pattern: `${oldTarget}($$$ARGS)`,
		rewrite: `${newTarget}($$$ARGS)`,
	});
}

/** Validates and normalizes a function or dotted call target. */
export function callTarget(name: string): string {
	if (!CALL_TARGET_RE.test(name)) {
		throw new Error(`Invalid call target: ${name}`);
	}
	return name;
}

/** Prints ast-grep pattern debug output for a snippet. */
export function commandSyntaxDebug(options: SyntaxDebugOptions): number {
	console.log(
		JSON.stringify(
			syntaxDebugPayload(
				options.lang,
				options.pattern,
				options.format ?? "cst",
			),
			null,
			2,
		),
	);
	return 0;
}

/** Prints syntax rewrite preview output for a snippet. */
export function commandSyntaxPreview(options: SyntaxPreviewOptions): number {
	const root = resolveCommandRoot(options.projectRoot);
	const code = readSnippet(root, options.codeFile);
	const language = options.lang ?? languageFromPreviewPath(options.codeFile);
	const snippetPath = path.join(
		root,
		`.codemap-syntax-preview${previewSuffix(language)}`,
	);
	writeFileSync(snippetPath, code, "utf8");
	try {
		const results = syntaxRewrite(
			root,
			language,
			options.pattern,
			options.rewrite,
			[path.relative(root, snippetPath).split(path.sep).join("/")],
			{ apply: false },
		);
		if (results === null) {
			console.log(
				`Unavailable: ast-grep is not available for language: ${language}.`,
			);
			return 127;
		}
		if (results.length === 0) {
			printNoRewriteMatches(
				"syntax preview",
				[options.codeFile ?? "stdin"],
				options.pattern,
			);
			return 1;
		}
		printRewriteResults(results, { fullOutput: Boolean(options.full) });
		return 0;
	} finally {
		rmSync(snippetPath, { force: true });
	}
}

/** Reads inline or file-backed syntax preview snippets. */
export function readSnippet(
	root: string,
	codeFile: string | undefined,
): string {
	if (codeFile) {
		return readFileSync(resolveProjectFile(root, codeFile), "utf8");
	}
	return readFileSync(0, "utf8");
}

/** Chooses the preview file suffix for a syntax language. */
export function previewSuffix(lang: string): string {
	const suffixes: Record<string, string> = {
		javascript: ".js",
		js: ".js",
		jsx: ".jsx",
		python: ".py",
		py: ".py",
		tsx: ".tsx",
		typescript: ".ts",
		ts: ".ts",
	};
	return suffixes[lang.toLowerCase()] ?? ".txt";
}

/** Prints the syntax recipe catalog. */
export function commandSyntaxRecipes(): number {
	printRecipeCatalog();
	return 0;
}

/** Runs one syntax recipe against target files. */
export function commandSyntaxRecipe(options: SyntaxRecipeOptions): number {
	const recipe = SYNTAX_RECIPES[String(options.name ?? "")];
	if (recipe === undefined) {
		console.log(`Unknown syntax recipe: ${options.name}`);
		console.log("Run: codemap syntax recipes");
		return 1;
	}
	if (options.apply && !canApply(recipe)) {
		console.log(
			`Recipe is search-only and has no rewrite steps: ${recipe.name}`,
		);
		return 1;
	}
	if (options.apply && !options.yes) {
		console.log("Refusing write: add --yes or preview without --apply.");
		return 1;
	}
	const root = resolveCommandRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	return runRecipe(root, recipe, paths, {
		apply: Boolean(options.apply),
		jsonOutput: Boolean(options.json),
		limit: recipeTextLimit(options.limit),
	});
}

/** Runs an ast-grep YAML rule with optional rewrites. */
export function commandSyntaxRule(options: SyntaxRuleOptions): number {
	const root = resolveCommandRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const displayRulePath = expandUser(options.rule);
	const rulePath = path.resolve(displayRulePath);
	if (options.apply && !options.yes) {
		console.log("Refusing write: add --yes or preview without --apply.");
		return 1;
	}
	const [matches, rewrites] = ruleResults(root, rulePath, paths, {
		apply: Boolean(options.apply),
	});
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					rule: displayRulePath,
					matches: (matches ?? []).map((match) => matchJson(match)),
					rewrites: (rewrites ?? []).map((rewrite) => rewriteJson(rewrite)),
				},
				null,
				2,
			),
		);
	} else if (matches && matches.length > 0) {
		printSyntaxMatches(matches, { jsonOutput: false });
	} else if (rewrites && rewrites.length > 0) {
		printRewriteResults(rewrites);
	} else {
		console.log("No matches");
	}
	return (matches && matches.length > 0) || (rewrites && rewrites.length > 0)
		? 0
		: 1;
}

/** Resolves the project root option for syntax command handlers. */
function resolveCommandRoot(rawRoot: string | undefined): string {
	return resolveProjectRoot(rawRoot);
}

/** Parses the recipe text match limit. */
function recipeTextLimit(value: string | number | undefined): number | null {
	if (value === undefined) {
		return null;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
}

/** Returns explicit or target-inferred syntax languages for rewrite commands. */
function syntaxLanguages(
	root: string,
	paths: string[],
	explicitLanguage: string | undefined,
): string[] {
	if (explicitLanguage) {
		return [explicitLanguage];
	}
	return targetLanguages(root, paths);
}

/** Infers preview language from a code file extension when --lang is omitted. */
function languageFromPreviewPath(codeFile: string | undefined): string {
	if (!codeFile) {
		return "typescript";
	}
	const suffix = path.extname(codeFile);
	const suffixLanguages: Record<string, string> = {
		".js": "javascript",
		".jsx": "jsx",
		".mjs": "javascript",
		".py": "python",
		".ts": "typescript",
		".tsx": "tsx",
	};
	return suffixLanguages[suffix] ?? "typescript";
}

/** Prints an explicit empty-result message for syntax rewrite commands. */
function printNoRewriteMatches(
	commandName: string,
	paths: string[],
	target: string,
): void {
	console.log(`No matches for ${commandName}: ${target}`);
	console.log(`Searched: ${paths.length === 0 ? "." : paths.join(", ")}`);
}

/** Prints a focused message when language inference has no source files. */
function printNoSyntaxTargets(paths: string[]): void {
	console.log("No supported syntax files found.");
	console.log(`Searched: ${paths.length === 0 ? "." : paths.join(", ")}`);
	console.log(
		"Add --lang when the target path is generated, unsuffixed, or piped.",
	);
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
