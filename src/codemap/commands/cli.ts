/** Builds the commander program and runs it with stdout captured, so the output budget applies once to the whole output. */
import { Command, CommanderError } from "commander";

import { CODEMAP_VERSION } from "../version.js";
import { addBackendParsers, addIndexParser } from "./backend.js";
import { addInspectParser } from "./inspect.js";
import { PROJECT_ROOT_HELP } from "./options.js";
import { applyOutputBudget } from "./output.js";
import { addSearchParser } from "./search.js";
import { addSignalsParser } from "./signals.js";
import { addSummaryParser } from "./summary.js";

const COMMAND_NAMES = new Set(["backend", "index", "inspect", "search", "signals", "summary"]);

/** Uses `exitOverride`, so usage errors and `--help` throw `CommanderError` for `dispatch` to map instead of exiting the process. */
export function buildParser(): Command {
  const program = new Command();
  program
    .name("codemap")
    .description("Command-line parser and command dispatch for Codemap.")
    .version(CODEMAP_VERSION)
    .addHelpCommand(false)
    .enablePositionalOptions()
    .exitOverride()
    .option("--project-root <path>", PROJECT_ROOT_HELP);

  addSummaryParser(program);
  addSignalsParser(program);
  addSearchParser(program);
  addInspectParser(program);
  addBackendParsers(program);
  addIndexParser(program);
  return program;
}

/** Maps usage errors to exit code 2 and thrown errors to 1 with the message on stderr; otherwise returns the `process.exitCode` the command set. */
export async function dispatch(program: Command, argv: string[]): Promise<number> {
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

/** Buffers everything written to stdout during dispatch, then writes it once through `applyOutputBudget`; budget notices go to stderr. */
export async function main(argv: string[] = process.argv): Promise<number> {
  const chunks: Buffer[] = [];
  const stdoutWrite = process.stdout.write;
  const writeStdout = stdoutWrite.bind(process.stdout);
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | (() => void),
    callback?: () => void,
  ): boolean => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, encoding) : Buffer.from(chunk));
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  }) as typeof process.stdout.write;

  let exitCode: number;
  try {
    exitCode = await dispatch(buildParser(), normalizedArgv(argv));
  } finally {
    process.stdout.write = stdoutWrite;
  }

  const bounded = applyOutputBudget(Buffer.concat(chunks).toString("utf8"));
  if (bounded.output) {
    writeStdout(bounded.output);
  }
  if (bounded.notice) {
    process.stderr.write(`${bounded.notice}\n`);
  }
  return exitCode;
}

/** Sets `process.exitCode` rather than calling `process.exit`, so buffered stdout can drain before the process ends. */
export function run(): void {
  void main(process.argv).then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });
}

/** Restores the script placeholder some launchers omit: `[node, "search", "x"]` → `[node, "codemap", "search", "x"]`. */
function normalizedArgv(argv: string[]): string[] {
  const firstArgument = argv[1];
  if (
    firstArgument !== undefined &&
    (COMMAND_NAMES.has(firstArgument) || firstArgument.startsWith("-"))
  ) {
    return [argv[0] ?? "node", "codemap", ...argv.slice(1)];
  }
  return argv;
}
