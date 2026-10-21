/** Owns the current-tree path, definition, and exact-text search lanes and the path-affinity ranking they share. */
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import { type SyntaxMatch, SyntaxSearch } from "../ast-grep/index.js";
import {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
} from "../source/extraction/index.js";
import {
  discoverFiles,
  isGeneratedPath,
  isTestPath,
  PYTHON_SUFFIXES,
  relativePath,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText, escapeRegExp } from "../text-utils.js";
import { compactSourceMatchText, ripgrepDefinitionMatches, ripgrepMatches } from "./ripgrep.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SOURCE_CANDIDATE_LIMIT = 1_000;

const SCRIPT_SYMBOL_KINDS = [
  "function_declaration",
  "method_definition",
  "class_declaration",
  "lexical_declaration",
  "variable_declaration",
];
const SYMBOL_KINDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: SCRIPT_SYMBOL_KINDS,
  tsx: SCRIPT_SYMBOL_KINDS,
  javascript: SCRIPT_SYMBOL_KINDS,
  jsx: SCRIPT_SYMBOL_KINDS,
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

export function isImplementationSourceMatch(match: SourceMatch): boolean {
  return isImplementationSourcePath(match.filePath);
}

/** Test files qualify; only unsupported suffixes and generated paths are excluded. */
export function isImplementationSourcePath(filePath: string): boolean {
  const suffix = path.extname(filePath).toLowerCase();
  return (
    (PYTHON_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) && !isGeneratedPath(filePath)
  );
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

/** A multi-word phrase is searched as identifier forms of its terms and keeps only definitions that look callable; candidates are over-fetched so that filter runs before `limit`. */
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
  const phraseIntent = !IDENTIFIER_RE.test(searchText);
  const candidateLimit =
    includeTests && !phraseIntent ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT);
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const symbolGroups = astGrepSymbolMatches(root, symbols, { limit: candidateLimit });
  for (const [index, symbol] of symbols.entries()) {
    const syntaxMatches = symbolGroups[index] ?? [];
    const syntaxLines = new Set(
      syntaxMatches.map((match) => JSON.stringify([path.normalize(match.filePath), match.line])),
    );
    const candidates = [
      ...syntaxMatches,
      ...ripgrepDefinitionMatches(root, symbol, { limit: candidateLimit }).filter(
        (match) => !syntaxLines.has(JSON.stringify([path.normalize(match.filePath), match.line])),
      ),
    ];
    for (const match of candidates) {
      if (matches.length >= candidateLimit) {
        break;
      }
      const location = JSON.stringify([path.normalize(match.filePath), match.line, match.column]);
      if (
        (!includeTests && isTestPath(match.filePath)) ||
        (phraseIntent && !isCallableDefinition(match, symbol)) ||
        seen.has(location)
      ) {
        continue;
      }
      seen.add(location);
      matches.push(match);
    }
  }
  return rankSourceMatches(matches, searchText).slice(0, limit);
}

function isCallableDefinition(match: SourceMatch, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  const modifiers = String.raw`(?:(?:export|default|abstract|async|declare|public|protected|private|static|override|readonly)\s+)*`;
  const declaration = String.raw`(?:(?:function|class|def)\s+)?${escaped}(?:\b|\s*\()`;
  return new RegExp(`^${modifiers}${declaration}`).test(match.text);
}

/**
 * Literal, case-insensitive text search ranked by path affinity.
 *
 * Symbol definitions are not repeated here: every caller runs `definitionMatches` first and reaches text search only after it found no definition.
 */
export function sourceMatches(
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
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const textMatches = rankSourceMatches(
    ripgrepMatches(root, searchText, {
      includeTests,
      limit: includeTests ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT),
    }),
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

/** Only queries with a separator, a known suffix, or a config basename count as paths; matching is case-insensitive, with exact paths first, then trailing-segment and substring matches. */
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

function pathLikeSearchText(searchText: string): boolean {
  const query = searchText.trim();
  if (/[/\\]/.test(query) || CONFIG_BASENAMES.has(query)) {
    return true;
  }
  return Object.hasOwn(LANGUAGE_BY_SUFFIX, path.extname(query).toLowerCase());
}

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

function rankSourceMatches(matches: SourceMatch[], searchText: string): SourceMatch[] {
  return matches.slice().sort((left, right) => compareSourceMatches(left, right, searchText));
}

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

/** Lower sorts first: starting from `sourcePathRank`, definitions rise and lines mentioning `deprecated` sink. */
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

/** Lower sorts first: up to three query terms in the path offset penalties for paths outside `src/`, tests, config and docs, and generated files. */
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

/** Lowercase terms of at least three characters minus stop words: `how the CLI parses args` → `cli`, `parses`, `args`. */
function searchTerms(searchText: string): string[] {
  return (searchText.match(/[A-Za-z0-9_$]+/g) ?? [])
    .map((term) => term.toLowerCase())
    .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term));
}

/** Spells a phrase's terms as identifiers, as in `parse config` → `parseConfig`, `ParseConfig`, `parse_config`; a lone identifier passes through, and fewer than two terms yield none. */
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

/** Parses each file once for all variants, while each variant keeps its own candidate bound. */
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
    if (matches === null) return groups;
    for (const [index, rows] of matches.entries()) {
      groups[index]!.push(...rows.map(astGrepMatch));
    }
    if (groups.every((group) => group.length >= limit)) {
      break;
    }
  }
  return groups;
}

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
