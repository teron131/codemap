/** The working-tree meaning of a qualified name such as `Model.save`: which class or module a definition belongs to, decided from one file's scanned spans so search and inspection agree. */
import path from "node:path";

import type { FileMetrics } from "./metrics.js";

export type QualifiedName = { owner: string; member: string };

const QUALIFIED_NAME_RE = /^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/;

/** Reads a dotted identifier chain by its last two segments, as in `pkg.Owner.member` → `{ owner: "Owner", member: "member" }`; null for any other text. */
export function qualifiedName(text: string): QualifiedName | null {
  const [, owner, member] = QUALIFIED_NAME_RE.exec(text) ?? [];
  return owner === undefined || member === undefined ? null : { owner, member };
}

/**
 * True when the definition starting at `line` sits directly in the body of a class named `owner`, or outside every class and function in a file whose stem is `owner`.
 *
 * A definition nested inside one of the class's methods is not a member.
 * One that starts on its owner's first line is not recognized, because spans carry lines without columns.
 */
export function isMemberOf(metrics: FileMetrics, owner: string, line: number): boolean {
  let enclosing: { name: string; startLine: number; isClass: boolean } | null = null;
  for (const [spans, isClass] of [
    [metrics.classSpans, true],
    [metrics.functionSpans, false],
  ] as const) {
    for (const span of spans) {
      const containsLine = span.startLine < line && line < span.startLine + span.span;
      if (containsLine && (enclosing === null || span.startLine > enclosing.startLine)) {
        enclosing = { name: span.name, startLine: span.startLine, isClass };
      }
    }
  }
  return enclosing === null
    ? path.basename(metrics.relPath, metrics.suffix) === owner
    : enclosing.isClass && enclosing.name === owner;
}
