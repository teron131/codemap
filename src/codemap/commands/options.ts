/** Options shared by every command. `--project-root` is accepted globally and per command, and handlers prefer the command's own value. */
import { type Command, InvalidArgumentError } from "commander";

export const DEFAULT_ROW_LIMIT = 1_000;

export type ProjectRootOptions = {
  projectRoot?: string;
};
export const PROJECT_ROOT_HELP = "Target project root override. Defaults to the nearest git root.";

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

/** Rejects anything but optionally signed digits, so `1.5` and `10k` fail instead of truncating as `parseInt` would. */
export function parseIntegerOption(value: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new InvalidArgumentError(`invalid int value: '${value}'`);
  }
  return Number.parseInt(value, 10);
}
