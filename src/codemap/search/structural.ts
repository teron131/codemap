/** Structural search through the ast-grep CLI: one target inventory per search and one CLI run per group of related rules, plus the call-site and YAML-rule searches built on it. Match positions are one-based. */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  type AstGrepMatch,
  type AstGrepRule,
  findPattern,
  normalizeLanguage,
  scanSyntax,
} from "../ast-grep.js";
import { recordValue } from "../json-utils.js";
import { TYPESCRIPT_LANG_BY_SUFFIX } from "../source/scanner/index.js";
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

/** The ast-grep rule-config keys a search passes through to the CLI. */
export type SyntaxRuleConfig = Pick<AstGrepRule, "rule" | "utils" | "constraints" | "transform">;

const CALL_TARGET_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
// The grammars whose calls these patterns describe; in others, such as Go's, they match nothing, which would read as no callers.
const CALL_LANGUAGES = new Set(["javascript", "jsx", "python", "tsx", "typescript"]);

/**
 * A bare `name` also matches method calls such as `x.name(...)`, while a dotted target matches only that chain; throws for names that are not identifier chains.
 * Null for a language outside `CALL_LANGUAGES`.
 */
export function callMatches(
  search: SyntaxSearch,
  language: string,
  name: string,
): SyntaxMatch[] | null {
  if (!CALL_LANGUAGES.has(normalizeLanguage(language))) {
    return null;
  }
  const target = callTarget(name);
  const patterns = target.includes(".")
    ? [{ pattern: `${target}($$$ARGS)` }]
    : [{ pattern: `${target}($$$ARGS)` }, { pattern: `$RECEIVER.${target}($$$ARGS)` }];
  return uniqueCallMatches(
    search.matches(language, { rule: { any: patterns } }, { prefilter: callTextPattern(target) }),
  );
}

/** Expects an already resolved `rulePath`; throws `AstGrepRuleError` when the CLI rejects the rule or its language. */
export async function searchRuleMatches(
  root: string,
  rulePath: string,
  paths: string[],
): Promise<SyntaxMatch[]> {
  const rule = await loadRule(rulePath);
  return new SyntaxSearch(root, paths).matches(
    String(rule.language ?? ""),
    matchConfigFromRule(rule),
  );
}

/** Reuses one target inventory across a group of related rules, reading each file at most once. */
export class SyntaxSearch {
  private files: string[] | undefined;
  private readonly texts = new Map<string, string | null>();

  constructor(
    private readonly root: string,
    private readonly paths: string[],
  ) {}

  languages(): string[] {
    return languagesForFiles(this.targetFiles());
  }

  /** `prefilter` skips files whose text cannot match before the CLI parses them; throws `AstGrepRuleError` when the CLI rejects the rule or its language. */
  matches(
    language: string,
    config: SyntaxRuleConfig,
    { prefilter }: { prefilter?: RegExp } = {},
  ): SyntaxMatch[] {
    return this.matchRules(language, [{ config, limit: null }], prefilter)[0]!;
  }

  /** Matches one pattern as `ast-grep run` does, which, unlike a rule, accepts a pattern that parses only through error recovery, such as Python's `def save($$$)`; throws `AstGrepRuleError` when the CLI rejects the pattern or its language. */
  patternMatches(lang: string, pattern: string): SyntaxMatch[] {
    const language = normalizeLanguage(lang);
    const files = this.languageFiles(language);
    const results = new Map<string, AstGrepMatch[]>();
    for (const [grammar, grammarFiles] of grammarGroups(language, files)) {
      for (const [filePath, matches] of findPattern(grammarFiles, grammar, pattern)) {
        results.set(filePath, matches);
      }
    }
    return files.flatMap((filePath) =>
      (results.get(filePath) ?? []).map((match) => this.row(filePath, match)),
    );
  }

  /** Keeps a separate ordered limit for each rule, filling them in target-file order; throws `AstGrepRuleError` when the CLI rejects a rule or the language. */
  matchRules(
    lang: string,
    rules: Array<{ config: SyntaxRuleConfig; limit: number | null }>,
    prefilter?: RegExp,
  ): SyntaxMatch[][] {
    const language = normalizeLanguage(lang);
    const files = this.languageFiles(language, prefilter);
    const grammars = [...grammarGroups(language, files).keys()];
    const results = scanSyntax(
      files,
      rules.flatMap(({ config }, index) =>
        grammars.map((grammar) => ({ id: `rule${index}`, language: grammar, ...config })),
      ),
    );
    const groups = rules.map((): SyntaxMatch[] => []);
    for (const filePath of files) {
      for (const match of results.get(filePath) ?? []) {
        const index = Number(match.rule.slice("rule".length));
        const limit = rules[index]!.limit;
        if (limit !== null && groups[index]!.length >= limit) {
          continue;
        }
        groups[index]!.push(this.row(filePath, match));
      }
    }
    return groups;
  }

  /** A language with known suffixes searches only those files; any other language leaves the CLI to pick its files from the whole target set. */
  private languageFiles(language: string, prefilter?: RegExp): string[] {
    const suffixes = SYNTAX_SUFFIXES_BY_LANGUAGE[language];
    return this.targetFiles().filter(
      (filePath) =>
        (suffixes === undefined || suffixes.has(path.extname(filePath))) &&
        (prefilter === undefined || prefilter.test(this.text(filePath) ?? "")),
    );
  }

  private row(filePath: string, match: AstGrepMatch): SyntaxMatch {
    return {
      engine: "ast-grep",
      filePath: path.relative(this.root, filePath).split(path.sep).join("/"),
      text: match.text,
      line: match.startLine + 1,
      column: match.startColumn + 1,
      endLine: match.endLine + 1,
      endColumn: match.endColumn + 1,
      lines: contextLines(splitLines(this.text(filePath) ?? ""), match.startLine, match.endLine),
    };
  }

  private targetFiles(): string[] {
    return (this.files ??= targetFiles(this.root, this.paths));
  }

  /** Null for an unreadable file, which then matches nothing. */
  private text(filePath: string): string | null {
    if (!this.texts.has(filePath)) {
      let text: string | null;
      try {
        text = readFileSync(filePath, "utf8");
      } catch {
        text = null;
      }
      this.texts.set(filePath, text);
    }
    return this.texts.get(filePath) ?? null;
  }
}

/** Groups files by the grammar their own suffix calls for, so `.tsx` searched as TypeScript parses as TSX; a language without known suffixes is one group of every file. */
function grammarGroups(language: string, files: string[]): Map<string, string[]> {
  if (SYNTAX_SUFFIXES_BY_LANGUAGE[language] === undefined) {
    return new Map([[language, files]]);
  }
  const groups = new Map<string, string[]>();
  for (const filePath of files) {
    const grammar = grammarForFile(filePath);
    const group = groups.get(grammar) ?? [];
    group.push(filePath);
    groups.set(grammar, group);
  }
  return groups;
}

/** The CLI grammar for a file in a language with known suffixes; JSX parses with the JavaScript grammar. */
function grammarForFile(filePath: string): string {
  const suffix = path.extname(filePath);
  if (suffix === ".py") {
    return "python";
  }
  const language = TYPESCRIPT_LANG_BY_SUFFIX[suffix] ?? "typescript";
  return language === "jsx" ? "javascript" : language;
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

function matchConfigFromRule(rule: Record<string, unknown>): SyntaxRuleConfig {
  const config: SyntaxRuleConfig = { rule: recordValue(rule.rule) };
  for (const key of ["constraints", "utils", "transform"] as const) {
    const value = rule[key];
    if (value !== undefined && value !== null) {
      config[key] = recordValue(value);
    }
  }
  return config;
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
