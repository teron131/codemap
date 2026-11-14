/** Builds a mixed-file inventory for graph sizing and language evidence without claiming syntax support. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { compareText, uniqueStrings } from "../../text-utils.js";
import {
  discoverFiles,
  isSupportedSourcePath,
  relativePath,
  sourceLineCount,
  TYPESCRIPT_LANG_BY_SUFFIX,
} from "../scanner/index.js";

export type InventoryEntry = {
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
  ".cs": "csharp",
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
  ".hs": "haskell",
  ".html": "html",
  ".java": "java",
  ".json": "json",
  ".jsonc": "jsonc",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".livemd": "markdown",
  ".lua": "lua",
  ".md": "markdown",
  ".mmd": "mermaid",
  ".php": "php",
  ".prisma": "prisma",
  ".proto": "protobuf",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".rules": "rules",
  ".scala": "scala",
  ".sh": "shell",
  ".sql": "sql",
  ".swift": "swift",
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

/** Reads every file to count its lines but parses none. */
export function buildInventory(
  root: string,
  filePaths: string[] = discoverFiles(root),
): InventoryEntry[] {
  return filePaths.map((filePath) => inventoryEntry(root, filePath));
}

export function inventoryEntry(root: string, filePath: string): InventoryEntry {
  const relPath = relativePath(filePath, { displayRoot: root });
  return {
    path: relPath,
    language: languageForPath(filePath),
    fileCategory: categoryForPath(relPath),
    sizeLines: countLines(filePath),
  };
}

/** Names a file's language from its suffix, falling back to the bare suffix and then `unknown`: `a.go` → `go`, `a.zig` → `zig`, `Makefile` → `unknown`. */
export function languageForPath(filePath: string): string {
  const suffix = path.extname(filePath);
  return LANGUAGE_BY_SUFFIX[suffix] ?? (suffix.replace(/^\./, "") || "unknown");
}

/** Sorted languages of the paths the working-tree scanner cannot parse, which only Codebase Memory can describe; a file without a suffix counts as `unsuffixed files`. */
export function backendOnlyLanguages(filePaths: string[]): string[] {
  return uniqueStrings(
    filePaths
      .filter((filePath) => !isSupportedSourcePath(filePath))
      .map((filePath) => (path.extname(filePath) ? languageForPath(filePath) : "unsuffixed files")),
  ).sort(compareText);
}

/** The status line every command prints above evidence that includes backend-only languages. */
export function backendOnlyCoverageLine(languages: string[]): string {
  return `coverage: backend only for ${languages.join(", ")}; working tree not parsed`;
}

function countLines(filePath: string): number {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return 0;
  }
  return sourceLineCount(text);
}

/** Returns `docs`, `config`, `infra`, `data`, or the `code` fallback, which also covers unrecognized files such as `logo.png`. */
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
