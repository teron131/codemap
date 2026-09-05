/** Adapts ast-grep NAPI behavior to Codemap syntax operations. */
import { readFileSync } from "node:fs";
import path from "node:path";

import python from "@ast-grep/lang-python";
import { Lang, type NapiConfig, parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { parse as parseYaml } from "yaml";

import {
  languagesForFiles,
  normalizeLanguage,
  SYNTAX_SUFFIXES_BY_LANGUAGE,
  targetFiles,
} from "./targets.js";

export type SyntaxMatch = {
  engine: "ast-grep" | "regex";
  filePath: string;
  text: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  lines: string;
};

registerDynamicLanguage({ python });

/** Parses source text into an ast-grep root node for a language. */
export function astGrepRoot(source: string, language: string): SgNode | null {
  const napiLanguage = napiLanguageFor(normalizeLanguage(language));
  if (napiLanguage === null) {
    return null;
  }
  try {
    return parse(napiLanguage, source).root();
  } catch {
    return null;
  }
}

/** Finds syntax matches for a simple ast-grep pattern. */
export function syntaxMatches(
  root: string,
  lang: string,
  pattern: string,
  paths: string[],
  { limit = null }: { limit?: number | null } = {},
): SyntaxMatch[] | null {
  return ruleMatches(root, lang, { rule: { pattern } }, paths, { limit });
}

/** Finds ast-grep rule matches across resolved target files. */
export function ruleMatches(
  root: string,
  lang: string,
  matchConfig: NapiConfig,
  paths: string[],
  { limit = null }: { limit?: number | null } = {},
): SyntaxMatch[] | null {
  return new SyntaxSearch(root, paths).matches(lang, matchConfig, { limit });
}

/** Reuses one target inventory and one parse per language/file across a group of related rules. */
export class SyntaxSearch {
  private files: string[] | undefined;

  constructor(
    private readonly root: string,
    private readonly paths: string[],
  ) {}

  /** Infers syntax variants lazily so explicit unsupported languages keep their original failure behavior. */
  languages(): string[] {
    return languagesForFiles(this.targetFiles());
  }

  /** Finds one rule, optionally rejecting irrelevant source before native parsing. */
  matches(
    language: string,
    config: NapiConfig,
    { limit = null, prefilter }: { limit?: number | null; prefilter?: RegExp } = {},
  ): SyntaxMatch[] | null {
    return this.matchRules(language, [{ config, limit }], prefilter)?.[0] ?? null;
  }

  /** Preserves a separate ordered limit for each rule while reading and parsing each file only once. */
  matchRules(
    lang: string,
    rules: Array<{ config: NapiConfig; limit: number | null }>,
    prefilter?: RegExp,
  ): SyntaxMatch[][] | null {
    const language = normalizeLanguage(lang);
    if (napiLanguageFor(language) === null) {
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

/** Loads and parses an ast-grep YAML rule file. */
export function loadRule(rulePath: string): Record<string, unknown> {
  const data = parseYaml(readFileSync(rulePath, "utf8"));
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

/** Builds an ast-grep NAPI match config from a YAML rule. */
export function matchConfigFromRule(rule: Record<string, unknown>): NapiConfig {
  const matchConfig: Record<string, unknown> = { rule: rule.rule };
  for (const key of ["constraints", "utils", "transform"]) {
    const value = rule[key];
    if (value !== undefined && value !== null) {
      matchConfig[key] = value;
    }
  }
  return matchConfig as unknown as NapiConfig;
}

/** Builds context text around a syntax match range. */
export function contextLines(sourceLines: string[], startLine: number, endLine: number): string {
  if (sourceLines.length === 0) {
    return "";
  }
  const start = Math.max(0, startLine);
  const end = Math.min(sourceLines.length, endLine + 1);
  return sourceLines.slice(start, end).join("\n");
}

/** Maps normalized language names to ast-grep NAPI languages. */
function napiLanguageFor(language: string): Lang | string | null {
  const languages: Record<string, Lang | string> = {
    javascript: Lang.JavaScript,
    jsx: Lang.JavaScript,
    python: "python",
    tsx: Lang.Tsx,
    typescript: Lang.TypeScript,
  };
  return languages[language] ?? null;
}

/** Normalizes source text to newline-delimited lines. */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
