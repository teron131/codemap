/** Owns bounded ripgrep execution and conversion from process output to source-search rows. */
import { spawnSync } from "node:child_process";

import { arrayValue, recordValue } from "../json-utils.js";
import { ROOT_IGNORED_DIR_NAMES } from "../source/scanner/constants.js";
import {
  IGNORED_DIR_NAMES,
  isTestPath,
  PY_SUFFIXES,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { escapeRegExp } from "../text-utils.js";
import type { SourceMatch } from "./source.js";

const SOURCE_MATCH_TEXT_LIMIT = 240;
const SOURCE_SEARCH_BUFFER_LIMIT = 16 * 1024 * 1024;
const DEFINITION_SOURCE_GLOBS = ["*.js", "*.jsx", "*.py", "*.ts", "*.tsx"];
const SOURCE_CODE_GLOBS = [...PY_SUFFIXES, ...TYPESCRIPT_SUFFIXES].map((suffix) => `*${suffix}`);

export type RipgrepScanStatus = "complete" | "failed" | "truncated";

type JsonMatchParser = (payload: Record<string, unknown>) => SourceMatch | null;

type RipgrepMatchOptions = {
  includeTests?: boolean;
  limit: number;
};

type SourceMatchCollection = {
  matches: SourceMatch[];
  scanTruncated: boolean;
};

export type RipgrepFileCollection = {
  filePaths: string[];
  scanStatus: RipgrepScanStatus;
};

/** Finds common Python and TypeScript/JavaScript definition forms with ripgrep. */
export function ripgrepDefinitionMatches(
  root: string,
  symbol: string,
  { limit }: { limit: number },
): SourceMatch[] {
  const escaped = escapeRegExp(symbol);
  const declaration =
    String.raw`^[[:space:]]*(?:export[[:space:]]+(?:default[[:space:]]+)?)?` +
    String.raw`(?:(?:abstract|async|declare)[[:space:]]+)*` +
    String.raw`(?:class|def|enum|function|interface|type|const|let|var)[[:space:]]+${escaped}\b`;
  const pythonAssignment = String.raw`^[[:space:]]*${escaped}[[:space:]]*(?::[^=]+)?=[^=]`;
  return streamedJsonMatches(
    [
      "rg",
      "--json",
      "--ignore-case",
      "--line-number",
      "--column",
      "--max-count",
      "2",
      ...DEFINITION_SOURCE_GLOBS.flatMap((glob) => ["--glob", glob]),
      ...ripgrepExcludeArgs(),
      "-e",
      declaration,
      "-e",
      pythonAssignment,
      ".",
    ],
    root,
    (event) => {
      const match = ripgrepMatch(event);
      return match === null ? null : { ...match, engine: "regex", kind: "symbol" };
    },
    { limit },
  ).matches;
}

/** Finds all candidate file paths for one term without collecting repeated match rows. */
export function ripgrepFilesWithMatches(
  root: string,
  variants: string[],
  {
    includeTests,
    sourceOnly,
  }: {
    includeTests: boolean;
    sourceOnly: boolean;
  },
): RipgrepFileCollection {
  const command = [
    "rg",
    "--files-with-matches",
    "--fixed-strings",
    "--ignore-case",
    ...(sourceOnly ? SOURCE_CODE_GLOBS.flatMap((glob) => ["--glob", glob]) : []),
    ...ripgrepExcludeArgs(),
    ...variants.flatMap((variant) => ["-e", variant]),
    ".",
  ];
  const result = spawnSync(command[0] ?? "", command.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: SOURCE_SEARCH_BUFFER_LIMIT,
  });
  const scanTruncated = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS";
  const scanStatus = scanTruncated
    ? "truncated"
    : result.error !== undefined ||
        result.status === null ||
        (result.status !== 0 && result.status !== 1)
      ? "failed"
      : "complete";
  if (!result.stdout) {
    return { filePaths: [], scanStatus };
  }
  const filePaths = [...new Set(result.stdout.split(/\r?\n/).filter(Boolean))].filter(
    (filePath) => includeTests || !isTestPath(filePath),
  );
  return { filePaths, scanStatus };
}

/** Runs ripgrep and converts output to source match rows. */
export function ripgrepMatches(
  root: string,
  searchText: string,
  options: RipgrepMatchOptions,
): SourceMatchCollection {
  const includeTests = options.includeTests ?? false;
  const limit = options.limit;
  if (limit <= 0) {
    return { matches: [], scanTruncated: false };
  }
  return streamedJsonMatches(
    [
      "rg",
      "--json",
      "--fixed-strings",
      "--ignore-case",
      "--line-number",
      "--column",
      "--max-count",
      "2",
      "--max-columns",
      "240",
      ...ripgrepExcludeArgs(),
      "--",
      searchText,
      ".",
    ],
    root,
    (event) => {
      const match = ripgrepMatch(event);
      return match === null || (!includeTests && isTestPath(match.filePath)) ? null : match;
    },
    { limit },
  );
}

/** Compacts one source excerpt and marks character-level shortening. */
export function compactSourceMatchText(value: string): string {
  const text = value.split(/\s+/).filter(Boolean).join(" ");
  if (text.length <= SOURCE_MATCH_TEXT_LIMIT) {
    return text;
  }
  return `${text.slice(0, SOURCE_MATCH_TEXT_LIMIT - 3).trimEnd()}...`;
}

/** Builds ripgrep glob exclusions from the shared source-scan ignore set. */
function ripgrepExcludeArgs(): string[] {
  return [
    ...[...IGNORED_DIR_NAMES].flatMap((name) => ["--glob", `!**/${name}/**`]),
    ...[...ROOT_IGNORED_DIR_NAMES].flatMap((name) => ["--glob", `!${name}/**`]),
  ];
}

/** Parses complete ripgrep JSON events from the bounded synchronous output prefix. */
function streamedJsonMatches(
  command: string[],
  root: string,
  parser: JsonMatchParser,
  { limit }: { limit: number },
): SourceMatchCollection {
  if (limit <= 0) {
    return { matches: [], scanTruncated: false };
  }
  const result = spawnSync(command[0] ?? "", command.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: SOURCE_SEARCH_BUFFER_LIMIT,
  });
  const scanTruncated = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS";
  if ((result.error && !scanTruncated) || !result.stdout) {
    return { matches: [], scanTruncated: false };
  }
  const matches: SourceMatch[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let sourceMatch: SourceMatch | null = null;
    try {
      sourceMatch = parser(JSON.parse(line));
    } catch {
      sourceMatch = null;
    }
    if (sourceMatch === null) {
      continue;
    }
    matches.push(sourceMatch);
    if (matches.length >= limit) {
      break;
    }
  }
  return { matches, scanTruncated };
}

/** Converts one ripgrep JSON match event into a source row. */
function ripgrepMatch(rgEvent: Record<string, unknown>): SourceMatch | null {
  if (rgEvent.type !== "match") {
    return null;
  }
  const matchData = recordValue(rgEvent.data);
  const pathText = recordValue(matchData.path).text;
  const lineText = recordValue(matchData.lines).text;
  if (!pathText || !lineText) {
    return null;
  }
  const submatches = arrayValue(matchData.submatches);
  const firstSubmatch = recordValue(submatches[0]);
  const column = Number(firstSubmatch.start ?? 0) + 1;
  return {
    engine: "rg",
    kind: "text",
    filePath: String(pathText),
    line: Number(matchData.line_number ?? 0),
    column,
    text: compactSourceMatchText(String(lineText)),
  };
}
