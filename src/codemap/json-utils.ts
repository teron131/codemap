/**
 * Provides shared coercions for untrusted JSON-like payload values.
 *
 * Codebase Memory responses, ast-grep output, and cached graph payloads all arrive as `unknown`. These readers narrow one field at a time and substitute an empty or null value instead of throwing, so callers can render partial payloads without guarding every access.
 *
 * The record and array readers accept a type parameter for the row shape a caller expects; that shape is asserted, not validated, which matches how these payloads were read before they shared an owner.
 */

/** Reads object records while rejecting arrays and primitives. */
export function recordValue<T extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
): T {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : ({} as T);
}

/** Reads arrays while rejecting other values. */
export function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Reads string fields while rejecting empty values. */
export function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads number fields while rejecting other values. */
export function numberField(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
