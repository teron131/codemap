/** Explicit call-site and YAML-rule searches over `SyntaxSearch`, plus resolution of their CLI target paths. */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  loadRule,
  matchConfigFromRule,
  type SyntaxMatch,
  SyntaxSearch,
} from "../ast-grep/index.js";
import { expandUser } from "../common.js";
import { escapeRegExp } from "../text-utils.js";

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

/** Returns root-relative paths, reading a relative path against the root first and the working directory second; absolute paths outside the root throw. */
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

function callTarget(name: string): string {
  if (!CALL_TARGET_RE.test(name)) {
    throw new Error(`Invalid call target: ${name}`);
  }
  return name;
}

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
