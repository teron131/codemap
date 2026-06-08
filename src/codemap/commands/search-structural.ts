/** Defines CLI behavior for explicit structural search subcommands. */
import type { Command } from "commander";
import {
	matchJson,
	printSyntaxMatches,
	resolveProjectFile,
} from "../ast-grep/index.js";
import { resolveProjectRoot } from "../common.js";
import {
	callMatches,
	resolveTargetPaths,
	searchRuleMatches,
	structuralMatches,
} from "../search/structural.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

export const DEFAULT_STRICTNESS = "smart";

export type SearchMatchOptions = {
	projectRoot?: string | undefined;
	lang: string;
	pattern: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

export type SearchCallsOptions = {
	projectRoot?: string | undefined;
	lang: string;
	name: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

export type SearchRuleOptions = {
	projectRoot?: string | undefined;
	rule: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

/** Registers explicit ast-grep pattern search under the search command. */
export function addSearchMatchParser(command: Command): void {
	addProjectRootArgument(command);
	command
		.requiredOption("--lang <lang>")
		.requiredOption("--pattern <pattern>")
		.argument("[paths...]", "Project-relative target paths.")
		.option("--context <count>", "Context lines.", parseIntegerOption, 2)
		.option(
			"--strictness <strictness>",
			"Match strictness.",
			DEFAULT_STRICTNESS,
		)
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
		.requiredOption("--lang <lang>")
		.argument(
			"<name>",
			"Function or dotted method being called, such as print or console.log.",
		)
		.argument("[paths...]", "Project-relative target paths.")
		.option("--context <count>", "Context lines.", parseIntegerOption, 2)
		.option(
			"--strictness <strictness>",
			"Match strictness.",
			DEFAULT_STRICTNESS,
		)
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
	const matches = structuralMatches(root, options.lang, options.pattern, paths);
	if (matches === null) {
		console.log("Unavailable: ast-grep-py not installed.");
		return 127;
	}
	printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
	return matches.length > 0 ? 0 : 1;
}

/** Runs structural call-site search and prints matches. */
export function commandSearchCalls(options: SearchCallsOptions): number {
	const root = resolveProjectRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const matches = callMatches(root, options.lang, options.name, paths);
	if (matches === null) {
		console.log("Unavailable: ast-grep-py not installed.");
		return 127;
	}
	printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
	return 0;
}

/** Runs read-only ast-grep YAML rule search and prints matches. */
export function commandSearchRule(options: SearchRuleOptions): number {
	const root = resolveProjectRoot(options.projectRoot);
	const paths = resolveTargetPaths(root, options.paths ?? []);
	const rulePath = resolveProjectFile(root, options.rule);
	const matches = searchRuleMatches(root, rulePath, paths);
	if (options.json) {
		console.log(
			JSON.stringify(
				{
					rule: rulePath,
					matches: (matches ?? []).map((match) => matchJson(match)),
					rewrites: [],
				},
				null,
				2,
			),
		);
	} else if (matches && matches.length > 0) {
		printSyntaxMatches(matches, { jsonOutput: false });
	} else {
		console.log("No matches");
	}
	return matches && matches.length > 0 ? 0 : 1;
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
