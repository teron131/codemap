/** Structural search over ast-grep parses: one target inventory and one parse per file shared by a group of rules, plus the call-site and YAML-rule searches built on it. Match positions are one-based. */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NapiConfig } from "@ast-grep/napi";

import { astGrepRoot, hasBundledParser, normalizeLanguage } from "../ast-grep.js";
import { escapeRegExp } from "../text-utils.js";
import {
  languagesForFiles,
  SYNTAX_SUFFIXES_BY_LANGUAGE,
  targetFiles,
} from "./structural-targets.js";

export type SyntaxMatch = {
  engine: "ast-grep";
  filePath: string;
  text: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  lines: string;
};

const CALL_TARGET_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** A bare `name` also matches method calls such as `x.name(...)`, while a dotted target matches only that chain; throws for names that are not identifier chains. */
export function callMatches(
  search: SyntaxSearch,
  language: string,
  name: string,
): SyntaxMatch[] | null {
  const target = callTarget(name);
  const patterns = target.includes(".")
    ? [{ pattern: `${target}($$$ARGS)` }]
    : [{ pattern: `${target}($$$ARGS)` }, { pattern: `$RECEIVER.${target}($$$ARGS)` }];
  const matches = search.matches(
    language,
    { rule: { any: patterns } },
    { prefilter: callTextPattern(target) },
  );
  return matches === null ? null : uniqueCallMatches(matches);
}

/** Expects an already resolved `rulePath`; null when the rule's language has no bundled parser. */
export async function searchRuleMatches(
  root: string,
  rulePath: string,
  paths: string[],
): Promise<SyntaxMatch[] | null> {
  const rule = await loadRule(rulePath);
  return new SyntaxSearch(root, paths).matches(
    String(rule.language ?? ""),
    matchConfigFromRule(rule),
  );
}

/** Reuses one target inventory and one parse per language/file across a group of related rules. */
export class SyntaxSearch {
  private files: string[] | undefined;

  constructor(
    private readonly root: string,
    private readonly paths: string[],
  ) {}

  languages(): string[] {
    return languagesForFiles(this.targetFiles());
  }

  /** Null when the language has no bundled parser; `prefilter` skips files whose text cannot match before parsing them. */
  matches(
    language: string,
    config: NapiConfig,
    { prefilter }: { prefilter?: RegExp } = {},
  ): SyntaxMatch[] | null {
    return this.matchRules(language, [{ config, limit: null }], prefilter)?.[0] ?? null;
  }

  /** Preserves a separate ordered limit for each rule while reading and parsing each file only once. */
  matchRules(
    lang: string,
    rules: Array<{ config: NapiConfig; limit: number | null }>,
    prefilter?: RegExp,
  ): SyntaxMatch[][] | null {
    const language = normalizeLanguage(lang);
    if (!hasBundledParser(language)) {
      return null;
    }
    const groups = rules.map((rule) => ({ ...rule, matches: [] as SyntaxMatch[] }));
    const suffixes = SYNTAX_SUFFIXES_BY_LANGUAGE[language];
    for (const filePath of this.targetFiles()) {
      if (groups.every((group) => group.limit !== null && group.matches.length >= group.limit)) {
        break;
      }
      if (suffixes !== undefined && !suffixes.has(path.extname(filePath))) {
        continue;
      }
      try {
        const text = readFileSync(filePath, "utf8");
        if (prefilter !== undefined && !prefilter.test(text)) {
          continue;
        }
        const syntaxRoot = astGrepRoot(text, language);
        if (syntaxRoot === null) {
          continue;
        }
        const relPath = path.relative(this.root, filePath).split(path.sep).join("/");
        const sourceLines = splitLines(text);
        for (const { config, limit, matches } of groups) {
          if (limit !== null && matches.length >= limit) {
            continue;
          }
          for (const node of syntaxRoot.findAll(config)) {
            if (limit !== null && matches.length >= limit) {
              break;
            }
            const range = node.range();
            matches.push({
              engine: "ast-grep",
              filePath: relPath,
              text: node.text(),
              line: range.start.line + 1,
              column: range.start.column + 1,
              endLine: range.end.line + 1,
              endColumn: range.end.column + 1,
              lines: contextLines(sourceLines, range.start.line, range.end.line),
            });
          }
        }
      } catch {}
    }
    return groups.map((group) => group.matches);
  }

  private targetFiles(): string[] {
    return (this.files ??= targetFiles(this.root, this.paths));
  }
}

/** Imports the YAML parser lazily because only rule searches need it. */
async function loadRule(rulePath: string): Promise<Record<string, unknown>> {
  const { parse: parseYaml } = await import("yaml");
  const data: unknown = parseYaml(readFileSync(rulePath, "utf8"));
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid ast-grep rule file: ${rulePath}`);
  }
  const rule = data as Record<string, unknown>;
  if (rule.rule === null || typeof rule.rule !== "object" || Array.isArray(rule.rule)) {
    throw new Error(`ast-grep rule file must contain a rule mapping: ${rulePath}`);
  }
  if (!rule.language) {
    throw new Error(`ast-grep rule file must contain language: ${rulePath}`);
  }
  return rule;
}

function matchConfigFromRule(rule: Record<string, unknown>): NapiConfig {
  const matchConfig: Record<string, unknown> = { rule: rule.rule };
  for (const key of ["constraints", "utils", "transform"]) {
    const value = rule[key];
    if (value !== undefined && value !== null) {
      matchConfig[key] = value;
    }
  }
  return matchConfig as unknown as NapiConfig;
}

function contextLines(sourceLines: string[], startLine: number, endLine: number): string {
  if (sourceLines.length === 0) {
    return "";
  }
  const start = Math.max(0, startLine);
  const end = Math.min(sourceLines.length, endLine + 1);
  return sourceLines.slice(start, end).join("\n");
}

function callTarget(name: string): string {
  if (!CALL_TARGET_RE.test(name)) {
    throw new Error(`Invalid call target: ${name}`);
  }
  return name;
}

/** Builds the text prefilter, as in `log` → `/(^|[^A-Za-z0-9_$])log\s*\(/`, which still admits `x.log(` because `.` counts as a boundary. */
function callTextPattern(target: string): RegExp {
  const parts = target.split(".").map((part) => escapeRegExp(part));
  const callPrefix = parts.length === 1 ? parts[0] : parts.join(String.raw`\s*\.\s*`);
  const prefixBoundary = parts.length === 1 ? "[^A-Za-z0-9_$]" : "[^A-Za-z0-9_.$]";
  return new RegExp(`(^|${prefixBoundary})${callPrefix}\\s*\\(`);
}

/** Removes duplicate rows when direct and member-call patterns overlap. */
function uniqueCallMatches(matches: SyntaxMatch[]): SyntaxMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.filePath}:${match.line}:${match.column}:${match.endLine}:${match.endColumn}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
