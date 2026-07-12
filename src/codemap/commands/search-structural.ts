/** Defines CLI behavior for explicit structural search subcommands. */
import type { Command } from "commander";
import {
	matchJson,
	printSyntaxMatches,
	resolveProjectFile,
	syntaxMatches,
	targetLanguages,
} from "../ast-grep/index.js";
import { resolveProjectRoot } from "../common.js";
import {
	callMatches,
	resolveTargetPaths,
	searchRuleMatches,
} from "../search/structural.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type SearchMatchOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	pattern: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

type SearchCallsOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	name: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
	limit?: number | undefined;
};

type SearchRuleOptions = {
	projectRoot?: string | undefined;
	rule: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

/** Registers explicit ast-grep pattern search under the search command. */
export function addSearchMatchParser(command: Command): void {
	addProjectRootArgument(command);
	command
		.option("--lang <lang>")
		.requiredOption("--pattern <pattern>")
		.argument("[paths...]", "Project-relative target paths.")
		.option("--json")
		.action((paths: string[], options: Omit<SearchMatchOptions, "paths">) => {
			const exitCode = commandSearchMatch({
				...options,
				paths,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
}

/** Registers structural call-site search under the search command. */
export function addSearchCallsParser(command: Command): void {
	command.description(
		"Find call sites: invocations like print(...), logger.info(...), or console.log(...).",
	);
	addProjectRootArgument(command);
	command
		.option("--lang <lang>")
		.argument(
			"<name>",
			"Function or dotted method being called, such as print or console.log.",
		)
		.argument("[paths...]", "Project-relative target paths.")
		.option("--limit <count>", "Maximum call sites.", parseIntegerOption, 20)
		.option("--json")
		.action(
			(
				name: string,
				paths: string[],
				options: Omit<SearchCallsOptions, "name" | "paths">,
			) => {
				const exitCode = commandSearchCalls({
					...options,
					name,
					paths,
					projectRoot: rootOption(options, command),
				});
				if (exitCode !== 0) {
					process.exitCode = exitCode;
				}
			},
		);
}

/** Registers read-only ast-grep YAML rule search. */
export function addSearchRuleParser(command: Command): void {
	addProjectRootArgument(command);
	command
		.requiredOption("--rule <rule>", "ast-grep YAML rule file.")
		.argument(
			"[paths...]",
			"Project-relative target paths. Defaults to the project root.",
		)
		.option("--json", "Print compact JSON output.")
		.action((paths: string[], options: Omit<SearchRuleOptions, "paths">) => {
			const exitCode = commandSearchRule({
				...options,
				paths,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
}

/** Runs explicit ast-grep pattern search and prints matches. */
export function commandSearchMatch(options: SearchMatchOptions): number {
	const root = resolveProjectRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const languages = structuralLanguages(root, paths, options.lang);
	if (languages.length === 0) {
		printNoSyntaxTargets(paths);
		return 1;
	}
	const matches = [];
	const unavailableLanguages = [];
	let searchedLanguages = 0;
	for (const language of languages) {
		const languageMatches = syntaxMatches(
			root,
			language,
			options.pattern,
			paths,
		);
		if (languageMatches === null) {
			unavailableLanguages.push(language);
			continue;
		}
		searchedLanguages += 1;
		matches.push(...languageMatches);
	}
	if (unavailableLanguages.length > 0) {
		console.error(
			`Unavailable syntax languages: ${unavailableLanguages.join(", ")}.`,
		);
	}
	if (searchedLanguages === 0) {
		return 127;
	}
	printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
	if (matches.length === 0 && !options.json) {
		console.log("No matches");
	}
	return matches.length > 0 ? 0 : 1;
}

/** Runs structural call-site search and prints matches. */
export function commandSearchCalls(options: SearchCallsOptions): number {
	const limit = options.limit ?? 20;
	if (!Number.isInteger(limit) || limit < 1) {
		console.log("Call-site limit must be a positive integer.");
		return 2;
	}
	const root = resolveProjectRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const languages = structuralLanguages(root, paths, options.lang);
	if (languages.length === 0) {
		printNoSyntaxTargets(paths);
		return 1;
	}
	const matches = [];
	for (const language of languages) {
		const languageMatches = callMatches(root, language, options.name, paths);
		if (languageMatches === null) {
			console.log(
				`Unavailable: ast-grep is not available for language: ${language}.`,
			);
			return 127;
		}
		matches.push(...languageMatches);
	}
	const visibleMatches = matches.slice(0, limit);
	if (options.json) {
		console.log(
			JSON.stringify({
				total: matches.length,
				matches: visibleMatches.map((match) => matchJson(match)),
			}),
		);
	} else {
		printSyntaxMatches(visibleMatches, { jsonOutput: false });
	}
	if (matches.length === 0 && !options.json) {
		console.log("No matches");
	} else if (matches.length > visibleMatches.length && !options.json) {
		console.log(
			`... ${matches.length - visibleMatches.length} more call sites`,
		);
	}
	return matches.length > 0 ? 0 : 1;
}

/** Runs read-only ast-grep YAML rule search and prints matches. */
export function commandSearchRule(options: SearchRuleOptions): number {
	const root = resolveProjectRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const rulePath = resolveProjectFile(root, options.rule);
	const matches = searchRuleMatches(root, rulePath, paths);
	if (matches === null) {
		console.error("Unavailable: ast-grep cannot run this rule language.");
		return 127;
	}
	if (options.json) {
		console.log(
			JSON.stringify({
				rule: rulePath,
				matches: matches.map((match) => matchJson(match)),
			}),
		);
	} else if (matches.length > 0) {
		printSyntaxMatches(matches, { jsonOutput: false });
	} else {
		console.log("No matches");
	}
	return matches.length > 0 ? 0 : 1;
}

/** Resolves command-local or global project-root options. */
function rootOption(
	options: { projectRoot?: string | undefined },
	command: Command,
): string | undefined {
	return (
		options.projectRoot ??
		command.optsWithGlobals<{ projectRoot?: string }>().projectRoot
	);
}

/** Returns explicit or target-inferred languages for structural search. */
function structuralLanguages(
	root: string,
	paths: string[],
	explicitLanguage: string | undefined,
): string[] {
	return explicitLanguage ? [explicitLanguage] : targetLanguages(root, paths);
}

/** Prints a focused message when language inference has no source files. */
function printNoSyntaxTargets(paths: string[]): void {
	console.log("No supported syntax files found.");
	console.log(`Searched: ${paths.length === 0 ? "." : paths.join(", ")}`);
	console.log("Add --lang when the target path is generated or unsuffixed.");
}
