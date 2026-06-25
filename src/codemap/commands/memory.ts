/** Defines CLI behavior for Codebase Memory backend operations. */
import type { Command } from "commander";

import {
	type CodebaseMemoryChangeOptions,
	printCodebaseMemoryChanges,
	printCodebaseMemoryProjects,
	printCodebaseMemoryQuery,
	printCodebaseMemorySchema,
	printCodebaseMemoryStatus,
} from "../codebase-memory/index.js";
import { resolveProjectRoot } from "../common.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type MemoryOptions = {
	projectRoot?: string;
};

type MemoryQueryOptions = MemoryOptions & {
	maxRows?: number;
	json?: boolean;
};

type MemoryChangesOptions = MemoryOptions & {
	scope?: string;
	depth?: number;
	baseBranch?: string;
	since?: string;
	json?: boolean;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers Codebase Memory backend commands. */
export function addMemoryParsers(program: Command): void {
	const memory = program
		.command("memory")
		.description("Inspect the Codebase Memory backend used by Codemap.");

	const memoryProjects = memory
		.command("projects")
		.description("Index this root, then list Codebase Memory projects.")
		.action((options: MemoryOptions) => {
			const exitCode = commandMemoryProjects(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memoryProjects);

	const memoryStatus = memory
		.command("status")
		.description("Index first, then print Codebase Memory backend status.")
		.action((options: MemoryOptions) => {
			const exitCode = commandMemoryStatus(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memoryStatus);

	const memorySchema = memory
		.command("schema")
		.description("Index first, then print Codebase Memory graph schema.")
		.action((options: MemoryOptions) => {
			const exitCode = commandMemorySchema(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memorySchema);

	const memoryQuery = memory
		.command("query")
		.description("Run a read-oriented Codebase Memory Cypher query.")
		.argument("<query...>", "Cypher query text.")
		.option(
			"--max-rows <count>",
			"Maximum rows returned by Codebase Memory.",
			parseIntegerOption,
		)
		.option("--json", "Print raw JSON output.")
		.action((query: string[], options: MemoryQueryOptions) => {
			const exitCode = commandMemoryQuery(
				query,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memoryQuery);

	const memoryChanges = memory
		.command("changes")
		.description("Run Codebase Memory changed-code impact analysis.")
		.option("--scope <scope>", "Optional project scope for change analysis.")
		.option("--depth <count>", "Impact trace depth.", parseIntegerOption)
		.option("--base-branch <branch>", "Git base branch.", "main")
		.option("--since <ref>", "Git ref or date to compare from.")
		.option("--json", "Print raw JSON output.")
		.action((options: MemoryChangesOptions) => {
			const exitCode = commandMemoryChanges(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(memoryChanges);
}

/** Lists Codebase Memory projects after refreshing the current project root. */
export function commandMemoryProjects(
	options: MemoryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveMemoryRoot(options, rootOptions);
	if (printCodebaseMemoryProjects(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory projects available. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Prints Codebase Memory backend status for the project root. */
export function commandMemoryStatus(
	options: MemoryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveMemoryRoot(options, rootOptions);
	if (printCodebaseMemoryStatus(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory index for this project. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Prints Codebase Memory graph schema for the project root. */
export function commandMemorySchema(
	options: MemoryOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveMemoryRoot(options, rootOptions);
	if (printCodebaseMemorySchema(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory schema for this project. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Runs a Codebase Memory Cypher query for the project root. */
export function commandMemoryQuery(
	query: string[],
	options: MemoryQueryOptions,
	rootOptions: RootOptions = {},
): number {
	const queryText = query.join(" ").trim();
	if (queryText.length === 0) {
		console.log("Memory query requires Cypher text.");
		return 2;
	}
	if (mutatesGraph(queryText)) {
		console.log(
			"Memory query accepts read-oriented Cypher only; refusing a mutating graph query.",
		);
		return 2;
	}
	const root = resolveMemoryRoot(options, rootOptions);
	if (
		printCodebaseMemoryQuery(root, queryText, {
			jsonOutput: Boolean(options.json),
			...(options.maxRows !== undefined ? { maxRows: options.maxRows } : {}),
		})
	) {
		return 0;
	}
	console.log(
		"Could not run Codebase Memory query. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Runs Codebase Memory changed-code impact analysis. */
export function commandMemoryChanges(
	options: MemoryChangesOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveMemoryRoot(options, rootOptions);
	if (
		printCodebaseMemoryChanges(root, {
			...memoryChangeOptions(options),
			jsonOutput: Boolean(options.json),
		})
	) {
		return 0;
	}
	console.log(
		"Could not read Codebase Memory change impact. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Detects Cypher clauses that can mutate the backend graph. */
function mutatesGraph(query: string): boolean {
	return /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV)\b/i.test(
		query,
	);
}

/** Builds Codebase Memory change options without explicit undefined fields. */
function memoryChangeOptions(
	options: MemoryChangesOptions,
): CodebaseMemoryChangeOptions {
	return {
		...(options.scope !== undefined ? { scope: options.scope } : {}),
		...(options.depth !== undefined ? { depth: options.depth } : {}),
		...(options.baseBranch !== undefined
			? { baseBranch: options.baseBranch }
			: {}),
		...(options.since !== undefined ? { since: options.since } : {}),
	};
}

/** Resolves command-local or global project-root options for memory commands. */
function resolveMemoryRoot(
	options: MemoryOptions,
	rootOptions: RootOptions,
): string {
	return resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
}
