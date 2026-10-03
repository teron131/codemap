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
  pathRank: number;
};

type FallbackAnchor = Pick<SourceMatch, "column" | "line" | "text">;

/** Read evidence for one candidate; `span` counts lines in its narrowest cohesive window and is infinite without one. */
type InspectedFallbackCandidate = {
  candidate: FallbackCandidate;
  anchors: FallbackAnchor[];
  span: number;
};

type PartialCandidateRanking = {
  candidates: InspectedFallbackCandidate[];
  bounded: boolean;
};

type FallbackLineWindow = {
  endIndex: number;
  startIndex: number;
};

type SourceFallbackCandidate = Pick<FallbackCandidate, "filePath" | "matchedTerms"> & {
  anchors: FallbackAnchor[];
};

/** One current-tree fallback answer; a `truncated` scan status covers both a cut ripgrep collection and a partial ranking cut by its file bound. */
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
const FALLBACK_RANKED_FILE_LIMIT = 1_000;
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
  const cohesiveCandidates = inspectFallbackCandidates(root, fastPathCandidates, scannedTerms)
    .filter((inspected) => inspected.span <= FALLBACK_COHESION_LINE_LIMIT)
    .sort(compareInspectedCandidates);
  const fullCoverage = cohesiveCandidates.length > 0;
  const selection = fullCoverage
    ? {
        candidates: cohesiveCandidates.slice(0, Math.min(limit, FAST_PATH_CANDIDATE_LIMIT)),
        bounded: false,
      }
    : rankPartialCandidates(root, strongestCandidates, scannedTerms, candidateLimit);
  return {
    candidates: selection.candidates.map(({ anchors, candidate }) => ({
      anchors,
      filePath: candidate.filePath,
      matchedTerms: candidate.matchedTerms,
    })),
    fullCoverage,
    hasPathSupplementedCoverage,
    queryTerms: queryTerms.map((term) => term.label),
    scanStatus: selection.bounded && scanStatus === "complete" ? "truncated" : scanStatus,
    totalCandidates: fullCoverage ? completeSourceCandidates.length : strongestCandidates.length,
  };
}

/**
 * Orders the strongest partial tier by local term co-occurrence without reading the whole tier.
 *
 * Coverage, path rank, and source-term count still lead, so only the leading candidate groups that can reach the display need their files read; within a group, a narrower cohesive window replaces alphabetical order. Groups whose content holds fewer than two query terms have no window and are read only for display anchors. A group cut by the file bound marks the ranking as a prefix.
 */
function rankPartialCandidates(
  root: string,
  candidates: FallbackCandidate[],
  terms: FallbackQueryTerm[],
  limit: number,
): PartialCandidateRanking {
  const inspected: InspectedFallbackCandidate[] = [];
  let bounded = false;
  let groupStart = 0;
  while (groupStart < candidates.length && inspected.length < limit && !bounded) {
    const first = candidates[groupStart]!;
    let groupEnd = groupStart + 1;
    while (
      groupEnd < candidates.length &&
      compareFallbackEvidence(first, candidates[groupEnd]!) === 0
    ) {
      groupEnd += 1;
    }
    const group = candidates.slice(groupStart, groupEnd);
    const rankable = first.sourceMatchedTerms.length >= 2;
    const readLimit = (rankable ? FALLBACK_RANKED_FILE_LIMIT : limit) - inspected.length;
    bounded = rankable && group.length > readLimit;
    inspected.push(...inspectFallbackCandidates(root, group.slice(0, readLimit), terms));
    groupStart = groupEnd;
  }
  return { candidates: inspected.sort(compareInspectedCandidates).slice(0, limit), bounded };
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

/** Composes and ranks file candidates from per-term path collections without reading their content. */
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
      return {
        filePath,
        matchedTerms,
        sourceMatchedTerms,
        pathRank: sourcePathRank(filePath, searchText),
      };
    })
    .sort(
      (left, right) =>
        compareFallbackEvidence(left, right) || compareText(left.filePath, right.filePath),
    );
}

/** Reads each candidate once for its narrowest cohesive window and the display anchors inside it. */
function inspectFallbackCandidates(
  root: string,
  candidates: FallbackCandidate[],
  terms: FallbackQueryTerm[],
): InspectedFallbackCandidate[] {
  return candidates.map((candidate) => {
    let source: string;
    try {
      source = readFileSync(path.resolve(root, candidate.filePath), "utf8");
    } catch {
      return { candidate, anchors: [], span: Number.POSITIVE_INFINITY };
    }
    const lines = source.split(/\r?\n/);
    const matchedLabels = new Set(candidate.sourceMatchedTerms);
    const window = fallbackCohesionWindow(lines, terms, matchedLabels);
    return {
      candidate,
      anchors: fallbackAnchors(lines, terms, matchedLabels, window ?? undefined),
      span: window === null ? Number.POSITIVE_INFINITY : window.endIndex - window.startIndex + 1,
    };
  });
}

/** Finds the narrowest source window holding every matched term where at least two terms share a line. */
function fallbackCohesionWindow(
  lines: string[],
  terms: FallbackQueryTerm[],
  matchedLabels: Set<string>,
): FallbackLineWindow | null {
  const matchedTerms = terms.filter((term) => matchedLabels.has(term.label));
  if (matchedTerms.length < 2) {
    return null;
  }
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
    // Repeated singleton mentions must not discard the dense line that makes this window cohesive.
    const startIndex = Math.min(...lastSeenLines, latestDenseLine);
    if (startIndex < 0) {
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

/** Ranks broader term coverage before ordinary source usefulness and content-backed coverage. */
function compareFallbackEvidence(left: FallbackCandidate, right: FallbackCandidate): number {
  return (
    right.matchedTerms.length - left.matchedTerms.length ||
    left.pathRank - right.pathRank ||
    right.sourceMatchedTerms.length - left.sourceMatchedTerms.length
  );
}

/** Breaks evidence ties by the narrower cohesive window, then by path. */
function compareInspectedCandidates(
  left: InspectedFallbackCandidate,
  right: InspectedFallbackCandidate,
): number {
  return (
    compareFallbackEvidence(left.candidate, right.candidate) ||
    (left.span === right.span ? 0 : left.span < right.span ? -1 : 1) ||
    compareText(left.candidate.filePath, right.candidate.filePath)
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
