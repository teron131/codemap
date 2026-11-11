/** Answers multi-term queries from the working tree, ranking files by term coverage and where the terms meet. */
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
  searchTerms,
  type SourceMatch,
  sourcePathRank,
} from "./source.js";

type Candidate = {
  filePath: string;
  matchedTerms: string[];
  sourceMatchedTerms: string[];
  pathRank: number;
};

type Anchor = Pick<SourceMatch, "column" | "line" | "text">;

/** Read evidence for one candidate; `span` counts lines in its narrowest cohesive window and is infinite without one. */
type InspectedCandidate = {
  candidate: Candidate;
  anchors: Anchor[];
  span: number;
};

type PartialCandidateRanking = {
  candidates: InspectedCandidate[];
  bounded: boolean;
};

type LineWindow = {
  endIndex: number;
  startIndex: number;
};

type ShownCandidate = Pick<Candidate, "filePath" | "matchedTerms"> & {
  anchors: Anchor[];
};

/**
 * `fullCoverage` marks the decisive answer described on `termCoverageSearch`, and `hasPathSupplementedCoverage` means some file covers every term only because its path supplies a term its content lacks.
 *
 * A `truncated` scan status covers both a cut ripgrep collection and a partial ranking cut by its file bound.
 */
export type TermCoverageSearch = {
  candidates: ShownCandidate[];
  fullCoverage: boolean;
  hasPathSupplementedCoverage: boolean;
  queryTerms: string[];
  scanStatus: RipgrepScanStatus;
  totalCandidates: number;
};

type QueryTerm = {
  label: string;
  variants: string[];
};

type TermCollection = RipgrepFileCollection & {
  term: QueryTerm;
};

const TERM_LIMIT = 8;
const ANCHORS_PER_CANDIDATE = 2;
const COHESION_LINE_LIMIT = 50;
const RANKED_FILE_LIMIT = 1_000;
const FAST_PATH_CANDIDATE_LIMIT = 3;
const MULTI_TERM_CANDIDATE_LIMIT = 8;
const SINGLE_TERM_CANDIDATE_LIMIT = 2;

/**
 * Decides between a decisive working-tree answer and ranked partial candidates.
 * 1. Collect the files containing each of the first eight terms, from implementation source unless none matches there.
 * 2. Rank files by term coverage, counting terms their path supplies, then path usefulness, then content coverage.
 * 3. Decisive answer: when a completed scan finds every term of a multi-term query of at most eight terms in some files' content, take the single file whose path also names every term, or up to three such files when no file relies on its path; each must hold its terms within a 50-line cohesive window.
 * 4. Otherwise rank the strongest coverage tier by cohesion through `rankPartialCandidates`.
 */
export function termCoverageSearch(
  root: string,
  searchText: string,
  {
    includeTests = false,
    limit,
  }: {
    includeTests?: boolean;
    limit: number;
  },
): TermCoverageSearch {
  const queryTerms = parseQueryTerms(searchText);
  const scannedTerms = queryTerms.slice(0, TERM_LIMIT);
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
  const implementationCollections = collectTermFiles(root, scannedTerms, {
    includeTests,
    sourceOnly: true,
  });
  const hasImplementationCandidate = implementationCollections.some(
    (collection) => collection.filePaths.length > 0,
  );
  const collections = hasImplementationCandidate
    ? implementationCollections
    : collectTermFiles(root, scannedTerms, {
        includeTests,
        sourceOnly: false,
      });
  const scanStatus = collections.some((collection) => collection.scanStatus === "failed")
    ? "failed"
    : collections.some((collection) => collection.scanStatus === "truncated")
      ? "truncated"
      : "complete";
  const allCandidates = coverageCandidates(scannedTerms, collections, searchText);
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
        scannedTerms.every((term) => termMatchesPath(candidate.filePath, term)),
      )
    : [];
  let fastPathCandidates: Candidate[] = [];
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
  const cohesiveCandidates = inspectCandidates(root, fastPathCandidates, scannedTerms)
    .filter((inspected) => inspected.span <= COHESION_LINE_LIMIT)
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
 * Coverage, path rank, and source-term count lead, so only the leading candidate groups that can reach the display need their files read, at most 1,000; within a group, the narrower cohesive window wins before the path tiebreak. Groups whose content holds fewer than two query terms have no window and are read only for display anchors. A group cut by the file bound marks the ranking as a prefix.
 */
function rankPartialCandidates(
  root: string,
  candidates: Candidate[],
  terms: QueryTerm[],
  limit: number,
): PartialCandidateRanking {
  const inspected: InspectedCandidate[] = [];
  let bounded = false;
  let groupStart = 0;
  while (groupStart < candidates.length && inspected.length < limit && !bounded) {
    const first = candidates[groupStart]!;
    let groupEnd = groupStart + 1;
    while (groupEnd < candidates.length && compareCoverage(first, candidates[groupEnd]!) === 0) {
      groupEnd += 1;
    }
    const group = candidates.slice(groupStart, groupEnd);
    const rankable = first.sourceMatchedTerms.length >= 2;
    const readLimit = (rankable ? RANKED_FILE_LIMIT : limit) - inspected.length;
    bounded = rankable && group.length > readLimit;
    inspected.push(...inspectCandidates(root, group.slice(0, readLimit), terms));
    groupStart = groupEnd;
  }
  return { candidates: inspected.sort(compareInspectedCandidates).slice(0, limit), bounded };
}

function collectTermFiles(
  root: string,
  terms: QueryTerm[],
  {
    includeTests,
    sourceOnly,
  }: {
    includeTests: boolean;
    sourceOnly: boolean;
  },
): TermCollection[] {
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
function coverageCandidates(
  terms: QueryTerm[],
  collections: TermCollection[],
  searchText: string,
): Candidate[] {
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
        .filter((term) => matchedLabels.has(term.label) || termMatchesPath(filePath, term))
        .map((term) => term.label);
      return {
        filePath,
        matchedTerms,
        sourceMatchedTerms,
        pathRank: sourcePathRank(filePath, searchText),
      };
    })
    .sort(
      (left, right) => compareCoverage(left, right) || compareText(left.filePath, right.filePath),
    );
}

/** Reads each candidate once for its narrowest cohesive window and the display anchors inside it. */
function inspectCandidates(
  root: string,
  candidates: Candidate[],
  terms: QueryTerm[],
): InspectedCandidate[] {
  return candidates.map((candidate) => {
    let source: string;
    try {
      source = readFileSync(path.resolve(root, candidate.filePath), "utf8");
    } catch {
      return { candidate, anchors: [], span: Number.POSITIVE_INFINITY };
    }
    const lines = source.split(/\r?\n/);
    const matchedLabels = new Set(candidate.sourceMatchedTerms);
    const window = cohesionWindow(lines, terms, matchedLabels);
    return {
      candidate,
      anchors: candidateAnchors(lines, terms, matchedLabels, window ?? undefined),
      span: window === null ? Number.POSITIVE_INFINITY : window.endIndex - window.startIndex + 1,
    };
  });
}

/** Finds the narrowest source window holding every matched term where at least two terms share a line. */
function cohesionWindow(
  lines: string[],
  terms: QueryTerm[],
  matchedLabels: Set<string>,
): LineWindow | null {
  const matchedTerms = terms.filter((term) => matchedLabels.has(term.label));
  if (matchedTerms.length < 2) {
    return null;
  }
  const lastSeenLines = new Array<number>(matchedTerms.length).fill(-1);
  let latestDenseLine = -1;
  let narrowestWindow: LineWindow | null = null;
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

function candidateAnchors(
  lines: string[],
  terms: QueryTerm[],
  matchedLabels: Set<string>,
  window?: LineWindow,
): Anchor[] {
  const anchors: Anchor[] = [];
  const seenLines = new Set<number>();
  for (const term of terms) {
    if (!matchedLabels.has(term.label)) {
      continue;
    }
    const anchor = firstAnchor(lines, term, window);
    if (anchor === null || seenLines.has(anchor.line)) {
      continue;
    }
    anchors.push(anchor);
    seenLines.add(anchor.line);
    if (anchors.length >= ANCHORS_PER_CANDIDATE) {
      break;
    }
  }
  return anchors.sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || compareText(left.text, right.text),
  );
}

function firstAnchor(lines: string[], term: QueryTerm, window?: LineWindow): Anchor | null {
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

function termMatchesPath(filePath: string, term: QueryTerm): boolean {
  const lowerPath = filePath.toLowerCase();
  return term.variants.some((variant) => lowerPath.includes(variant));
}

/** Ranks broader term coverage before ordinary source usefulness and content-backed coverage. */
function compareCoverage(left: Candidate, right: Candidate): number {
  return (
    right.matchedTerms.length - left.matchedTerms.length ||
    left.pathRank - right.pathRank ||
    right.sourceMatchedTerms.length - left.sourceMatchedTerms.length
  );
}

function compareInspectedCandidates(left: InspectedCandidate, right: InspectedCandidate): number {
  return (
    compareCoverage(left.candidate, right.candidate) ||
    (left.span === right.span ? 0 : left.span < right.span ? -1 : 1) ||
    compareText(left.candidate.filePath, right.candidate.filePath)
  );
}

function parseQueryTerms(searchText: string): QueryTerm[] {
  const terms = new Map<string, QueryTerm>();
  for (const term of searchTerms(searchText)) {
    const variants = termVariants(term);
    const label = variants[0];
    if (!terms.has(label)) {
      terms.set(label, { label, variants });
    }
  }
  return [...terms.values()];
}

/** Crude plural stripping for substring search: `entries` → `entry`, `classes` → `class`, `files` → `file`. The first variant labels the term. */
function termVariants(term: string): [string, ...string[]] {
  if (term.endsWith("ies") && term.length > 4) {
    return [`${term.slice(0, -3)}y`, term];
  }
  if (/[cs]hes$|xes$|zes$|ses$/.test(term) && term.length > 4) {
    return [term.slice(0, -2), term];
  }
  if (
    term.endsWith("s") &&
    !term.endsWith("ss") &&
    !term.endsWith("is") &&
    !term.endsWith("us") &&
    term.length > 4
  ) {
    return [term.slice(0, -1), term];
  }
  return [term];
}
