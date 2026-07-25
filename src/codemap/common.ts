/** Provides shared path and project-root helpers. */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DETAILED_ANALYSIS_FILE_LIMIT = 5_000;

/** Resolves and validates the project root path. */
export function resolveProjectRoot(raw: string | null | undefined): string {
  let root = raw == null ? nearestGitRoot(process.cwd()) : expandUser(raw);
  if (!path.isAbsolute(root)) {
    root = path.resolve(process.cwd(), root);
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Project root is not a directory: ${root}`);
  }
  return root;
}

/** Finds the nearest git root for the current directory, falling back to cwd. */
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

/** Expands tilde-prefixed filesystem paths. */
export function expandUser(raw: string): string {
  if (raw === "~") {
    return homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(homedir(), raw.slice(2));
  }
  return raw;
}
