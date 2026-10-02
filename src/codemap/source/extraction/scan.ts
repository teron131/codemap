/** Builds a mixed-file inventory for graph sizing and language evidence without claiming syntax support. */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  discoverFiles,
  relativePath,
  sourceLineCount,
  TYPESCRIPT_LANG_BY_SUFFIX,
} from "../scanner/index.js";

export type ScanEntry = {
  path: string;
  language: string;
  fileCategory: string;
  sizeLines: number;
};

export const LANGUAGE_BY_SUFFIX: Record<string, string> = {
  ...TYPESCRIPT_LANG_BY_SUFFIX,
  ".c": "c",
  ".cc": "cpp",
  ".conf": "config",
  ".cpp": "cpp",
  ".css": "css",
  ".eex": "eex",
  ".erl": "erlang",
  ".ex": "elixir",
  ".exs": "elixir",
  ".go": "go",
  ".graphql": "graphql",
  ".h": "c-header",
  ".heex": "heex",
  ".hpp": "cpp-header",
  ".hrl": "erlang-header",
  ".html": "html",
  ".java": "java",
  ".json": "json",
  ".jsonc": "jsonc",
  ".livemd": "markdown",
  ".md": "markdown",
  ".mmd": "mermaid",
  ".prisma": "prisma",
  ".proto": "protobuf",
  ".py": "python",
  ".rs": "rust",
  ".rules": "rules",
  ".sh": "shell",
  ".sql": "sql",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export const CONFIG_BASENAMES = new Set([
  ".env",
  ".gitignore",
  "Cargo.toml",
  "Dockerfile",
  "go.mod",
  "package.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "ruff.toml",
  "tsconfig.json",
  "uv.lock",
]);

/** Scans project files into inventory rows. */
export function runScan(root: string, filePaths: string[] = discoverFiles(root)): ScanEntry[] {
  return filePaths.map((filePath) => scanEntry(root, filePath));
}

/** Builds one scan inventory entry from a project-relative path. */
export function scanEntry(root: string, filePath: string): ScanEntry {
  const relPath = relativePath(filePath, { displayRoot: root });
  const suffix = path.extname(filePath);
  return {
    path: relPath,
    language: LANGUAGE_BY_SUFFIX[suffix] ?? (suffix.replace(/^\./, "") || "unknown"),
    fileCategory: categoryForPath(relPath),
    sizeLines: countLines(filePath),
  };
}

/** Counts newline-delimited lines in source text. */
function countLines(filePath: string): number {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }
  return sourceLineCount(text);
}

/** Classifies a project path as code, docs, config, or data. */
export function categoryForPath(relPath: string): string {
  const lowerPath = relPath.toLowerCase();
  const name = path.basename(relPath);
  if (lowerPath.endsWith(".md") || lowerPath.endsWith(".rst") || lowerPath.endsWith(".txt")) {
    return "docs";
  }
  if (
    CONFIG_BASENAMES.has(name) ||
    lowerPath.endsWith(".json") ||
    lowerPath.endsWith(".toml") ||
    lowerPath.endsWith(".yaml") ||
    lowerPath.endsWith(".yml")
  ) {
    return "config";
  }
  if (
    lowerPath.startsWith(".github/") ||
    lowerPath.startsWith("deploy/") ||
    lowerPath.startsWith("infra/") ||
    lowerPath.startsWith("infrastructure/") ||
    name === "Dockerfile" ||
    name === "docker-compose.yml"
  ) {
    return "infra";
  }
  if (
    lowerPath.endsWith(".csv") ||
    lowerPath.endsWith(".db") ||
    lowerPath.endsWith(".parquet") ||
    lowerPath.endsWith(".proto") ||
    lowerPath.endsWith(".graphql") ||
    lowerPath.endsWith(".prisma") ||
    lowerPath.endsWith(".sql")
  ) {
    return "data";
  }
  return "code";
}
