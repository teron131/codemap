/** Owns current-tree candidate composition, coverage ranking, cohesion, anchors, and selection. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { compareText } from "../text-utils.js";
import {
  compactSourceMatchText,
  type RipgrepFileCollection,
  ripgrepFilesWithMatches,
  type RipgrepScanStatus,
} from "./ripgrep.js";
import {
  isImplementationSourcePath,
  SEARCH_STOP_WORDS,
  type SourceMatch,
  sourcePathRank,
} from "./source.js";

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

export type SourceFallbackSearch = {
  candidates: SourceFallbackCandidate[];
  fullCoverage: boolean;
  hasPathSupplementedCoverage: boolean;
  queryTerms: string[];
  scanStatus: RipgrepScanStatus;
  totalCandidates: number;
};

type FallbackQueryTerm = {
  label: string;
  variants: string[];
};

type FallbackTermCollection = RipgrepFileCollection & {
  term: FallbackQueryTerm;
};

const FALLBACK_TERM_LIMIT = 8;
const FALLBACK_ANCHORS_PER_CANDIDATE = 2;
const FALLBACK_COHESION_LINE_LIMIT = 50;
const FAST_PATH_CANDIDATE_LIMIT = 3;
const MULTI_TERM_CANDIDATE_LIMIT = 8;
const SINGLE_TERM_CANDIDATE_LIMIT = 2;

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
  return terms.map((term) => {
    const collection = ripgrepFilesWithMatches(root, term.variants, {
      includeTests,
      sourceOnly,
    });
    return {
      term,
      ...collection,
      filePaths: collection.filePaths.filter(
        (filePath) => !sourceOnly || isImplementationSourcePath(filePath),
      ),
    };
  });
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
