/** Owns source-search lanes, symbol extraction, path matching, and result ranking policy. */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import { contextLines, type SyntaxMatch, SyntaxSearch, targetFiles } from "../ast-grep/index.js";
import {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
} from "../source/extraction/index.js";
import {
  discoverFiles,
  isGeneratedPath,
  isTestPath,
  PY_SUFFIXES,
  relativePath,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText, escapeRegExp } from "../text-utils.js";
import { compactSourceMatchText, ripgrepDefinitionMatches, ripgrepMatches } from "./ripgrep.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SOURCE_CANDIDATE_LIMIT = 1_000;

const SYMBOL_KINDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: [
    "function_declaration",
    "method_definition",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
  tsx: [
    "function_declaration",
    "method_definition",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
  javascript: [
    "function_declaration",
    "method_definition",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
  jsx: [
    "function_declaration",
    "method_definition",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
  ],
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

/** Checks whether a match points to supported, non-generated implementation source. */
export function isImplementationSourceMatch(match: SourceMatch): boolean {
  return isImplementationSourcePath(match.filePath);
}

/** Checks whether a path belongs to supported, non-generated implementation source. */
export function isImplementationSourcePath(filePath: string): boolean {
  const suffix = path.extname(filePath).toLowerCase();
  return (PY_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) && !isGeneratedPath(filePath);
}

export const SEARCH_STOP_WORDS = new Set([
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
  const symbols = definitionSymbols(searchText);
  if (symbols.length === 0) {
    return [];
  }
  const candidateLimit = includeTests ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT);
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const phraseIntent = !IDENTIFIER_RE.test(searchText);
  const symbolGroups = astGrepSymbolMatches(root, symbols, { limit: candidateLimit });
  for (const [index, symbol] of symbols.entries()) {
    const candidates = [
      ...(symbolGroups[index] ?? []),
      ...ripgrepDefinitionMatches(root, symbol, { limit: candidateLimit }),
    ];
    for (const match of candidates) {
      if (
        (!includeTests && isTestPath(match.filePath)) ||
        (phraseIntent && !isCallableDefinition(match, symbol))
      ) {
        continue;
      }
      appendMatch(matches, seen, match, { limit: candidateLimit });
    }
  }
  return rankSourceMatches(matches, searchText).slice(0, limit);
}

/** Keeps phrase-derived definition intent on functions, methods, and classes instead of similarly named state. */
function isCallableDefinition(match: SourceMatch, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  const modifiers = String.raw`(?:(?:export|default|abstract|async|declare|public|protected|private|static|override|readonly)\s+)*`;
  const declaration = String.raw`(?:(?:function|class|def)\s+)?${escaped}(?:\b|\s*\()`;
  return new RegExp(`^${modifiers}${declaration}`).test(match.text);
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
    for (const sourceMatch of astGrepSymbolMatches(root, [searchText], {
      limit: candidateLimit,
    })[0] ?? []) {
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
      includeTests,
      limit: includeTests
        ? limit - matches.length
        : Math.max(limit - matches.length, SOURCE_CANDIDATE_LIMIT),
    }).matches,
    searchText,
  );
  for (const sourceMatch of textMatches) {
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
  return discoverFiles(root)
    .map((filePath) => relativePath(filePath, { displayRoot: root }))
    .filter((filePath) => {
      const lowerPath = filePath.toLowerCase();
      return (
        lowerPath === queryLower ||
        lowerPath.endsWith(`/${queryLower}`) ||
        lowerPath.includes(queryLower)
      );
    })
    .sort((left, right) => {
      const leftExact = pathExactness(left, queryLower);
      const rightExact = pathExactness(right, queryLower);
      return leftExact - rightExact || compareText(left, right);
    })
    .slice(0, limit)
    .map((filePath) => ({
      engine: "path",
      kind: "file",
      filePath,
      line: 1,
      column: 1,
      text: filePath,
    }));
}

/** Finds code paths containing every meaningful term in a multi-word concept query. */
export function conceptPathMatches(
  root: string,
  searchText: string,
  {
    filePaths,
    includeTests = false,
    limit,
  }: {
    filePaths: string[];
    includeTests?: boolean;
    limit: number;
  },
): SourceMatch[] {
  const terms = searchTerms(searchText);
  if (terms.length < 2) {
    return [];
  }
  return filePaths
    .map((filePath) => relativePath(filePath, { displayRoot: root }))
    .filter((filePath) => {
      const lowerPath = filePath.toLowerCase();
      return (
        categoryForPath(filePath) === "code" &&
        terms.every((term) => lowerPath.includes(term)) &&
        !isGeneratedPath(filePath) &&
        (includeTests || !isTestPath(filePath))
      );
    })
    .sort((left, right) => left.length - right.length || compareText(left, right))
    .slice(0, limit)
    .map((filePath) => ({
      engine: "path",
      kind: "file",
      filePath,
      line: 1,
      column: 1,
      text: filePath,
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

/** Ranks matches toward definitions and source code over config, docs, and tests. */
function rankSourceMatches(matches: SourceMatch[], searchText: string): SourceMatch[] {
  return matches.slice().sort((left, right) => compareSourceMatches(left, right, searchText));
}

/** Applies the deterministic source-match tie breakers shared by normal and partial search. */
function compareSourceMatches(left: SourceMatch, right: SourceMatch, searchText: string): number {
  const leftRank = sourceMatchRank(left, searchText);
  const rightRank = sourceMatchRank(right, searchText);
  return (
    leftRank - rightRank ||
    compareText(left.filePath, right.filePath) ||
    left.line - right.line ||
    left.column - right.column
  );
}

/** Scores one match by how useful it is as a next code-reading lead. */
function sourceMatchRank(match: SourceMatch, searchText: string): number {
  let rank = sourcePathRank(match.filePath, searchText);
  if (/\bdeprecated\b/i.test(match.text)) {
    rank += 4;
  }
  if (match.engine === "ast-grep" || match.kind === "symbol") {
    rank -= 1;
  }
  return rank;
}

/** Scores a source path independently of match-row details. */
export function sourcePathRank(filePath: string, searchText: string): number {
  const normalizedPath = filePath.replace(/^\.\//, "");
  const lower = normalizedPath.toLowerCase();
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
  if (isGeneratedPath(normalizedPath)) {
    rank += 8;
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

/** Converts a concise concept phrase into common source identifier forms. */
function definitionSymbols(searchText: string): string[] {
  if (IDENTIFIER_RE.test(searchText)) {
    return [searchText];
  }
  const terms = searchTerms(searchText).slice(0, 6);
  if (terms.length < 2) {
    return [];
  }
  const titleTerms = terms.map((term) => `${term[0]?.toUpperCase() ?? ""}${term.slice(1)}`);
  return [`${terms[0]}${titleTerms.slice(1).join("")}`, titleTerms.join(""), terms.join("_")];
}

/** Evaluates identifier variants together without changing each variant's language order or candidate bound. */
function astGrepSymbolMatches(
  root: string,
  symbols: string[],
  { limit }: { limit: number },
): SourceMatch[][] {
  const groups: SourceMatch[][] = symbols.map(() => []);
  const search = new SyntaxSearch(root, ["."]);
  const prefilter = new RegExp(symbols.map(escapeRegExp).join("|"));
  for (const [language, kinds] of Object.entries(SYMBOL_KINDS_BY_LANGUAGE)) {
    const matches = search.matchRules(
      language,
      symbols.map((symbol, index) => ({
        config: symbolMatchConfig(symbol, kinds),
        limit: limit - groups[index]!.length,
      })),
      prefilter,
    );
    if (matches === null) {
      if (language === "python") {
        for (const [index, symbol] of symbols.entries()) {
          groups[index]!.push(
            ...pythonSymbolMatches(root, symbol, { limit: limit - groups[index]!.length }),
          );
        }
      }
      return groups;
    }
    for (const [index, rows] of matches.entries()) {
      groups[index]!.push(...rows.map(astGrepMatch));
    }
    if (groups.every((group) => group.length >= limit)) {
      break;
    }
  }
  return groups;
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
      any: kinds.map((kind) =>
        kind === "method_definition"
          ? {
              kind,
              has: {
                kind: "property_identifier",
                regex: `^${escaped}$`,
              },
            }
          : {
              kind,
              has: {
                kind: "identifier",
                regex: `^${escaped}$`,
              },
            },
      ),
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
