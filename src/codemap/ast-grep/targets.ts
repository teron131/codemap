/** Resolves structural-search paths and language coverage without changing traversal order or root boundaries. */
import { readdirSync } from "node:fs";
import path from "node:path";

import { expandUser, isDirectory, isFile } from "../common.js";
import { IGNORED_DIR_NAMES, ROOT_IGNORED_DIR_NAMES } from "../source/scanner/constants.js";
import { compareText } from "../text-utils.js";

const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
};

export const SYNTAX_SUFFIXES_BY_LANGUAGE: Record<string, Set<string>> = {
  javascript: new Set([".cjs", ".js", ".jsx", ".mjs"]),
  jsx: new Set([".jsx"]),
  python: new Set([".py"]),
  tsx: new Set([".tsx"]),
  typescript: new Set([".cts", ".mts", ".ts", ".tsx"]),
};

const INFERRED_SYNTAX_LANGUAGES = [
  { language: "typescript", suffixes: new Set([".cts", ".mts", ".ts"]) },
  { language: "tsx", suffixes: new Set([".tsx"]) },
  { language: "javascript", suffixes: new Set([".cjs", ".js", ".mjs"]) },
  { language: "jsx", suffixes: new Set([".jsx"]) },
  { language: "python", suffixes: new Set([".py"]) },
];

/** Normalizes language aliases for ast-grep. */
export function normalizeLanguage(lang: string): string {
  return LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang;
}

/** Resolves project target files for ast-grep operations. */
export function targetFiles(root: string, paths: string[]): string[] {
  const files: string[] = [];
  for (const rawPath of paths.length > 0 ? paths : ["."]) {
    const resolvedPath = resolveProjectFile(root, rawPath);
    const candidates = isFile(resolvedPath)
      ? [resolvedPath]
      : isDirectory(resolvedPath)
        ? recursiveFiles(resolvedPath)
        : [];
    files.push(...candidates.filter((candidate) => shouldScanAstGrepFile(candidate, root)));
  }
  return files;
}

/** Checks whether ast-grep should scan a filesystem path. */
function shouldScanAstGrepFile(filePath: string, root: string): boolean {
  let relParts: string[];
  const relative = path.relative(root, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    relParts = relative.split(path.sep);
  } else {
    relParts = filePath.split(path.sep).filter(Boolean);
  }
  return !relParts
    .slice(0, -1)
    .some(
      (part, index) =>
        IGNORED_DIR_NAMES.has(part) || (index === 0 && ROOT_IGNORED_DIR_NAMES.has(part)),
    );
}

/** Resolves a project-relative file and rejects paths outside the root. */
export function resolveProjectFile(root: string, rawPath: string): string {
  const projectRoot = path.resolve(root);
  const expanded = expandUser(rawPath);
  const candidate = path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded);
  const resolved = path.resolve(candidate);
  const relative = path.relative(projectRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path is outside project root: ${rawPath}`);
  }
  return resolved;
}

/** Lists target files recursively for ast-grep fallback scans. */
function recursiveFiles(directory: string): string[] {
  const files: string[] = [];
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      compareText(left.name, right.name),
    );
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      files.push(...recursiveFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

/** Infers each syntax variant from one already resolved file inventory. */
export function languagesForFiles(files: string[]): string[] {
  const suffixes = new Set(files.map((file) => path.extname(file)));
  return INFERRED_SYNTAX_LANGUAGES.filter((candidate) =>
    [...candidate.suffixes].some((suffix) => suffixes.has(suffix)),
  ).map((candidate) => candidate.language);
}
