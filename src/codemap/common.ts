/** Project-root resolution and path predicates shared by every command. `DETAILED_ANALYSIS_FILE_LIMIT` is the file count above which commands skip detailed graph analysis. */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DETAILED_ANALYSIS_FILE_LIMIT = 5_000;

/** Without `raw`, uses the Git checkout around the working directory, or the working directory itself outside Git; throws when the result is not a directory. */
export function resolveProjectRoot(raw: string | null | undefined): string {
  let root = raw == null ? nearestGitRoot(process.cwd()) : expandUser(raw);
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

/** Expands only `~` and `~/…`; `~user` forms are returned unchanged. */
export function expandUser(raw: string): string {
  if (raw === "~") {
    return homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(homedir(), raw.slice(2));
  }
  return raw;
}

export function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
