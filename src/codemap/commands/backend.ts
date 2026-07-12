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

type BackendOptions = {
	projectRoot?: string;
};

type BackendQueryOptions = BackendOptions & {
	maxRows?: number;
	json?: boolean;
};

type BackendChangesOptions = BackendOptions & {
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
export function addBackendParsers(program: Command): void {
	const backend = program
		.command("backend")
		.description("Inspect the Codebase Memory backend used by Codemap.");

	const backendProjects = backend
		.command("projects")
		.description("Index this root, then list Codebase Memory projects.")
		.action((options: BackendOptions) => {
			const exitCode = commandBackendProjects(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(backendProjects);

	const backendStatus = backend
		.command("status")
		.description("Index first, then print Codebase Memory backend status.")
		.action((options: BackendOptions) => {
			const exitCode = commandBackendStatus(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(backendStatus);

	const backendSchema = backend
		.command("schema")
		.description("Index first, then print Codebase Memory graph schema.")
		.action((options: BackendOptions) => {
			const exitCode = commandBackendSchema(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(backendSchema);

	const backendQuery = backend
		.command("query")
		.description("Run a read-oriented Codebase Memory Cypher query.")
		.argument("<query...>", "Cypher query text.")
		.option(
			"--max-rows <count>",
			"Maximum rows returned by Codebase Memory.",
			parseIntegerOption,
		)
		.option("--json", "Print raw JSON output.")
		.action((query: string[], options: BackendQueryOptions) => {
			const exitCode = commandBackendQuery(
				query,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(backendQuery);

	const backendChanges = backend
		.command("changes")
		.description("Run Codebase Memory changed-code impact analysis.")
		.option("--scope <scope>", "Optional project scope for change analysis.")
		.option("--depth <count>", "Impact trace depth.", parseIntegerOption)
		.option("--base-branch <branch>", "Git base branch.", "main")
		.option("--since <ref>", "Git ref or date to compare from.")
		.option("--json", "Print raw JSON output.")
		.action((options: BackendChangesOptions) => {
			const exitCode = commandBackendChanges(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(backendChanges);
}

/** Lists Codebase Memory projects after refreshing the current project root. */
export function commandBackendProjects(
	options: BackendOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveBackendRoot(options, rootOptions);
	if (printCodebaseMemoryProjects(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory projects available. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Prints Codebase Memory backend status for the project root. */
export function commandBackendStatus(
	options: BackendOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveBackendRoot(options, rootOptions);
	if (printCodebaseMemoryStatus(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory index for this project. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Prints Codebase Memory graph schema for the project root. */
export function commandBackendSchema(
	options: BackendOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveBackendRoot(options, rootOptions);
	if (printCodebaseMemorySchema(root)) {
		return 0;
	}
	console.log(
		"No Codebase Memory schema for this project. Ensure `codebase-memory-mcp` is installed and reachable.",
	);
	return 1;
}

/** Runs a Codebase Memory Cypher query for the project root. */
export function commandBackendQuery(
	query: string[],
	options: BackendQueryOptions,
	rootOptions: RootOptions = {},
): number {
	const queryText = query.join(" ").trim();
	if (queryText.length === 0) {
		console.log("Backend query requires Cypher text.");
		return 2;
	}
	if (mutatesGraph(queryText)) {
		console.log(
			"Backend query accepts read-oriented Cypher only; refusing a mutating graph query.",
		);
		return 2;
	}
	const root = resolveBackendRoot(options, rootOptions);
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
export function commandBackendChanges(
	options: BackendChangesOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveBackendRoot(options, rootOptions);
	if (
		printCodebaseMemoryChanges(root, {
			...backendChangeOptions(options),
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
function backendChangeOptions(
	options: BackendChangesOptions,
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

/** Resolves command-local or global project-root options for backend commands. */
function resolveBackendRoot(
	options: BackendOptions,
	rootOptions: RootOptions,
): string {
	return resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
}
