/** Path helpers shared across modules: existence predicates, `~` expansion, symlink resolution, and segment depth and containment for project-relative paths. */
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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

/** Resolves symlinks for existing paths; missing paths fall back to `path.resolve` instead of throwing. */
export function canonicalPath(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
}

/** Counts the non-empty `/`-separated segments of a project-relative path. */
export function pathDepth(value: string): number {
  return value.split("/").filter(Boolean).length;
}

/** Whether a project-relative path is `directory` or lies under it; an empty `directory` is the project root and contains every path. */
export function isWithinDirectory(filePath: string, directory: string): boolean {
  return !directory || filePath === directory || filePath.startsWith(`${directory}/`);
}
