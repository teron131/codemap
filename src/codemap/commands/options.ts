/** Options shared by every command, and resolution of the project root they name. `--project-root` is accepted globally and per command, and handlers prefer the command's own value. */
import { spawnSync } from "node:child_process";
import path from "node:path";

import { type Command, InvalidArgumentError } from "commander";

import { expandUser, isDirectory } from "../path-utils.js";

export const DEFAULT_ROW_LIMIT = 1_000;

export type ProjectRootOptions = {
  projectRoot?: string | undefined;
};
export const PROJECT_ROOT_HELP = "Target project root override. Defaults to the nearest git root.";

export function addProjectRootArgument(command: Command): void {
  command.option("--project-root <path>", PROJECT_ROOT_HELP);
}

/** Without either option, uses the Git checkout around the working directory, or the working directory itself outside Git; throws when the result is not a directory. */
export function resolveProjectRoot(
  options: ProjectRootOptions,
  rootOptions: ProjectRootOptions = {},
): string {
  const raw = options.projectRoot ?? rootOptions.projectRoot;
  let root = raw === undefined ? nearestGitRoot(process.cwd()) : expandUser(raw);
  if (!path.isAbsolute(root)) {
    root = path.resolve(process.cwd(), root);
  }
  if (!isDirectory(root)) {
    throw new Error(`Project root is not a directory: ${root}`);
  }
  return root;
}

function nearestGitRoot(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return cwd;
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
