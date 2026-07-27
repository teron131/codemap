/** Builds and dispatches the top-level Codemap CLI parser. */
import { Command, CommanderError } from "commander";

import { addBackendParsers, addIndexParser } from "./backend.js";
import { addInspectParser } from "./inspect.js";
import { BYTES_PER_ESTIMATED_TOKEN, OUTPUT_TOKEN_LIMIT, PROJECT_ROOT_HELP } from "./options.js";
import { addSearchParser } from "./search.js";
import { addSignalsParser } from "./signals.js";
import { addSummaryParser } from "./summary.js";

const COMMAND_NAMES = new Set(["backend", "index", "inspect", "search", "signals", "summary"]);

type OutputBudgetResult = {
  output: string;
  notice: string | null;
};

type ParsedJsonOutput = {
  value: unknown;
};

type JsonArrayGroup = {
  blocked: boolean;
  nextIndex: number;
  source: unknown[];
  target: unknown[];
};

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
  addBackendParsers(program);
  addIndexParser(program);
  return program;
}

/** Parses CLI arguments and returns a process exit code. */
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

/** Runs Codemap CLI parsing with the process argument vector. */
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

/** Runs the CLI entrypoint and records a nonzero exit code. */
export function run(): void {
  void main(process.argv).then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });
}

/** Restores a script placeholder when a launcher omits argv[1]. */
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

/** Applies one conservative final-output budget while preserving JSON validity. */
function applyOutputBudget(output: string): OutputBudgetResult {
  const parsed = parseJsonOutput(output);
  if (parsed !== null) {
    const compact = `${JSON.stringify(parsed.value)}\n`;
    if (estimatedTokens(compact) <= OUTPUT_TOKEN_LIMIT) {
      return { output: compact, notice: null };
    }
    return boundedJsonOutput(parsed.value);
  }
  if (estimatedTokens(output) <= OUTPUT_TOKEN_LIMIT) {
    return { output, notice: null };
  }
  return boundedTextOutput(output);
}

/** Parses stdout only when the complete output is one JSON value. */
function parseJsonOutput(output: string): ParsedJsonOutput | null {
  const value = output.trim();
  if (!value) {
    return null;
  }
  try {
    return { value: JSON.parse(value) };
  } catch {
    return null;
  }
}

/** Keeps complete JSON array items in breadth-first order until the budget is full. */
function boundedJsonOutput(value: unknown): OutputBudgetResult {
  const groups: JsonArrayGroup[] = [];
  const target = jsonSkeleton(value, groups);
  const total = countJsonArrayItems(value);
  let shown = 0;

  while (true) {
    let attempted = false;
    const cycleLength = groups.length;
    for (let index = 0; index < cycleLength; index += 1) {
      const group = groups[index];
      if (!group || group.blocked || group.nextIndex >= group.source.length) {
        continue;
      }
      attempted = true;
      const childGroups: JsonArrayGroup[] = [];
      const sourceItem = group.source[group.nextIndex];
      const targetItem = Array.isArray(sourceItem)
        ? structuredClone(sourceItem)
        : jsonSkeleton(sourceItem, childGroups);
      group.target.push(targetItem);
      const candidate = `${JSON.stringify(target)}\n`;
      if (estimatedTokens(candidate) > OUTPUT_TOKEN_LIMIT) {
        group.target.pop();
        group.blocked = true;
        continue;
      }
      group.nextIndex += 1;
      shown += 1;
      groups.push(...childGroups);
    }
    if (!attempted) {
      break;
    }
  }

  const rowOutput = `${JSON.stringify(target)}\n`;
  let output = rowOutput;
  for (const maxStringBytes of [4_096, 1_024, 256, 64, 16]) {
    if (estimatedTokens(output) <= OUTPUT_TOKEN_LIMIT) {
      break;
    }
    output = `${JSON.stringify(truncateJsonStrings(target, maxStringBytes))}\n`;
  }
  if (estimatedTokens(output) > OUTPUT_TOKEN_LIMIT) {
    output = `${JSON.stringify(Array.isArray(value) ? [] : isRecord(value) ? {} : "")}\n`;
  }
  const truncated = Math.max(0, total - shown);
  const valuesShortened = output !== rowOutput;
  return {
    output,
    notice:
      truncated > 0 || valuesShortened
        ? outputBudgetNotice({ output, shown, total, truncated, valuesShortened })
        : null,
  };
}

/** Copies scalar JSON shape while turning arrays into incrementally filled groups. */
function jsonSkeleton(value: unknown, groups: JsonArrayGroup[]): unknown {
  if (Array.isArray(value)) {
    const target: unknown[] = [];
    if (value.length > 0) {
      groups.push({
        blocked: false,
        nextIndex: 0,
        source: value,
        target,
      });
    }
    return target;
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonSkeleton(item, groups)]),
  );
}

/** Counts JSON array items, treating positional row arrays as atomic values. */
function countJsonArrayItems(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      value.length +
      value.reduce((total, item) => total + (isRecord(item) ? countJsonArrayItems(item) : 0), 0)
    );
  }
  if (!isRecord(value)) {
    return 0;
  }
  return Object.values(value).reduce<number>((total, item) => total + countJsonArrayItems(item), 0);
}

/** Shortens oversized JSON string scalars without changing object or array shape. */
function truncateJsonStrings(value: unknown, maxBytes: number): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxBytes) {
      return value;
    }
    return `${utf8Prefix(value, Math.max(0, maxBytes - 3))}...`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateJsonStrings(item, maxBytes));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, truncateJsonStrings(item, maxBytes)]),
  );
}

/** Keeps the longest complete-code-point prefix within a UTF-8 byte allowance. */
function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    bytes += characterBytes;
    result += character;
  }
  return result;
}

/** Keeps complete text lines and appends visible truncation counts. */
function boundedTextOutput(output: string): OutputBudgetResult {
  const lines = output.trimEnd().split(/\r?\n/);
  const shown: string[] = [];
  for (const line of lines) {
    const nextShown = shown.length + 1;
    const footer = textBudgetFooter(nextShown, lines.length);
    const candidate = `${[...shown, line, footer].join("\n")}\n`;
    if (estimatedTokens(candidate) > OUTPUT_TOKEN_LIMIT) {
      break;
    }
    shown.push(line);
  }
  const footer = textBudgetFooter(shown.length, lines.length);
  return {
    output: `${[...shown, footer].join("\n")}\n`,
    notice: null,
  };
}

/** Formats a text-output truncation footer without command-specific vocabulary. */
function textBudgetFooter(shown: number, total: number): string {
  return `... output truncated: shown=${shown}, total=${total}, truncated=${Math.max(0, total - shown)}, token_limit=${OUTPUT_TOKEN_LIMIT}`;
}

/** Formats JSON truncation metadata on stderr so stdout stays jq-compatible. */
function outputBudgetNotice({
  output,
  shown,
  total,
  truncated,
  valuesShortened,
}: {
  output: string;
  shown: number;
  total: number;
  truncated: number;
  valuesShortened: boolean;
}): string {
  return `codemap: output truncated: shown=${shown}, total=${total}, truncated=${truncated} items${valuesShortened ? ", values=shortened" : ""}, estimated_tokens=${estimatedTokens(output)}, token_limit=${OUTPUT_TOKEN_LIMIT}`;
}

/** Conservatively estimates tokens from final UTF-8 bytes. */
function estimatedTokens(output: string): number {
  return Math.ceil(Buffer.byteLength(output, "utf8") / BYTES_PER_ESTIMATED_TOKEN);
}

/** Checks for a JSON object while rejecting arrays and primitives. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
