/** Defines CLI behavior for explicit structural search subcommands. */
import type { Command } from "commander";
import {
	matchJson,
	printSyntaxMatches,
	resolveProjectFile,
	targetLanguages,
} from "../ast-grep/index.js";
import {
	type CodebaseMemoryTraceOptions,
	printCodebaseMemoryCallTrace,
} from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import {
	callMatches,
	resolveTargetPaths,
	searchRuleMatches,
	structuralMatches,
} from "../search/structural.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

export type SearchMatchOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	pattern: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

export type SearchCallsOptions = {
	projectRoot?: string | undefined;
	lang?: string | undefined;
	name: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
	mode?: string | undefined;
	direction?: string | undefined;
	depth?: number | undefined;
	parameter?: string | undefined;
	includeTests?: boolean | undefined;
};

export type SearchRuleOptions = {
	projectRoot?: string | undefined;
	rule: string;
	paths?: string[] | undefined;
	json?: boolean | undefined;
};

const TRACE_MODES = ["calls", "data_flow", "cross_service"] as const;
const TRACE_DIRECTIONS = ["inbound", "outbound", "both"] as const;

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
		.option(
			"--mode <mode>",
			"Backend trace mode: calls, data_flow, or cross_service.",
		)
		.option(
			"--direction <direction>",
			"Backend trace direction: inbound, outbound, or both.",
		)
		.option("--depth <count>", "Backend trace depth.", parseIntegerOption)
		.option("--parameter <name>", "Parameter to trace in data_flow mode.")
		.option("--include-tests", "Include test nodes in backend trace output.")
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
	for (const language of languages) {
		const languageMatches = structuralMatches(
			root,
			language,
			options.pattern,
			paths,
		);
		if (languageMatches === null) {
			console.log(
				`Unavailable: ast-grep is not available for language: ${language}.`,
			);
			return 127;
		}
		matches.push(...languageMatches);
	}
	printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
	if (matches.length === 0 && !options.json) {
		console.log("No matches");
	}
	return matches.length > 0 ? 0 : 1;
}

/** Runs structural call-site search and prints matches. */
export function commandSearchCalls(options: SearchCallsOptions): number {
	const optionError = traceOptionError(options);
	if (optionError !== null) {
		console.log(optionError);
		return 2;
	}
	const root = resolveProjectRoot(options.projectRoot);
	if (
		(options.paths ?? []).length === 0 &&
		options.lang === undefined &&
		printCodebaseMemoryCallTrace(root, options.name, {
			jsonOutput: Boolean(options.json),
			...backendTraceOptions(options),
			riskLabels: true,
		})
	) {
		return 0;
	}
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
	printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
	if (matches.length === 0 && !options.json) {
		console.log("No matches");
	}
	return matches.length > 0 ? 0 : 1;
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

/** Returns explicit or target-inferred languages for structural search. */
function structuralLanguages(
	root: string,
	paths: string[],
	explicitLanguage: string | undefined,
): string[] {
	return explicitLanguage ? [explicitLanguage] : targetLanguages(root, paths);
}

/** Builds Codebase Memory trace options without explicit undefined fields. */
function backendTraceOptions(
	options: SearchCallsOptions,
): CodebaseMemoryTraceOptions {
	const mode = traceMode(options.mode);
	const direction = traceDirection(options.direction);
	return {
		...(mode !== undefined ? { mode } : {}),
		...(direction !== undefined ? { direction } : {}),
		...(options.depth !== undefined ? { depth: options.depth } : {}),
		...(options.parameter !== undefined
			? { parameterName: options.parameter }
			: {}),
		...(options.includeTests !== undefined
			? { includeTests: options.includeTests }
			: {}),
	};
}

/** Validates backend trace enum flags before invoking Codebase Memory. */
function traceOptionError(options: SearchCallsOptions): string | null {
	if (options.mode !== undefined && traceMode(options.mode) === undefined) {
		return `Invalid trace mode: ${options.mode}. Choose one of: ${TRACE_MODES.join(", ")}.`;
	}
	if (
		options.direction !== undefined &&
		traceDirection(options.direction) === undefined
	) {
		return `Invalid trace direction: ${options.direction}. Choose one of: ${TRACE_DIRECTIONS.join(", ")}.`;
	}
	return null;
}

/** Reads a valid Codebase Memory trace mode from CLI text. */
function traceMode(
	value: string | undefined,
): CodebaseMemoryTraceOptions["mode"] | undefined {
	return TRACE_MODES.find((item) => item === value);
}

/** Reads a valid Codebase Memory trace direction from CLI text. */
function traceDirection(
	value: string | undefined,
): CodebaseMemoryTraceOptions["direction"] | undefined {
	return TRACE_DIRECTIONS.find((item) => item === value);
}

/** Prints a focused message when language inference has no source files. */
function printNoSyntaxTargets(paths: string[]): void {
	console.log("No supported syntax files found.");
	console.log(`Searched: ${paths.length === 0 ? "." : paths.join(", ")}`);
	console.log("Add --lang when the target path is generated or unsuffixed.");
}
