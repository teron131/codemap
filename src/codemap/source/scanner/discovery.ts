/** Lists scan-eligible files through `rg --files`, which honors every ignore file. A sorted directory walk is the fallback. */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { isFile } from "../../common.js";
import {
  IGNORED_DIR_NAMES,
  IGNORED_FILE_SUFFIXES,
  KEPT_HIDDEN_DIR_NAMES,
  ROOT_IGNORED_DIR_NAMES,
  SCAN_BASENAMES,
  SCAN_SUFFIXES,
} from "./constants.js";

export type IgnoreRule = {
  include: boolean;
  directoryOnly: boolean;
  pathPatterns: RegExp[];
  basenamePattern: RegExp | null;
};

/** Falls back to the walk when ripgrep is unavailable, or when it finds nothing in a tree that has files but no `.git` of its own, as when a parent repository's ignore rules hide the whole tree. */
export function discoverFiles(targetPath: string): string[] {
  if (isFile(targetPath)) {
    return shouldScanFile(targetPath) ? [targetPath] : [];
  }

  const rgFiles = discoverRipgrepFiles(targetPath);
  if (rgFiles === null) {
    return walkFiles(targetPath);
  }
  if (rgFiles.length > 0 || !hasAnyFile(targetPath)) {
    return rgFiles;
  }
  if (!isFileOrDir(path.join(targetPath, ".git"))) {
    return walkFiles(targetPath);
  }
  return rgFiles;
}

/** Honors only the root `.gitignore`, not nested ignore files or `.git/info/exclude`. */
function walkFiles(targetPath: string): string[] {
  const ignoreRules = loadGitignoreRules(targetPath);
  const files: string[] = [];

  function visit(root: string): void {
    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    const dirNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .filter((name) => {
        const childPath = path.join(root, name);
        return (
          shouldScanDir(name, { root: path.resolve(root) === path.resolve(targetPath) }) &&
          !gitignoreMatches(childPath, targetPath, ignoreRules, { isDir: true })
        );
      });

    const fileNames = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    for (const fileName of fileNames) {
      const filePath = path.join(root, fileName);
      if (
        isFile(filePath) &&
        shouldScanFile(filePath) &&
        !gitignoreMatches(filePath, targetPath, ignoreRules, { isDir: false })
      ) {
        files.push(filePath);
      }
    }

    for (const name of dirNames) {
      visit(path.join(root, name));
    }
  }

  visit(targetPath);
  return files;
}

function shouldScanDir(name: string, { root = false }: { root?: boolean } = {}): boolean {
  if (IGNORED_DIR_NAMES.has(name) || (root && ROOT_IGNORED_DIR_NAMES.has(name))) {
    return false;
  }
  return !name.startsWith(".") || KEPT_HIDDEN_DIR_NAMES.has(name);
}

function shouldScanFile(filePath: string): boolean {
  const parsed = path.parse(filePath);
  if (SCAN_BASENAMES.has(parsed.base)) {
    return true;
  }
  if (IGNORED_FILE_SUFFIXES.has(parsed.ext)) {
    return false;
  }
  return SCAN_SUFFIXES.has(parsed.ext);
}

/** Returns `.` for the root itself and `filePath` unchanged when it lies outside `displayRoot`. */
export function relativePath(filePath: string, { displayRoot }: { displayRoot: string }): string {
  const relPath = path.relative(displayRoot, filePath);
  if (relPath === "") {
    return ".";
  }
  if (relPath.startsWith("..") || path.isAbsolute(relPath)) {
    return filePath;
  }
  return relPath;
}

function discoverRipgrepFiles(targetPath: string): string[] | null {
  const result = spawnSync("rg", ["--files", "-0"], {
    cwd: targetPath,
    encoding: "buffer",
  });

  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return null;
  }

  const files: string[] = [];
  for (const rawPath of result.stdout.toString().split("\0")) {
    if (!rawPath) {
      continue;
    }
    const pathParts = rawPath.split(/[\\/]/);
    if (pathParts.slice(0, -1).some((part, index) => !shouldScanDir(part, { root: index === 0 }))) {
      continue;
    }
    const filePath = path.join(targetPath, rawPath);
    if (isFile(filePath) && shouldScanFile(filePath)) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function loadGitignoreRules(targetPath: string): IgnoreRule[] {
  const gitignorePath = path.join(targetPath, ".gitignore");
  if (!isFile(gitignorePath)) {
    return [];
  }

  let lines: string[];
  try {
    lines = readFileSync(gitignorePath, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }

  const rules: IgnoreRule[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const include = line.startsWith("!");
    const pattern = include ? line.slice(1) : line;
    const rule = compileGitignoreRule(pattern, { include });
    if (rule !== null) {
      rules.push(rule);
    }
  }
  return rules;
}

/** Approximates gitignore: a leading `/` anchors at the root, a pattern without `/` matches basenames at any depth, and `*` also crosses `/`. */
function compileGitignoreRule(
  pattern: string,
  { include }: { include: boolean },
): IgnoreRule | null {
  const directoryOnly = pattern.endsWith("/");
  const cleanPattern = pattern.replace(/\/+$/, "");
  if (!cleanPattern) {
    return null;
  }
  if (cleanPattern.startsWith("/")) {
    return {
      include,
      directoryOnly,
      pathPatterns: [compileGlob(cleanPattern.slice(1))],
      basenamePattern: null,
    };
  }
  if (!cleanPattern.includes("/")) {
    return {
      include,
      directoryOnly,
      pathPatterns: [],
      basenamePattern: compileGlob(cleanPattern),
    };
  }
  return {
    include,
    directoryOnly,
    pathPatterns: [compileGlob(cleanPattern), compileGlob(`${cleanPattern}/*`)],
    basenamePattern: null,
  };
}

function compileGlob(pattern: string): RegExp {
  return new RegExp(`^${globToRegExpSource(pattern)}$`);
}

function gitignoreMatches(
  filePath: string,
  root: string,
  rules: IgnoreRule[],
  { isDir }: { isDir: boolean },
): boolean {
  if (rules.length === 0) {
    return false;
  }
  const relPath = toPosix(relativePath(filePath, { displayRoot: root }));
  let ignored = false;
  const relName = relPath.split("/").at(-1) ?? relPath;
  for (const rule of rules) {
    if (gitignoreRuleMatches(rule, relPath, relName, { isDir })) {
      ignored = !rule.include;
    }
  }
  return ignored;
}

function gitignoreRuleMatches(
  rule: IgnoreRule,
  relPath: string,
  relName: string,
  { isDir }: { isDir: boolean },
): boolean {
  if (rule.directoryOnly && !isDir) {
    return false;
  }
  if (rule.basenamePattern?.test(relName)) {
    return true;
  }
  return rule.pathPatterns.some((pattern) => pattern.test(relPath));
}

function hasAnyFile(targetPath: string): boolean {
  let entries = [];
  try {
    entries = readdirSync(targetPath, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isFile()) {
      return true;
    }
    if (entry.isDirectory() && hasAnyFile(childPath)) {
      return true;
    }
  }
  return false;
}

function isFileOrDir(filePath: string): boolean {
  try {
    const stats = statSync(filePath);
    return stats.isFile() || stats.isDirectory();
  } catch {
    return false;
  }
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) {
      continue;
    }
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else if (char === "[") {
      const closeIndex = pattern.indexOf("]", index + 1);
      if (closeIndex === -1) {
        source += "\\[";
      } else {
        source += pattern.slice(index, closeIndex + 1);
        index = closeIndex;
      }
    } else {
      source += escapeGlobLiteral(char);
    }
  }
  return source;
}

function escapeGlobLiteral(value: string): string {
  return value.replace(/[\\^$+?.()|{}]/g, "\\$&");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
