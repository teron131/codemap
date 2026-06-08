/** Builds and dispatches the top-level Codemap CLI parser. */
import { Command, CommanderError } from "commander";
import { addArtifactsParsers } from "./artifacts.js";
import { addInspectParser } from "./inspect.js";
import { PROJECT_ROOT_HELP } from "./options.js";
import { addSearchParser } from "./search.js";
import { addSemanticParsers } from "./semantic.js";
import { addSignalsParser } from "./signals.js";
import { addSummaryParser } from "./summary.js";
import { addSyntaxParsers } from "./syntax.js";

/** Creates the top-level commander parser and attaches all subcommands. */
export function buildParser(): Command {
	const program = new Command();
	program
		.name("codemap")
		.description("Command-line parser and command dispatch for Codemap.")
		.addHelpCommand(false)
		.enablePositionalOptions()
		.exitOverride()
		.option("--project-root <path>", PROJECT_ROOT_HELP);

	addSummaryParser(program);
	addSignalsParser(program);
	addSearchParser(program);
	addInspectParser(program);
	addSyntaxParsers(program);
	addArtifactsParsers(program);
	addSemanticParsers(program);
	return program;
}

/** Parses CLI arguments and returns a process exit code. */
export async function dispatch(
	program: Command,
	argv: string[],
): Promise<number> {
	try {
		await program.parseAsync(argv);
		return Number(process.exitCode ?? 0);
	} catch (error) {
		if (error instanceof CommanderError) {
			return error.exitCode === 0 ? 0 : 2;
		}
		if (error instanceof Error) {
			console.error(error.message);
			return 1;
		}
		throw error;
	}
}

/** Runs Codemap CLI parsing with the process argument vector. */
export async function main(argv: string[] = process.argv): Promise<number> {
	return dispatch(buildParser(), argv);
}

/** Runs the CLI entrypoint and records a nonzero exit code. */
export function run(): void {
	void main(process.argv).then((exitCode) => {
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
	});
}
