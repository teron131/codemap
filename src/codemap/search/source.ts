/** Combines ast-grep symbol hits and ripgrep text hits into source matches. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import { contextLines, ruleMatches, type SyntaxMatch, targetFiles } from "../ast-grep/index.js";
import { CONFIG_BASENAMES, LANGUAGE_BY_SUFFIX, runScan } from "../source/extraction/index.js";
import { IGNORED_DIR_NAMES } from "../source/scanner/index.js";
import { isGeneratedSignalPath, isTestPath } from "../source/signals/policy.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SOURCE_MATCH_TEXT_LIMIT = 240;
const SOURCE_CANDIDATE_LIMIT = 1_000;
const DEFINITION_SOURCE_GLOBS = ["*.js", "*.jsx", "*.py", "*.ts", "*.tsx"];

const SYMBOL_KINDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: [
    "function_declaration",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
  tsx: ["function_declaration", "class_declaration", "lexical_declaration", "variable_declaration"],
  javascript: [
    "function_declaration",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
  jsx: ["function_declaration", "class_declaration", "lexical_declaration", "variable_declaration"],
  python: ["function_definition", "class_definition", "assignment"],
};

export type SourceMatch = {
  engine: "ast-grep" | "path" | "regex" | "rg";
  kind: string;
  filePath: string;
  line: number;
  column: number;
  text: string;
};

export type SourceFallbackGroup = {
  term: string;
  matches: SourceMatch[];
  truncated: boolean;
};

type JsonMatchParser = (payload: Record<string, unknown>) => SourceMatch | null;

const FALLBACK_TERM_LIMIT = 8;
const FALLBACK_MATCHES_PER_TERM = 2;
const FALLBACK_CANDIDATE_LIMIT = 100;

const SEARCH_STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "can",
  "for",
  "from",
  "how",
  "into",
  "the",
  "this",
  "that",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

/** Finds exact current-tree definitions for identifier-shaped queries. */
export function definitionMatches(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
  }: {
    includeTests?: boolean;
    limit: number;
  },
): SourceMatch[] {
  if (!IDENTIFIER_RE.test(searchText)) {
    return [];
  }
  const candidateLimit = includeTests ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT);
  return rankSourceMatches(
    ripgrepDefinitionMatches(root, searchText, {
      limit: candidateLimit,
    }).filter((match) => includeTests || !isTestPath(match.filePath)),
    searchText,
  ).slice(0, limit);
}

/** Searches source text and symbols across target files. */
export function sourceMatches(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
    textOnly = false,
  }: {
    includeTests?: boolean;
    limit: number;
    textOnly?: boolean;
  },
): SourceMatch[] {
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const candidateLimit = includeTests ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT);
  if (!textOnly && IDENTIFIER_RE.test(searchText)) {
    for (const sourceMatch of astGrepSymbolMatches(root, searchText, {
      limit: candidateLimit,
    })) {
      if (!includeTests && isTestPath(sourceMatch.filePath)) {
        continue;
      }
      appendMatch(matches, seen, sourceMatch, { limit });
      if (matches.length >= limit) {
        return matches;
      }
    }
  }
  const textMatches = rankSourceMatches(
    ripgrepMatches(root, searchText, {
      limit: includeTests
        ? limit - matches.length
        : Math.max(limit - matches.length, SOURCE_CANDIDATE_LIMIT),
    }),
    searchText,
  );
  for (const sourceMatch of textMatches) {
    if (!includeTests && isTestPath(sourceMatch.filePath)) {
      continue;
    }
    appendMatch(matches, seen, sourceMatch, { limit });
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

/** Finds exact basenames and partial project paths for path-shaped queries. */
export function pathMatches(
  root: string,
  searchText: string,
  { limit }: { limit: number },
): SourceMatch[] {
  if (!pathLikeSearchText(searchText)) {
    return [];
  }
  const query = searchText.replaceAll("\\", "/").replace(/^\.\//, "");
  const queryLower = query.toLowerCase();
  return runScan(root)
    .files.filter((entry) => {
      const filePath = entry.path.toLowerCase();
      return (
        filePath === queryLower ||
        filePath.endsWith(`/${queryLower}`) ||
        filePath.includes(queryLower)
      );
    })
    .sort((left, right) => {
      const leftExact = pathExactness(left.path, queryLower);
      const rightExact = pathExactness(right.path, queryLower);
      return leftExact - rightExact || compareText(left.path, right.path);
    })
    .slice(0, limit)
    .map((entry) => ({
      engine: "path",
      kind: "file",
      filePath: entry.path,
      line: 1,
      column: 1,
      text: entry.path,
    }));
}

/** Finds code paths containing every meaningful term in a multi-word concept query. */
export function conceptPathMatches(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
  }: {
    includeTests?: boolean;
    limit: number;
  },
): SourceMatch[] {
  const terms = searchTerms(searchText);
  if (terms.length < 2) {
    return [];
  }
  return runScan(root)
    .files.filter((entry) => {
      const filePath = entry.path.toLowerCase();
      return (
        entry.fileCategory === "code" &&
        terms.every((term) => filePath.includes(term)) &&
        !isGeneratedSignalPath(entry.path) &&
        (includeTests || !isTestPath(entry.path))
      );
    })
    .sort(
      (left, right) => left.path.length - right.path.length || compareText(left.path, right.path),
    )
    .slice(0, limit)
    .map((entry) => ({
      engine: "path",
      kind: "file",
      filePath: entry.path,
      line: 1,
      column: 1,
      text: entry.path,
    }));
}

/** Checks whether a query carries a file suffix or path separator. */
function pathLikeSearchText(searchText: string): boolean {
  const query = searchText.trim();
  if (/[/\\]/.test(query) || CONFIG_BASENAMES.has(query)) {
    return true;
  }
  return Object.hasOwn(LANGUAGE_BY_SUFFIX, path.extname(query).toLowerCase());
}

/** Ranks an exact path before basename and partial-path matches. */
function pathExactness(filePath: string, queryLower: string): number {
  const lower = filePath.toLowerCase();
  if (lower === queryLower) {
    return 0;
  }
  if (lower.endsWith(`/${queryLower}`)) {
    return 1;
  }
  return 2;
}

/** Finds partial source matches when a full phrase has no direct hits. */
export function sourceFallbackMatches(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
    textOnly = false,
  }: {
    includeTests?: boolean;
    limit: number;
    textOnly?: boolean;
  },
): SourceFallbackGroup[] {
  const groups: SourceFallbackGroup[] = [];
  const seenMatches = new Set<string>();
  for (const term of fallbackTerms(searchText).slice(0, FALLBACK_TERM_LIMIT)) {
    const matches: SourceMatch[] = [];
    const candidateLimit = FALLBACK_CANDIDATE_LIMIT;
    const candidatesForTerm = (
      textOnly
        ? ripgrepMatches(root, term, { limit: candidateLimit })
        : sourceMatches(root, term, { includeTests, limit: candidateLimit })
    ).filter((match) => includeTests || !isTestPath(match.filePath));
    const candidates = rankSourceMatches(candidatesForTerm, term);
    for (const match of candidates) {
      appendMatch(matches, seenMatches, match, {
        limit: FALLBACK_MATCHES_PER_TERM,
      });
      if (matches.length >= FALLBACK_MATCHES_PER_TERM) {
        break;
      }
    }
    if (matches.length === 0) {
      continue;
    }
    groups.push({
      term,
      matches,
      truncated: candidates.length > matches.length,
    });
    if (groups.length >= limit) {
      break;
    }
  }
  return groups;
}

/** Builds meaningful fallback terms from a phrase. */
function fallbackTerms(searchText: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const token of searchText.match(/[A-Za-z0-9_$]+/g) ?? []) {
    for (const term of fallbackTermVariants(token)) {
      const key = term.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

/** Expands one fallback term into simple source-search variants. */
function fallbackTermVariants(token: string): string[] {
  const normalized = token.trim();
  const lower = normalized.toLowerCase();
  if (normalized.length < 3 || SEARCH_STOP_WORDS.has(lower)) {
    return [];
  }
  if (lower.endsWith("ies") && normalized.length > 4) {
    return [`${normalized.slice(0, -3)}y`, normalized];
  }
  if (/[cs]hes$|xes$|zes$|ses$/.test(lower) && normalized.length > 4) {
    return [normalized.slice(0, -2), normalized];
  }
  if (lower.endsWith("s") && normalized.length > 4) {
    return [normalized.slice(0, -1), normalized];
  }
  return [normalized];
}

/** Ranks matches toward definitions and source code over config, docs, and tests. */
function rankSourceMatches(matches: SourceMatch[], searchText: string): SourceMatch[] {
  return matches.slice().sort((left, right) => {
    const leftRank = sourceMatchRank(left, searchText);
    const rightRank = sourceMatchRank(right, searchText);
    return (
      leftRank - rightRank ||
      compareText(left.filePath, right.filePath) ||
      left.line - right.line ||
      left.column - right.column
    );
  });
}

/** Scores one match by how useful it is as a next code-reading lead. */
function sourceMatchRank(match: SourceMatch, searchText: string): number {
  const filePath = match.filePath.replace(/^\.\//, "");
  const lower = filePath.toLowerCase();
  let rank = 0;
  if (!lower.startsWith("src/")) {
    rank += 4;
  }
  if (lower.includes("/test") || lower.includes(".test.") || lower.includes("_test.")) {
    rank += 3;
  }
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".toml")
  ) {
    rank += 5;
  }
  if (isGeneratedSignalPath(filePath)) {
    rank += 8;
  }
  if (/\bdeprecated\b/i.test(match.text)) {
    rank += 4;
  }
  if (match.engine === "ast-grep" || match.kind === "symbol") {
    rank -= 1;
  }
  const pathTermMatches = searchTerms(searchText).filter((term) => lower.includes(term)).length;
  rank -= Math.min(pathTermMatches, 3) * 2;
  return rank;
}

/** Extracts useful lowercase query terms for path-affinity ranking. */
function searchTerms(searchText: string): string[] {
  return (searchText.match(/[A-Za-z0-9_$]+/g) ?? [])
    .map((term) => term.toLowerCase())
    .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term));
}

/** Finds common Python and TypeScript/JavaScript definition forms with ripgrep. */
function ripgrepDefinitionMatches(
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
  );
}

/** Finds likely symbol matches with ast-grep before rg fallback. */
function astGrepSymbolMatches(
  root: string,
  symbol: string,
  { limit }: { limit: number },
): SourceMatch[] {
  const matches: SourceMatch[] = [];
  for (const [language, kinds] of Object.entries(SYMBOL_KINDS_BY_LANGUAGE)) {
    const symbolMatches = ruleMatches(root, language, symbolMatchConfig(symbol, kinds), ["."], {
      limit: limit - matches.length,
    });
    if (symbolMatches === null) {
      if (language === "python") {
        matches.push(
          ...pythonSymbolMatches(root, symbol, {
            limit: limit - matches.length,
          }),
        );
        return matches.slice(0, limit);
      }
      return matches;
    }
    for (const match of symbolMatches) {
      matches.push(astGrepMatch(match));
    }
    if (matches.length >= limit) {
      return matches;
    }
  }
  return matches;
}

/** Finds Python definitions or assignments that match a symbol name. */
function pythonSymbolMatches(
  root: string,
  symbol: string,
  { limit }: { limit: number },
): SourceMatch[] {
  const matches: SourceMatch[] = [];
  for (const filePath of targetFiles(root, ["."], "python")) {
    if (matches.length >= limit) {
      break;
    }
    let source = "";
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const sourceLines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const relPath = filePathRelative(root, filePath);
    for (let index = 0; index < sourceLines.length; index += 1) {
      if (matches.length >= limit) {
        break;
      }
      const line = sourceLines[index] ?? "";
      const definition = pythonDefinitionMatch(line, symbol);
      if (definition !== null) {
        const endIndex = pythonBlockEnd(sourceLines, index, definition.indent);
        matches.push(
          astGrepMatch({
            engine: "regex",
            filePath: relPath,
            text: sourceLines.slice(index, endIndex + 1).join("\n"),
            line: index + 1,
            column: definition.column,
            endLine: endIndex + 1,
            endColumn: (sourceLines[endIndex] ?? "").length + 1,
            lines: contextLines(sourceLines, index, endIndex),
          }),
        );
        continue;
      }
      const assignment = pythonAssignmentMatch(line, symbol);
      if (assignment !== null) {
        matches.push(
          astGrepMatch({
            engine: "regex",
            filePath: relPath,
            text: line,
            line: index + 1,
            column: assignment.column,
            endLine: index + 1,
            endColumn: line.length + 1,
            lines: line,
          }),
        );
      }
    }
  }
  return matches;
}

/** Builds ast-grep patterns for function, class, and export symbol queries. */
function symbolMatchConfig(symbol: string, kinds: string[]): NapiConfig {
  const escaped = escapeRegExp(symbol);
  return {
    rule: {
      any: kinds.map((kind) => ({
        kind,
        has: {
          kind: "identifier",
          regex: `^${escaped}$`,
        },
      })),
    },
  };
}

/** Finds ast-grep pattern matches for one source string. */
function astGrepMatch(match: SyntaxMatch): SourceMatch {
  return {
    engine: match.engine,
    kind: "symbol",
    filePath: match.filePath,
    line: match.line,
    column: match.column,
    text: compactSourceMatchText(match.lines || match.text),
  };
}

/** Runs ripgrep and converts output to source match rows. */
function ripgrepMatches(
  root: string,
  searchText: string,
  { limit }: { limit: number },
): SourceMatch[] {
  if (limit <= 0) {
    return [];
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
    ripgrepMatch,
    { limit },
  );
}

/** Builds ripgrep glob exclusions from the shared source-scan ignore set. */
function ripgrepExcludeArgs(): string[] {
  return [...IGNORED_DIR_NAMES].flatMap((name) => ["--glob", `!**/${name}/**`]);
}

/** Parses streamed ripgrep JSON into source match rows. */
function streamedJsonMatches(
  command: string[],
  root: string,
  parser: JsonMatchParser,
  { limit }: { limit: number },
): SourceMatch[] {
  if (limit <= 0) {
    return [];
  }
  const result = spawnSync(command[0] ?? "", command.slice(1), {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || !result.stdout) {
    return [];
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
  return matches;
}

/** Runs ripgrep for one query and returns the first text match. */
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

/** Compacts one source excerpt and marks character-level shortening. */
function compactSourceMatchText(value: string): string {
  const text = value.split(/\s+/).filter(Boolean).join(" ");
  if (text.length <= SOURCE_MATCH_TEXT_LIMIT) {
    return text;
  }
  return `${text.slice(0, SOURCE_MATCH_TEXT_LIMIT - 3).trimEnd()}...`;
}

/** Adds a source match once while respecting the result limit. */
function appendMatch(
  matches: SourceMatch[],
  seen: Set<string>,
  sourceMatch: SourceMatch,
  { limit }: { limit: number },
): void {
  if (matches.length >= limit) {
    return;
  }
  const key = JSON.stringify([sourceMatch.filePath, sourceMatch.line, sourceMatch.text]);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  matches.push(sourceMatch);
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Escapes text for literal use inside regular expressions. */
function escapeRegExp(value: string): string {
  return value.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** Locates a Python function, async function, or class definition line. */
function pythonDefinitionMatch(
  line: string,
  symbol: string,
): { indent: number; column: number } | null {
  const escaped = escapeRegExp(symbol);
  const match = new RegExp(`^(\\s*)(?:async\\s+def|def|class)\\s+${escaped}\\b`).exec(line);
  if (!match) {
    return null;
  }
  const indent = match[1]?.length ?? 0;
  return { indent, column: indent + 1 };
}

/** Locates a Python assignment line for a requested symbol. */
function pythonAssignmentMatch(line: string, symbol: string): { column: number } | null {
  const escaped = escapeRegExp(symbol);
  const match = new RegExp(`^(\\s*)${escaped}\\s*(?::[^=]+)?=`).exec(line);
  if (!match) {
    return null;
  }
  return { column: (match[1]?.length ?? 0) + 1 };
}

/** Finds where a Python definition block ends by indentation. */
function pythonBlockEnd(lines: string[], startIndex: number, baseIndent: number): number {
  let endIndex = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      endIndex = index;
      continue;
    }
    const indent = leadingWhitespaceLength(line);
    if (indent <= baseIndent) {
      break;
    }
    endIndex = index;
  }
  return endIndex;
}

/** Counts indentation characters before non-whitespace text. */
function leadingWhitespaceLength(value: string): number {
  return value.match(/^\s*/)?.[0].length ?? 0;
}

/** Returns a project-relative path when a file is inside the root. */
function filePathRelative(root: string, filePath: string): string {
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}
