/**
 * Narrows untrusted JSON-like values one field at a time, substituting empty or null values instead of throwing.
 *
 * Codebase Memory responses, ripgrep JSON events, and loosely typed signal rows all arrive as `unknown`, so callers can render partial payloads without guarding every access.
 *
 * The record and array readers take a type parameter for the row shape a caller expects; that shape is asserted, not validated.
 */

export function recordValue<T extends Record<string, unknown> = Record<string, unknown>>(
  value: unknown,
): T {
  return isRecord(value) ? (value as T) : ({} as T);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Null for non-strings and `""`; whitespace-only strings pass, unlike `nonblankString`. */
export function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Null for non-strings and whitespace-only text; a passing value keeps its surrounding whitespace. */
export function nonblankString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function numberField(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** Unlike `numberField`, coerces with `Number`: `"12"` → 12, null and undefined → 0, and `"abc"` → `NaN`. */
export function numberValue(value: unknown): number {
  return Number(value ?? 0);
}
