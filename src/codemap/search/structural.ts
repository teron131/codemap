/** Runs explicit ast-grep pattern, call, and rule searches. */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  loadRule,
  matchConfigFromRule,
  resolveProjectFile,
  ruleMatches,
  type SyntaxMatch,
  SyntaxSearch,
} from "../ast-grep/index.js";
import { expandUser } from "../common.js";
import { escapeRegExp } from "../text-utils.js";

const CALL_TARGET_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** Finds function or method call sites through structural search. */
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

/** Runs ast-grep YAML rule search for target paths. */
export function searchRuleMatches(
  root: string,
  ruleFile: string,
  paths: string[],
): SyntaxMatch[] | null {
  const rulePath = resolveProjectFile(root, ruleFile);
  const rule = loadRule(rulePath);
  return ruleMatches(root, String(rule.language ?? ""), matchConfigFromRule(rule), paths);
}

/** Resolves CLI target paths while keeping them inside the project root. */
export function resolveTargetPaths(root: string, paths: string[]): string[] {
  if (paths.length === 0) {
    return ["."];
  }
  const resolved = [];
  const rootResolved = path.resolve(root);
  for (const rawPath of paths) {
    const candidate = expandUser(rawPath);
    if (path.isAbsolute(candidate)) {
      const resolvedCandidate = path.resolve(candidate);
      const relative = path.relative(rootResolved, resolvedCandidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`search path is outside project root: ${rawPath}`);
      }
      resolved.push(relative.split(path.sep).join("/"));
    } else {
      resolved.push(relativeTargetPath(rootResolved, candidate));
    }
  }
  return resolved;
}

/** Validates and normalizes a function or dotted call target. */
function callTarget(name: string): string {
  if (!CALL_TARGET_RE.test(name)) {
    throw new Error(`Invalid call target: ${name}`);
  }
  return name;
}

/** Resolves relative target paths from project root or the current directory. */
function relativeTargetPath(root: string, rawPath: string): string {
  const rootPath = path.resolve(root, rawPath);
  if (existsSync(rootPath)) {
    return rawPath;
  }
  const cwdPath = path.resolve(process.cwd(), rawPath);
  const relative = path.relative(root, cwdPath);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return rawPath;
}

/** Builds a text prefilter for direct or receiver-qualified callees. */
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
