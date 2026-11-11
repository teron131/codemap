/** Resolves structural-search targets inside the project root and infers their languages. Directory walks sort entries, skip symlinks, and honor the scanner's ignored directories but not `.gitignore`. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { expandUser, isDirectory, isFile } from "../path-utils.js";
import { IGNORED_DIR_NAMES, ROOT_IGNORED_DIR_NAMES } from "../source/scanner/index.js";
import { compareText } from "../text-utils.js";

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

/** No paths means the whole root; paths that do not exist contribute no files, while paths outside the root throw. */
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

/** Returns languages in a fixed TypeScript, TSX, JavaScript, JSX, Python order, which sets the order of search output. */
export function languagesForFiles(files: string[]): string[] {
  const suffixes = new Set(files.map((file) => path.extname(file)));
  return INFERRED_SYNTAX_LANGUAGES.filter((candidate) =>
    [...candidate.suffixes].some((suffix) => suffixes.has(suffix)),
  ).map((candidate) => candidate.language);
}

/** Returns root-relative paths, reading a relative path against the root first and the working directory second; absolute paths outside the root throw. */
export function resolveTargetPaths(root: string, paths: string[]): string[] {
  if (paths.length === 0) {
    return ["."];
  }
  const resolved = [];
  const rootResolved = path.resolve(root);
  for (const rawPath of paths) {
    const candidate = expandUser(rawPath);
    if (path.isAbsolute(candidate)) {
      const resolvedCandidate = path.resolve(candidate);
      const relative = path.relative(rootResolved, resolvedCandidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`search path is outside project root: ${rawPath}`);
      }
      resolved.push(relative.split(path.sep).join("/"));
    } else {
      resolved.push(relativeTargetPath(rootResolved, candidate));
    }
  }
  return resolved;
}

function relativeTargetPath(root: string, rawPath: string): string {
  const rootPath = path.resolve(root, rawPath);
  if (existsSync(rootPath)) {
    return rawPath;
  }
  const cwdPath = path.resolve(process.cwd(), rawPath);
  const relative = path.relative(root, cwdPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return rawPath;
}
