/**
 * Runs ast-grep through its CLI package, which carries every grammar, so Codemap needs no in-process parser.
 * Callers pass an explicit file list, keeping discovery and ignore rules Codemap's own, and receive each file's matches in source preorder, nested by byte range.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { arrayValue, recordValue } from "./json-utils.js";

const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: "javascript",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  python: "python",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
};

// One CLI run's output is held in memory while it is decoded, so chunks keep it far below V8's string limit.
const CHUNK_SOURCE_BYTES = 8 * 1024 * 1024;
const CHUNK_FILES = 500;
const OUTPUT_BUFFER_BYTES = 1024 * 1024 * 1024;

/** One ast-grep rule document; `rule`, `utils`, `constraints`, and `transform` follow ast-grep's rule-config schema, and a rule names the text it reports by capturing it as `$NAME`. */
export type AstGrepRule = {
  id: string;
  language: string;
  rule: Record<string, unknown>;
  utils?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  transform?: Record<string, unknown>;
};

/**
 * Offsets are UTF-8 byte offsets into the file; lines are zero-based and columns are zero-based characters.
 * `rule` is the producing rule's id, or the pattern for `findPattern`; `name` is the text the rule captured as `$NAME`, empty when it captured none.
 * `children` are the matches nested directly inside this one, whichever rule produced them; `parent` is the nearest enclosing match.
 */
export type AstGrepMatch = {
  rule: string;
  name: string;
  text: string;
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  parent: AstGrepMatch | null;
  children: AstGrepMatch[];
};

export function normalizeLanguage(lang: string): string {
  return LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang;
}

/** The CLI refused a rule or pattern, such as one naming a language it lacks or a node kind that language's grammar does not have; the message is the CLI's own. */
export class AstGrepRuleError extends Error {}

/** The `@ast-grep/cli` dependency's executable: the native binary once that package's install script has run, otherwise its slower Node shim, which warns on stderr. */
function astGrepCliPath(): string {
  const manifest = createRequire(import.meta.url).resolve("@ast-grep/cli/package.json");
  return path.join(path.dirname(manifest), "ast-grep");
}

/**
 * Maps each given file to its matches sorted by start, longer first on ties, then by rule order; a file with no matches is absent.
 * The CLI picks each file's grammar from its suffix and applies only the rules of that language. Throws `AstGrepRuleError` when it rejects a rule, and the spawn error when it cannot run.
 */
export function scanSyntax(files: string[], rules: AstGrepRule[]): Map<string, AstGrepMatch[]> {
  const results = new Map<string, AstGrepMatch[]>();
  if (files.length === 0 || rules.length === 0) {
    return results;
  }
  const inlineRules = rules
    .map((rule) => JSON.stringify({ ...rule, message: "$NAME" }))
    .join("\n---\n");
  const ruleOrder = new Map(rules.map((rule, index) => [rule.id, index]));
  for (const chunk of fileChunks(files)) {
    for (const [file, matches] of runScan(chunk, inlineRules)) {
      results.set(file, matches);
    }
  }
  arrange(results, (match) => ruleOrder.get(match.rule) ?? 0);
  return results;
}

/**
 * Maps each file of `language` among `files` to the matches of one pattern, ordered and nested as in `scanSyntax`.
 * Runs as `ast-grep run` does, so a pattern that parses only through error recovery, such as Python's `def save($$$)`, still matches where a rule would be refused for naming no node kinds. Throws `AstGrepRuleError` when the CLI rejects the pattern or language.
 */
export function findPattern(
  files: string[],
  language: string,
  pattern: string,
): Map<string, AstGrepMatch[]> {
  const results = new Map<string, AstGrepMatch[]>();
  for (const chunk of fileChunks(files)) {
    // Exit 1 means no matches, or an unreadable file, which then matches nothing.
    const output = cliOutput(
      ["run", "--pattern", pattern, "--lang", language, "--json=stream", "--", ...chunk],
      [0, 1],
    );
    for (const line of output.split("\n")) {
      if (line === "") {
        continue;
      }
      const row = recordValue(JSON.parse(line));
      const range = recordValue(row.range);
      const bytes = recordValue(range.byteOffset);
      const start = recordValue(range.start);
      const end = recordValue(range.end);
      const file = String(row.file ?? "");
      const fileMatches = results.get(file) ?? [];
      fileMatches.push({
        rule: pattern,
        name: "",
        text: String(row.text ?? ""),
        start: Number(bytes.start ?? 0),
        end: Number(bytes.end ?? 0),
        startLine: Number(start.line ?? 0),
        startColumn: Number(start.column ?? 0),
        endLine: Number(end.line ?? 0),
        endColumn: Number(end.column ?? 0),
        parent: null,
        children: [],
      });
      results.set(file, fileMatches);
    }
  }
  arrange(results, () => 0);
  return results;
}

/** Descendant matches in source preorder, optionally limited to some rules. */
export function descendants(match: AstGrepMatch, ...rules: string[]): AstGrepMatch[] {
  const found: AstGrepMatch[] = [];
  const visit = (node: AstGrepMatch): void => {
    for (const child of node.children) {
      if (rules.length === 0 || rules.includes(child.rule)) {
        found.push(child);
      }
      visit(child);
    }
  };
  visit(match);
  return found;
}

/** The nearest enclosing match produced by one of `rules`. */
export function ancestor(match: AstGrepMatch, ...rules: string[]): AstGrepMatch | null {
  let current = match.parent;
  while (current !== null && !rules.includes(current.rule)) {
    current = current.parent;
  }
  return current;
}

function* fileChunks(files: string[]): Generator<string[]> {
  let chunk: string[] = [];
  let bytes = 0;
  for (const file of files) {
    const size = fileSize(file);
    if (chunk.length > 0 && (chunk.length >= CHUNK_FILES || bytes + size > CHUNK_SOURCE_BYTES)) {
      yield chunk;
      chunk = [];
      bytes = 0;
    }
    chunk.push(file);
    bytes += size;
  }
  if (chunk.length > 0) {
    yield chunk;
  }
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * Keys results by the path exactly as passed, decoding the URI the CLI reports for it.
 * SARIF carries each match's text once, where the JSON stream repeats the text of every node a relational condition touched; its only per-match field for a capture is the message, which `scanSyntax` sets to `$NAME` for every rule.
 */
function runScan(files: string[], inlineRules: string): Map<string, AstGrepMatch[]> {
  const output = cliOutput(
    ["scan", "--inline-rules", inlineRules, "--format", "sarif", "--", ...files],
    [0],
  );
  const matches = new Map<string, AstGrepMatch[]>();
  const runs = arrayValue(recordValue(JSON.parse(output)).runs);
  for (const row of arrayValue(recordValue(runs[0]).results)) {
    const entry = recordValue(row);
    const location = recordValue(recordValue(arrayValue(entry.locations)[0]).physicalLocation);
    const region = recordValue(location.region);
    const file = decodeURIComponent(String(recordValue(location.artifactLocation).uri ?? ""));
    const start = Number(region.byteOffset ?? 0);
    const fileMatches = matches.get(file) ?? [];
    fileMatches.push({
      rule: String(entry.ruleId ?? ""),
      name: String(recordValue(entry.message).text ?? ""),
      text: String(recordValue(region.snippet).text ?? ""),
      start,
      end: start + Number(region.byteLength ?? 0),
      startLine: Number(region.startLine ?? 1) - 1,
      startColumn: Number(region.startColumn ?? 1) - 1,
      endLine: Number(region.endLine ?? 1) - 1,
      endColumn: Number(region.endColumn ?? 1) - 1,
      parent: null,
      children: [],
    });
    matches.set(file, fileMatches);
  }
  return matches;
}

/** Throws the spawn error when the CLI cannot run, and `AstGrepRuleError` with its stderr for an exit status outside `statuses`. */
function cliOutput(args: string[], statuses: number[]): string {
  const result = spawnSync(astGrepCliPath(), args, { maxBuffer: OUTPUT_BUFFER_BYTES });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === null || !statuses.includes(result.status)) {
    throw new AstGrepRuleError(result.stderr.toString("utf8").trim());
  }
  return result.stdout.toString("utf8");
}

/** Sorts each file's matches by start, longer first on ties, then by `rank`, and nests them. */
function arrange(
  results: Map<string, AstGrepMatch[]>,
  rank: (match: AstGrepMatch) => number,
): void {
  for (const matches of results.values()) {
    matches.sort(
      (left, right) => left.start - right.start || right.end - left.end || rank(left) - rank(right),
    );
    nest(matches);
  }
}

/** Links sorted matches by byte-range containment with an open-range stack, so no tree walk is needed. */
function nest(matches: AstGrepMatch[]): void {
  const open: AstGrepMatch[] = [];
  for (const match of matches) {
    while (open.length > 0 && !contains(open.at(-1)!, match)) {
      open.pop();
    }
    const parent = open.at(-1) ?? null;
    match.parent = parent;
    parent?.children.push(match);
    open.push(match);
  }
}

function contains(outer: AstGrepMatch, inner: AstGrepMatch): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}
