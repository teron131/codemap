/** Combines ast-grep symbol hits and ripgrep text hits into source matches. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import { contextLines, ruleMatches, type SyntaxMatch, targetFiles } from "../ast-grep/index.js";
import {
  categoryForPath,
  CONFIG_BASENAMES,
  LANGUAGE_BY_SUFFIX,
} from "../source/extraction/index.js";
import {
  discoverFiles,
  IGNORED_DIR_NAMES,
  PY_SUFFIXES,
  relativePath,
  TYPESCRIPT_SUFFIXES,
} from "../source/scanner/index.js";
import { isGeneratedSignalPath, isTestPath } from "../source/signals/policy.js";

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SOURCE_MATCH_TEXT_LIMIT = 240;
const SOURCE_CANDIDATE_LIMIT = 1_000;
const SOURCE_SEARCH_BUFFER_LIMIT = 16 * 1024 * 1024;
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

/** Checks whether a match points to supported, non-generated implementation source. */
export function isImplementationSourceMatch(match: SourceMatch): boolean {
  return isImplementationSourcePath(match.filePath);
}

/** Checks whether a path belongs to supported, non-generated implementation source. */
export function isImplementationSourcePath(filePath: string): boolean {
  const suffix = path.extname(filePath).toLowerCase();
  return (
    (PY_SUFFIXES.has(suffix) || TYPESCRIPT_SUFFIXES.has(suffix)) && !isGeneratedSignalPath(filePath)
  );
}

type FallbackCandidate = {
  filePath: string;
  matchedTerms: string[];
  sourceMatchedTerms: string[];
};

type FallbackAnchor = Pick<SourceMatch, "column" | "line" | "text">;

type FallbackCandidateInspection = {
  anchors: FallbackAnchor[];
  cohesive: boolean;
};

type FallbackLineWindow = {
  endIndex: number;
  startIndex: number;
};

type SourceFallbackCandidate = Omit<FallbackCandidate, "sourceMatchedTerms"> & {
  anchors: FallbackAnchor[];
};

type ScanStatus = "complete" | "failed" | "truncated";

export type SourceFallbackSearch = {
  candidates: SourceFallbackCandidate[];
  fullCoverage: boolean;
  hasPathSupplementedCoverage: boolean;
  queryTerms: string[];
  scanStatus: ScanStatus;
  totalCandidates: number;
};

type JsonMatchParser = (payload: Record<string, unknown>) => SourceMatch | null;

type FallbackQueryTerm = {
  label: string;
  variants: string[];
};

type RipgrepMatchOptions = {
  includeTests?: boolean;
  limit: number;
};

type SourceMatchCollection = {
  matches: SourceMatch[];
  scanTruncated: boolean;
};

type FallbackFileCollection = {
  filePaths: string[];
  scanStatus: ScanStatus;
};

type FallbackTermCollection = FallbackFileCollection & {
  term: FallbackQueryTerm;
};

const FALLBACK_TERM_LIMIT = 8;
const FALLBACK_ANCHORS_PER_CANDIDATE = 2;
const FALLBACK_COHESION_LINE_LIMIT = 50;
const FAST_PATH_CANDIDATE_LIMIT = 3;
const MULTI_TERM_CANDIDATE_LIMIT = 8;
const SINGLE_TERM_CANDIDATE_LIMIT = 2;
const SOURCE_CODE_GLOBS = [...PY_SUFFIXES, ...TYPESCRIPT_SUFFIXES].map((suffix) => `*${suffix}`);

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
        !isGeneratedSignalPath(filePath) &&
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

/** Finds file-oriented partial candidates and detects complete multi-term source evidence. */
export function sourceFallbackMatches(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
  }: {
    includeTests?: boolean;
    limit: number;
  },
): SourceFallbackSearch {
  const queryTerms = fallbackQueryTerms(searchText);
  const scannedTerms = queryTerms.slice(0, FALLBACK_TERM_LIMIT);
  if (scannedTerms.length === 0 || limit <= 0) {
    return {
      candidates: [],
      fullCoverage: false,
      hasPathSupplementedCoverage: false,
      queryTerms: queryTerms.map((term) => term.label),
      scanStatus: "complete",
      totalCandidates: 0,
    };
  }
  const implementationCollections = collectFallbackFiles(root, scannedTerms, {
    includeTests,
    sourceOnly: true,
  });
  const hasImplementationCandidate = implementationCollections.some(
    (collection) => collection.filePaths.length > 0,
  );
  const collections = hasImplementationCandidate
    ? implementationCollections
    : collectFallbackFiles(root, scannedTerms, {
        includeTests,
        sourceOnly: false,
      });
  const scanStatus = collections.some((collection) => collection.scanStatus === "failed")
    ? "failed"
    : collections.some((collection) => collection.scanStatus === "truncated")
      ? "truncated"
      : "complete";
  const allCandidates = fallbackCandidates(scannedTerms, collections, searchText);
  const strongestCoverage = allCandidates[0]?.matchedTerms.length ?? 0;
  const strongestCandidates = allCandidates.filter(
    (candidate) => candidate.matchedTerms.length === strongestCoverage,
  );
  const completeSourceCandidates = allCandidates.filter(
    (candidate) => candidate.sourceMatchedTerms.length === scannedTerms.length,
  );
  const hasPathSupplementedCoverage = allCandidates.some(
    (candidate) =>
      candidate.matchedTerms.length === scannedTerms.length &&
      candidate.sourceMatchedTerms.length < scannedTerms.length,
  );
  const hasCompleteSourceCoverage =
    queryTerms.length >= 2 &&
    queryTerms.length === scannedTerms.length &&
    scanStatus === "complete" &&
    completeSourceCandidates.length > 0;
  const pathAlignedSourceCandidates = hasCompleteSourceCoverage
    ? completeSourceCandidates.filter((candidate) =>
        scannedTerms.every((term) => fallbackTermMatchesPath(candidate.filePath, term)),
      )
    : [];
  let fastPathCandidates: FallbackCandidate[] = [];
  if (pathAlignedSourceCandidates.length === 1) {
    fastPathCandidates = pathAlignedSourceCandidates;
  } else if (
    hasCompleteSourceCoverage &&
    !hasPathSupplementedCoverage &&
    completeSourceCandidates.length <= FAST_PATH_CANDIDATE_LIMIT
  ) {
    fastPathCandidates = completeSourceCandidates;
  }
  const candidateLimit =
    scannedTerms.length === 1
      ? Math.min(limit, SINGLE_TERM_CANDIDATE_LIMIT)
      : Math.min(limit, MULTI_TERM_CANDIDATE_LIMIT);
  const inspectedFastPathCandidates = inspectFallbackCandidates(
    root,
    fastPathCandidates,
    scannedTerms,
    true,
  );
  const cohesiveCandidates = inspectedFastPathCandidates.filter((candidate) => candidate.cohesive);
  const fullCoverage = cohesiveCandidates.length > 0;
  const selectedCandidates = fullCoverage
    ? cohesiveCandidates.slice(0, Math.min(limit, FAST_PATH_CANDIDATE_LIMIT))
    : inspectFallbackCandidates(
        root,
        strongestCandidates.slice(0, candidateLimit),
        scannedTerms,
        false,
      );
  return {
    candidates: selectedCandidates.map(({ candidate }) => candidate),
    fullCoverage,
    hasPathSupplementedCoverage,
    queryTerms: queryTerms.map((term) => term.label),
    scanStatus,
    totalCandidates: fullCoverage ? completeSourceCandidates.length : strongestCandidates.length,
  };
}

/** Collects the files containing each query term from one bounded ripgrep lane. */
function collectFallbackFiles(
  root: string,
  terms: FallbackQueryTerm[],
  {
    includeTests,
    sourceOnly,
  }: {
    includeTests: boolean;
    sourceOnly: boolean;
  },
): FallbackTermCollection[] {
  return terms.map((term) => ({
    term,
    ...ripgrepFilesWithMatches(root, term.variants, {
      includeTests,
      sourceOnly,
    }),
  }));
}

/** Composes and ranks file candidates from per-term path collections. */
function fallbackCandidates(
  terms: FallbackQueryTerm[],
  collections: FallbackTermCollection[],
  searchText: string,
): FallbackCandidate[] {
  const termLabelsByFile = new Map<string, Set<string>>();
  for (const { filePaths, term } of collections) {
    for (const filePath of filePaths) {
      const labels = termLabelsByFile.get(filePath) ?? new Set<string>();
      labels.add(term.label);
      termLabelsByFile.set(filePath, labels);
    }
  }
  return [...termLabelsByFile]
    .map(([filePath, matchedLabels]) => {
      const sourceMatchedTerms = terms
        .filter((term) => matchedLabels.has(term.label))
        .map((term) => term.label);
      const matchedTerms = terms
        .filter((term) => matchedLabels.has(term.label) || fallbackTermMatchesPath(filePath, term))
        .map((term) => term.label);
      return { filePath, matchedTerms, sourceMatchedTerms };
    })
    .sort((left, right) => compareFallbackCandidates(left, right, searchText));
}

/** Adds concrete anchors and optional cohesion evidence to ranked fallback candidates. */
function inspectFallbackCandidates(
  root: string,
  candidates: FallbackCandidate[],
  terms: FallbackQueryTerm[],
  requireCohesion: boolean,
): Array<{ candidate: SourceFallbackCandidate; cohesive: boolean }> {
  return candidates.map((candidate) => {
    const inspection = inspectFallbackCandidate(
      root,
      candidate.filePath,
      terms,
      new Set(candidate.sourceMatchedTerms),
      requireCohesion,
    );
    return {
      candidate: {
        anchors: inspection.anchors,
        filePath: candidate.filePath,
        matchedTerms: candidate.matchedTerms,
      },
      cohesive: inspection.cohesive,
    };
  });
}

/** Reads one candidate once to find display anchors and bounded term cohesion. */
function inspectFallbackCandidate(
  root: string,
  filePath: string,
  terms: FallbackQueryTerm[],
  matchedLabels: Set<string>,
  requireCohesion: boolean,
): FallbackCandidateInspection {
  let source: string;
  try {
    source = readFileSync(path.resolve(root, filePath), "utf8");
  } catch {
    return { anchors: [], cohesive: false };
  }
  const lines = source.split(/\r?\n/);
  const cohesionWindow = requireCohesion
    ? fallbackCohesionWindow(lines, terms, matchedLabels)
    : null;
  return {
    anchors: fallbackAnchors(lines, terms, matchedLabels, cohesionWindow ?? undefined),
    cohesive: cohesionWindow !== null,
  };
}

/** Finds the narrowest bounded source window with complete and locally dense term evidence. */
function fallbackCohesionWindow(
  lines: string[],
  terms: FallbackQueryTerm[],
  matchedLabels: Set<string>,
): FallbackLineWindow | null {
  const matchedTerms = terms.filter((term) => matchedLabels.has(term.label));
  const lastSeenLines = new Array<number>(matchedTerms.length).fill(-1);
  let latestDenseLine = -1;
  let narrowestWindow: FallbackLineWindow | null = null;
  for (const [lineIndex, line] of lines.entries()) {
    const lowerLine = line.toLowerCase();
    let lineTermCount = 0;
    for (const [termIndex, term] of matchedTerms.entries()) {
      if (term.variants.some((variant) => lowerLine.includes(variant))) {
        lastSeenLines[termIndex] = lineIndex;
        lineTermCount += 1;
      }
    }
    if (lineTermCount >= 2) {
      latestDenseLine = lineIndex;
    }
    const startIndex = Math.min(...lastSeenLines);
    if (
      startIndex < 0 ||
      lineIndex - startIndex + 1 > FALLBACK_COHESION_LINE_LIMIT ||
      latestDenseLine < startIndex
    ) {
      continue;
    }
    const window = { endIndex: lineIndex, startIndex };
    if (
      narrowestWindow === null ||
      window.endIndex - window.startIndex < narrowestWindow.endIndex - narrowestWindow.startIndex
    ) {
      narrowestWindow = window;
    }
  }
  return narrowestWindow;
}

/** Finds at most two concrete source anchors for one file-oriented candidate. */
function fallbackAnchors(
  lines: string[],
  terms: FallbackQueryTerm[],
  matchedLabels: Set<string>,
  window?: FallbackLineWindow,
): FallbackAnchor[] {
  const anchors: FallbackAnchor[] = [];
  const seenLines = new Set<number>();
  for (const term of terms) {
    if (!matchedLabels.has(term.label)) {
      continue;
    }
    const anchor = firstFallbackAnchor(lines, term, window);
    if (anchor === null || seenLines.has(anchor.line)) {
      continue;
    }
    anchors.push(anchor);
    seenLines.add(anchor.line);
    if (anchors.length >= FALLBACK_ANCHORS_PER_CANDIDATE) {
      break;
    }
  }
  return anchors.sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || compareText(left.text, right.text),
  );
}

/** Finds the first case-insensitive literal occurrence for one query term. */
function firstFallbackAnchor(
  lines: string[],
  term: FallbackQueryTerm,
  window?: FallbackLineWindow,
): FallbackAnchor | null {
  const startIndex = window?.startIndex ?? 0;
  const endIndex = Math.min(window?.endIndex ?? lines.length - 1, lines.length - 1);
  for (let index = startIndex; index <= endIndex; index += 1) {
    const line = lines[index] ?? "";
    const lowerLine = line.toLowerCase();
    const columns = term.variants
      .map((variant) => lowerLine.indexOf(variant))
      .filter((column) => column >= 0);
    if (columns.length === 0) {
      continue;
    }
    return {
      line: index + 1,
      column: Math.min(...columns) + 1,
      text: compactSourceMatchText(line),
    };
  }
  return null;
}

/** Checks whether one normalized term is represented by a candidate path. */
function fallbackTermMatchesPath(filePath: string, term: FallbackQueryTerm): boolean {
  const lowerPath = filePath.toLowerCase();
  return term.variants.some((variant) => lowerPath.includes(variant));
}

/** Ranks broader term coverage before ordinary source usefulness. */
function compareFallbackCandidates(
  left: FallbackCandidate,
  right: FallbackCandidate,
  searchText: string,
): number {
  const coverageDifference = right.matchedTerms.length - left.matchedTerms.length;
  if (coverageDifference !== 0) {
    return coverageDifference;
  }
  return (
    sourcePathRank(left.filePath, searchText) - sourcePathRank(right.filePath, searchText) ||
    right.sourceMatchedTerms.length - left.sourceMatchedTerms.length ||
    compareText(left.filePath, right.filePath)
  );
}

/** Builds unique meaningful query terms while retaining simple inflection variants. */
function fallbackQueryTerms(searchText: string): FallbackQueryTerm[] {
  const terms: FallbackQueryTerm[] = [];
  const seen = new Set<string>();
  for (const token of searchText.match(/[A-Za-z0-9_$]+/g) ?? []) {
    const variants = fallbackTermVariants(token);
    const label = variants[0];
    if (label === undefined || seen.has(label)) {
      continue;
    }
    seen.add(label);
    terms.push({ label, variants });
  }
  return terms;
}

/** Expands one fallback term into simple source-search variants. */
function fallbackTermVariants(token: string): string[] {
  const normalized = token.trim().toLowerCase();
  if (normalized.length < 3 || SEARCH_STOP_WORDS.has(normalized)) {
    return [];
  }
  if (normalized.endsWith("ies") && normalized.length > 4) {
    return [`${normalized.slice(0, -3)}y`, normalized];
  }
  if (/[cs]hes$|xes$|zes$|ses$/.test(normalized) && normalized.length > 4) {
    return [normalized.slice(0, -2), normalized];
  }
  if (
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    !normalized.endsWith("is") &&
    !normalized.endsWith("us") &&
    normalized.length > 4
  ) {
    return [normalized.slice(0, -1), normalized];
  }
  return [normalized];
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
function sourcePathRank(filePath: string, searchText: string): number {
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
  if (isGeneratedSignalPath(normalizedPath)) {
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
  ).matches;
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

/** Finds all candidate file paths for one term without collecting repeated match rows. */
function ripgrepFilesWithMatches(
  root: string,
  variants: string[],
  {
    includeTests,
    sourceOnly,
  }: {
    includeTests: boolean;
    sourceOnly: boolean;
  },
): FallbackFileCollection {
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
    (filePath) =>
      (!sourceOnly || isImplementationSourcePath(filePath)) &&
      (includeTests || !isTestPath(filePath)),
  );
  return { filePaths, scanStatus };
}

/** Runs ripgrep and converts output to source match rows. */
function ripgrepMatches(
  root: string,
  searchText: string,
  options: RipgrepMatchOptions,
): SourceMatchCollection {
  const includeTests = options.includeTests ?? false;
  const limit = options.limit;
  if (limit <= 0) {
    return { matches: [], scanTruncated: false };
  }
  const collection = streamedJsonMatches(
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
  return collection;
}

/** Builds ripgrep glob exclusions from the shared source-scan ignore set. */
function ripgrepExcludeArgs(): string[] {
  return [...IGNORED_DIR_NAMES].flatMap((name) => ["--glob", `!**/${name}/**`]);
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
