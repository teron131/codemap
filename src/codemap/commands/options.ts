/** Defines shared CLI options and option parsers. */
import { type Command, InvalidArgumentError } from "commander";

export const DEFAULT_ROW_LIMIT = 1_000;

export type ProjectRootOptions = {
  projectRoot?: string;
};
export const PROJECT_ROOT_HELP = "Target project root override. Defaults to the nearest git root.";

/** Adds the shared project-root option to a command parser. */
export function addProjectRootArgument(command: Command): void {
  command.option("--project-root <path>", PROJECT_ROOT_HELP);
}

/** Reads a parsed or programmatic limit option, falling back when it is absent or not numeric. */
export function limitOption(value: string | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Parses an integer CLI option value. */
export function parseIntegerOption(value: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new InvalidArgumentError(`invalid int value: '${value}'`);
  }
  return Number.parseInt(value, 10);
}
