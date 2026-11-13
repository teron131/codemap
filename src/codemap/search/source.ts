/** Owns the working-tree path, definition, and exact-text search lanes and the path-affinity ranking they share. */
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
} from "../source/extraction/index.js";
import {
  discoverFiles,
  type FileMetrics,
  isGeneratedPath,
  isMemberOf,
  isTestPath,
  PYTHON_SUFFIXES,
  type QualifiedName,
  qualifiedName,
  relativePath,
  scanFile,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { compareText, escapeRegExp } from "../text-utils.js";
import {
  compactSourceMatchText,
  ripgrepDefinitionMatches,
  ripgrepMatches,
  ripgrepOwnerFiles,
} from "./ripgrep.js";
import { type SyntaxMatch, SyntaxSearch } from "./structural.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SOURCE_CANDIDATE_LIMIT = 1_000;

// `const`, `let`, and `var` bindings have no kind here: their name sits under a `variable_declarator`, out of reach of the direct-child name test in `symbolMatchConfig`, so the line-pattern lane reports them.
const SCRIPT_SYMBOL_KINDS = ["function_declaration", "method_definition", "class_declaration"];
// Class fields are `public_field_definition` in the TypeScript grammars and `field_definition` in the JavaScript ones, and a rule naming a kind its grammar lacks throws.
const TYPESCRIPT_SYMBOL_KINDS = [...SCRIPT_SYMBOL_KINDS, "public_field_definition"];
const JAVASCRIPT_SYMBOL_KINDS = [...SCRIPT_SYMBOL_KINDS, "field_definition"];
const SYMBOL_KINDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: TYPESCRIPT_SYMBOL_KINDS,
  tsx: TYPESCRIPT_SYMBOL_KINDS,
  javascript: JAVASCRIPT_SYMBOL_KINDS,
  jsx: JAVASCRIPT_SYMBOL_KINDS,
  python: ["function_definition", "class_definition", "assignment"],
};
const PROPERTY_NAMED_KINDS = new Set([
  "method_definition",
  "public_field_definition",
  "field_definition",
]);

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

/**
 * A qualified name such as `Model.save` answers with the definitions of `save` that belong to `Model`, and reads as a phrase only when none does.
 * A multi-word phrase is searched as identifier forms of its terms and keeps only definitions that look callable; candidates are over-fetched so that filter runs before `limit`.
 */
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
  const qualified = qualifiedName(searchText);
  if (qualified !== null) {
    const members = memberDefinitions(root, qualified, { includeTests });
    if (members.length > 0) {
      return rankSourceMatches(members, searchText).slice(0, limit);
    }
  }
  const symbols = definitionSymbols(searchText);
  if (symbols.length === 0) {
    return [];
  }
  const phraseIntent = !IDENTIFIER_RE.test(searchText);
  const matches = symbolDefinitions(root, symbols, {
    paths: ["."],
    includeTests,
    callableOnly: phraseIntent,
    candidateLimit: includeTests && !phraseIntent ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT),
  });
  return rankSourceMatches(matches, searchText).slice(0, limit);
}

function symbolDefinitions(
  root: string,
  symbols: string[],
  {
    paths,
    includeTests,
    callableOnly,
    candidateLimit,
  }: { paths: string[]; includeTests: boolean; callableOnly: boolean; candidateLimit: number },
): SourceMatch[] {
  const matches: SourceMatch[] = [];
  const seen = new Set<string>();
  const symbolGroups = astGrepSymbolMatches(root, symbols, { limit: candidateLimit, paths });
  for (const [index, symbol] of symbols.entries()) {
    const syntaxMatches = symbolGroups[index] ?? [];
    const syntaxLines = new Set(
      syntaxMatches.map((match) => JSON.stringify([match.filePath, match.line])),
    );
    const candidates = [
      ...syntaxMatches,
      ...ripgrepDefinitionMatches(root, symbol, { limit: candidateLimit, paths }).filter(
        (match) => !syntaxLines.has(JSON.stringify([match.filePath, match.line])),
      ),
    ];
    for (const match of candidates) {
      if (matches.length >= candidateLimit) {
        break;
      }
      const location = JSON.stringify([match.filePath, match.line, match.column]);
      if (
        (!includeTests && isTestPath(match.filePath)) ||
        (callableOnly && !isCallableDefinition(match, symbol)) ||
        seen.has(location)
      ) {
        continue;
      }
      seen.add(location);
      matches.push(match);
    }
  }
  return matches;
}

/**
 * Looks only inside the files that declare a class named `owner` or are named for it, at most 1,000 of them, so a common member name costs no whole-tree scan and cannot exhaust the candidate bound elsewhere.
 * Both names match case-sensitively, unlike a bare symbol, because `transaction.atomic` and `transaction.Atomic` are different definitions.
 */
function memberDefinitions(
  root: string,
  { owner, member }: QualifiedName,
  { includeTests }: { includeTests: boolean },
): SourceMatch[] {
  const ownerFiles = ripgrepOwnerFiles(root, owner)
    .filter((filePath) => includeTests || !isTestPath(filePath))
    .sort(compareText)
    .slice(0, SOURCE_CANDIDATE_LIMIT);
  if (ownerFiles.length === 0) {
    return [];
  }
  const metricsByPath = new Map<string, FileMetrics>();
  // The member as a whole identifier: for `save`, `def save(` matches while `def save_base(` and `def Save(` do not.
  const exactMember = new RegExp(`(?<![\\w$])${escapeRegExp(member)}(?![\\w$])`);
  return symbolDefinitions(root, [member], {
    paths: ownerFiles,
    includeTests,
    callableOnly: false,
    candidateLimit: SOURCE_CANDIDATE_LIMIT,
  }).filter((match) => {
    if (!exactMember.test(match.text)) {
      return false;
    }
    let metrics = metricsByPath.get(match.filePath);
    if (metrics === undefined) {
      metrics = scanFile(path.join(root, match.filePath), { displayRoot: root });
      metricsByPath.set(match.filePath, metrics);
    }
    return isMemberOf(metrics, owner, match.line);
  });
}

// A declaration counts as callable when it is a function, class, or method, or a `const`, `let`, or `var` initialized with a function: `const run = async (` and `const run = (a) => a` pass, `const run = 1` and `const run = (a + b) * 2` do not.
function isCallableDefinition(match: SourceMatch, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  const modifiers = String.raw`(?:(?:export|default|abstract|async|declare|public|protected|private|static|override|readonly)\s+)*`;
  const declaration = String.raw`(?:(?:function|class|def)\s+)?${escaped}(?:\b|\s*\()`;
  const functionValue = String.raw`(?:async\s+)?(?:function\b|[A-Za-z_$][\w$]*\s*=>|(?:<[^=]*>\s*)?\((?:.*=>|[^)]*$))`;
  const binding = String.raw`(?:const|let|var)\s+${escaped}\s*(?::[^=]+)?=\s*${functionValue}`;
  return new RegExp(`^${modifiers}(?:${declaration}|${binding})`).test(match.text);
}

/**
 * Literal, case-insensitive text search ranked by path affinity.
 *
 * Symbol definitions are not repeated here: every caller runs `definitionMatches` first and reaches text search only after it found no definition.
 */
export function textMatches(
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
  return rankSourceMatches(
    ripgrepMatches(root, searchText, {
      includeTests,
      limit: includeTests ? limit : Math.max(limit, SOURCE_CANDIDATE_LIMIT),
    }),
    searchText,
  ).slice(0, Math.max(0, limit));
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
  const lower = filePath.toLowerCase();
  let rank = 0;
  if (!lower.startsWith("src/")) {
    rank += 4;
  }
  if (isTestPath(filePath)) {
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
  if (isGeneratedPath(filePath)) {
    rank += 8;
  }
  const pathTermMatches = searchTerms(searchText).filter((term) => lower.includes(term)).length;
  rank -= Math.min(pathTermMatches, 3) * 2;
  return rank;
}

/** Lowercase terms of at least three characters minus stop words: `how the CLI parses args` → `cli`, `parses`, `args`. */
export function searchTerms(searchText: string): string[] {
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
  { limit, paths }: { limit: number; paths: string[] },
): SourceMatch[][] {
  const groups: SourceMatch[][] = symbols.map(() => []);
  const search = new SyntaxSearch(root, paths);
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
      any: kinds.map((kind) => ({
        kind,
        has: {
          kind: PROPERTY_NAMED_KINDS.has(kind) ? "property_identifier" : "identifier",
          regex: `^${escaped}$`,
        },
      })),
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
