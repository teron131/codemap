/** Enforces the final stdout ceiling while preserving complete text lines and valid JSON values. */
import { isRecord } from "../json-utils.js";

const OUTPUT_TOKEN_LIMIT = 10_000;
const BYTES_PER_ESTIMATED_TOKEN = 3;
const OUTPUT_BYTE_LIMIT = OUTPUT_TOKEN_LIMIT * BYTES_PER_ESTIMATED_TOKEN;

type OutputBudgetResult = {
  output: string;
  notice: string | null;
};

type ParsedJsonOutput = {
  value: unknown;
};

type JsonArrayGroup = {
  blocked: boolean;
  nextIndex: number;
  source: unknown[];
  target: unknown[];
};

/** Text output keeps whole lines and carries its truncation footer inline; JSON output stays one valid value and reports truncation in `notice` for stderr, keeping stdout jq-compatible. */
export function applyOutputBudget(output: string): OutputBudgetResult {
  if (fitsOutputBudget(output)) {
    return { output, notice: null };
  }
  const parsed = parseJsonOutput(output);
  if (parsed !== null) {
    return boundedJsonOutput(parsed.value);
  }
  return boundedTextOutput(output);
}

/** Wraps the value so a stdout of `null` stays distinguishable from text that is not JSON. */
function parseJsonOutput(output: string): ParsedJsonOutput | null {
  const value = output.trim();
  if (!value) {
    return null;
  }
  try {
    return { value: JSON.parse(value) };
  } catch {
    return null;
  }
}

/** Fills every array one item per pass, so one large section cannot starve its siblings; if the result still overflows, strings shorten in steps and an empty container is the last resort. */
function boundedJsonOutput(value: unknown): OutputBudgetResult {
  const groups: JsonArrayGroup[] = [];
  const target = jsonSkeleton(value, groups);
  const total = countJsonArrayItems(value);
  let outputBytes = Buffer.byteLength(JSON.stringify(target), "utf8") + 1;
  let shown = 0;

  while (true) {
    let attempted = false;
    const cycleLength = groups.length;
    for (let index = 0; index < cycleLength; index += 1) {
      const group = groups[index];
      if (!group || group.blocked || group.nextIndex >= group.source.length) {
        continue;
      }
      attempted = true;
      const childGroups: JsonArrayGroup[] = [];
      const sourceItem = group.source[group.nextIndex];
      const targetItem = Array.isArray(sourceItem)
        ? sourceItem
        : jsonSkeleton(sourceItem, childGroups);
      const itemBytes =
        Buffer.byteLength(JSON.stringify(targetItem), "utf8") + (group.target.length > 0 ? 1 : 0);
      if (outputBytes + itemBytes > OUTPUT_BYTE_LIMIT) {
        group.blocked = true;
        continue;
      }
      group.target.push(targetItem);
      group.nextIndex += 1;
      outputBytes += itemBytes;
      shown += 1;
      groups.push(...childGroups);
    }
    if (!attempted) {
      break;
    }
  }

  const rowOutput = `${JSON.stringify(target)}\n`;
  let output = rowOutput;
  for (const maxStringBytes of [4_096, 1_024, 256, 64, 16]) {
    if (fitsOutputBudget(output)) {
      break;
    }
    output = `${JSON.stringify(truncateJsonStrings(target, maxStringBytes))}\n`;
  }
  if (!fitsOutputBudget(output)) {
    output = `${JSON.stringify(Array.isArray(value) ? [] : isRecord(value) ? {} : "")}\n`;
  }
  const truncated = Math.max(0, total - shown);
  const valuesShortened = output !== rowOutput;
  return {
    output,
    notice:
      truncated > 0 || valuesShortened
        ? outputBudgetNotice({ output, shown, total, truncated, valuesShortened })
        : null,
  };
}

/** Returns `value` with every array emptied and registers each non-empty one in `groups` (mutated) for later filling. */
function jsonSkeleton(value: unknown, groups: JsonArrayGroup[]): unknown {
  if (Array.isArray(value)) {
    const target: unknown[] = [];
    if (value.length > 0) {
      groups.push({
        blocked: false,
        nextIndex: 0,
        source: value,
        target,
      });
    }
    return target;
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonSkeleton(item, groups)]),
  );
}

/** Counts JSON array items, treating positional row arrays as atomic values. */
function countJsonArrayItems(value: unknown): number {
  if (Array.isArray(value)) {
    return (
      value.length +
      value.reduce((total, item) => total + (isRecord(item) ? countJsonArrayItems(item) : 0), 0)
    );
  }
  if (!isRecord(value)) {
    return 0;
  }
  return Object.values(value).reduce<number>((total, item) => total + countJsonArrayItems(item), 0);
}

function truncateJsonStrings(value: unknown, maxBytes: number): unknown {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxBytes) {
      return value;
    }
    return `${utf8Prefix(value, Math.max(0, maxBytes - 3))}...`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateJsonStrings(item, maxBytes));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, truncateJsonStrings(item, maxBytes)]),
  );
}

/** Keeps the longest complete-code-point prefix within a UTF-8 byte allowance. */
function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    bytes += characterBytes;
    result += character;
  }
  return result;
}

function boundedTextOutput(output: string): OutputBudgetResult {
  const lines = output.trimEnd().split(/\r?\n/);
  const shown: string[] = [];
  let outputBytes = 0;
  for (const line of lines) {
    const nextShown = shown.length + 1;
    const footer = textBudgetFooter(nextShown, lines.length);
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (outputBytes + lineBytes + Buffer.byteLength(footer, "utf8") + 1 > OUTPUT_BYTE_LIMIT) {
      break;
    }
    shown.push(line);
    outputBytes += lineBytes;
  }
  const footer = textBudgetFooter(shown.length, lines.length);
  return {
    output: `${[...shown, footer].join("\n")}\n`,
    notice: null,
  };
}

function textBudgetFooter(shown: number, total: number): string {
  return `... output truncated: shown=${shown}, total=${total}, truncated=${Math.max(0, total - shown)}, token_limit=${OUTPUT_TOKEN_LIMIT}`;
}

function outputBudgetNotice({
  output,
  shown,
  total,
  truncated,
  valuesShortened,
}: {
  output: string;
  shown: number;
  total: number;
  truncated: number;
  valuesShortened: boolean;
}): string {
  return `codemap: output truncated: shown=${shown}, total=${total}, truncated=${truncated} items${valuesShortened ? ", values=shortened" : ""}, estimated_tokens=${estimatedTokens(output)}, token_limit=${OUTPUT_TOKEN_LIMIT}`;
}

function estimatedTokens(output: string): number {
  return Math.ceil(Buffer.byteLength(output, "utf8") / BYTES_PER_ESTIMATED_TOKEN);
}

function fitsOutputBudget(output: string): boolean {
  return Buffer.byteLength(output, "utf8") <= OUTPUT_BYTE_LIMIT;
}
