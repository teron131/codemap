/** Defines shared CLI options and option parsers. */
import { type Command, InvalidArgumentError } from "commander";

export const PROJECT_ROOT_HELP = "Target project root override. Defaults to the nearest git root.";

/** Adds the shared project-root option to a command parser. */
export function addProjectRootArgument(command: Command): void {
  command.option("--project-root <path>", PROJECT_ROOT_HELP);
}

/** Parses an integer CLI option value. */
export function parseIntegerOption(value: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new InvalidArgumentError(`invalid int value: '${value}'`);
  }
  return Number.parseInt(value, 10);
}
