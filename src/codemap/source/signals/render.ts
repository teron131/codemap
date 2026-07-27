/** Renders signal payload sections as readable text output. */
import { languageRows, rankDefinitionRowsByMentions, rankFunctionRowsByLength } from "./payload.js";
import type { SignalRow } from "./schema.js";

type Row = SignalRow;

/** Renders selected signal payload sections as text. */
export function renderSignalText(payload: Record<string, unknown>, section: string): string {
  const lines = [signalTitle(section), ""];
  if (payload.freshness === "partial") {
    lines.push("backend: partial index", "");
  } else if (payload.freshness === "degraded") {
    lines.push("backend: unavailable");
    if (typeof payload.backendReason === "string" && payload.backendReason.length > 0) {
      lines.push(`backend reason: ${payload.backendReason}`);
    }
    lines.push("");
  } else if (payload.backendStatus === "skipped") {
    lines.push("backend: skipped");
    if (typeof payload.backendReason === "string" && payload.backendReason.length > 0) {
      lines.push(`backend reason: ${payload.backendReason}`);
    }
    lines.push("");
  }
  const coverage = recordValue(payload.coverage);
  if (coverage.mode === "bounded") {
    lines.push(
      `coverage: bounded current tree; parsed=${numberValue(coverage.parsedFiles)}, eligible=${numberValue(coverage.eligibleFiles)}`,
      "",
    );
  }
  if ("stats" in payload) {
    appendSignalStats(lines, recordValue(payload.stats));
  }
  if (section === "top") {
    appendTop(lines, payload);
  } else if ("functionMetrics" in payload) {
    const functionMetrics = arrayValue(payload.functionMetrics);
    if (functionMetrics.length > 0) {
      appendCompactSignalRows(
        lines,
        functionMetricRankingTitle(functionMetrics),
        functionMetrics,
        functionMetricFacts,
      );
      lines.push("");
    }
  }
  if ("relationships" in payload) {
    appendRelationships(lines, recordValue(payload.relationships));
  }
  if ("usage" in payload) {
    appendUsageBins(lines, recordValue(payload.usage));
  }
  if ("docstring_signals" in payload) {
    appendDocstringSignals(lines, recordValue(payload.docstring_signals));
  }
  if ("docstrings" in payload) {
    appendDocstrings(lines, recordValue(payload.docstrings));
  }
  if ("functions" in payload) {
    appendFunctionSignals(lines, recordValue(payload.functions));
  }
  if ("variables" in payload) {
    appendVariableSignals(lines, recordValue(payload.variables));
  }
  if ("lengths" in payload) {
    appendLengths(lines, recordValue(payload.lengths));
  }
  if ("files" in payload) {
    appendFiles(lines, arrayValue(payload.files));
  }
  return `${lines.join("\n")}\n`;
}

/** Formats a signal section title for text output. */
function signalTitle(section: string): string {
  if (section === "all") {
    return "# Ranked Source Metrics";
  }
  const titles: Record<string, string> = {
    top: "# Ranked Source Metrics",
    relationships: "# Relationship Signals",
    files: "# File Profile Signals",
    lengths: "# Function Lengths",
    functions: "# Function Rankings",
    variables: "# Variable Rankings",
    usage: "# Usage Signals",
    "docstring-signals": "# Docstring Signals",
    docstrings: "# Docstrings",
  };
  return titles[section] ?? `# ${titleCase(section.replaceAll("-", " "))} Signals`;
}

/** Appends top ranked metric sections to text output. */
function appendTop(lines: string[], top: Record<string, unknown>): void {
  const functionMetrics = arrayValue(top.functionMetrics);
  const functionsByMentions = arrayValue(top.functionsByMentions);
  const variablesByNameLength = arrayValue(top.variablesByNameLength);
  if (
    functionMetrics.length === 0 &&
    functionsByMentions.length === 0 &&
    variablesByNameLength.length === 0
  ) {
    lines.push("No ranked source rows.");
    lines.push("");
    return;
  }
  appendCompactSignalRows(
    lines,
    functionMetricRankingTitle(functionMetrics),
    functionMetrics,
    functionMetricFacts,
  );
  appendCompactSignalRows(
    lines,
    "Functions by Mentions (fewest, then shortest)",
    functionsByMentions,
    functionMentionFacts,
  );
  appendCompactSignalRows(
    lines,
    "Variables by Name Length (longest, then fewest mentions)",
    variablesByNameLength,
    variableNameLengthFacts,
  );
  lines.push("");
}

/** Describes the metric order represented by backend, local, or mixed rows. */
function functionMetricRankingTitle(rows: Row[]): string {
  const backendRows = rows.filter((row) => "cognitive" in row || "cyclomatic" in row).length;
  if (backendRows === 0) {
    return rows.some((row) => "mentions" in row)
      ? "Function Metrics (length, then fewest mentions)"
      : "Function Metrics (length)";
  }
  if (backendRows === rows.length) {
    return "Function Metrics (cognitive, cyclomatic, then length)";
  }
  return "Function Metrics (backend complexity, then local length fallback)";
}

/** Appends one compact evidence group with one line per source target. */
function appendCompactSignalRows(
  lines: string[],
  title: string,
  rows: Row[],
  factsFor: (row: Row) => string[],
): void {
  if (rows.length === 0) {
    return;
  }
  lines.push(`## ${title}`);
  for (const row of rows) {
    lines.push(`- ${signalLocation(row)}: ${factsFor(row).join(", ")}`);
  }
  lines.push("");
}

/** Formats backend complexity and loop evidence without advice text. */
function functionMetricFacts(row: Row): string[] {
  const facts: string[] = [];
  if ("cognitive" in row) {
    facts.push(`cognitive=${numberValue(row.cognitive)}`);
  }
  if ("cyclomatic" in row) {
    facts.push(`cyclomatic=${numberValue(row.cyclomatic)}`);
  }
  facts.push(`lines=${numberValue(row.lines)}`);
  appendPositiveFact(facts, row, "linearScanInLoop", "linear_scan_in_loop");
  if ("mentions" in row) {
    facts.push(`mentions=${numberValue(row.mentions)}`);
  }
  if (row.exported === true) {
    facts.push("exported");
  }
  return facts;
}

/** Formats function size and lexical mention evidence. */
function functionMentionFacts(row: Row): string[] {
  return [`lines=${numberValue(row.lines)}`, `mentions=${numberValue(row.mentions)}`];
}

/** Formats identifier length and lexical mention evidence. */
function variableNameLengthFacts(row: Row): string[] {
  return [`characters=${numberValue(row.characters)}`, `mentions=${numberValue(row.mentions)}`];
}

/** Formats a compact path, line, and symbol location. */
function signalLocation(row: Row): string {
  const path = String(row.path ?? "unknown");
  const line = Number(row.line ?? 0);
  const name = String(row.name ?? "unknown");
  return `${path}${line > 0 ? `:${line}` : ""} ${name}`;
}

/** Appends one positive numeric fact when the backend reported it. */
function appendPositiveFact(facts: string[], row: Row, key: string, label: string): void {
  const value = numberValue(row[key]);
  if (value > 0) {
    facts.push(`${label}=${value}`);
  }
}

/** Appends relationship and entrypoint summaries to text output. */
function appendRelationships(lines: string[], relationships: Record<string, unknown>): void {
  const counts = recordValue(relationships.counts);
  lines.push("## Relationships");
  for (const [key, label] of [
    ["python_import_edges", "Python import edges"],
    ["typescript_import_edges", "TypeScript import edges"],
    ["entrypoint_like_files", "Entrypoint-like files"],
    ["typescript_relative_imports", "TypeScript relative imports"],
    ["python_relative_imports", "Python relative imports"],
    ["typescript_reexport_edges", "TypeScript re-export edges"],
    ["python_inheritance_edges", "Python inheritance edges"],
  ] as const) {
    lines.push(`- ${label}: ${valueOrDefault(counts[key], 0)}`);
  }
  appendFileCountRows(
    lines,
    "Top Local Import Hubs",
    arrayValue(relationships.top_local_import_hubs),
  );
  appendFileCountRows(
    lines,
    "Top Inheritance Hubs",
    arrayValue(relationships.top_inheritance_hubs),
  );
  lines.push("");
}

/** Appends usage-bin summaries to text output. */
function appendUsageBins(lines: string[], usage: Record<string, unknown>): void {
  lines.push("## Usage Bins");
  const binsByMetric = recordValue(usage.bins);
  for (const key of [
    "python_functions",
    "python_variables",
    "typescript_functions",
    "typescript_variables",
  ]) {
    const bins = recordValue(binsByMetric[key]);
    lines.push(`- ${key}: ${binsText(bins) || "none"}`);
  }
  lines.push("");
}

/** Appends function rankings to text output. */
function appendFunctionSignals(lines: string[], payload: Record<string, unknown>): void {
  const lengthRows = rankFunctionRowsByLength(languageRows(recordValue(payload.byLength)));
  appendDefinitionRows(
    lines,
    lengthRows.some((row) => "count" in row)
      ? "Functions by Length (longest, then fewest mentions)"
      : "Functions by Length (longest)",
    lengthRows,
  );
  lines.push("");
  appendDefinitionRows(
    lines,
    "Functions by Mentions (fewest, then shortest)",
    rankDefinitionRowsByMentions(languageRows(recordValue(payload.byMentions))),
  );
  lines.push("");
}

/** Appends variable rankings to text output. */
function appendVariableSignals(lines: string[], payload: Record<string, unknown>): void {
  appendVariableNameLengthRows(lines, arrayValue(payload.byNameLength));
  appendDefinitionRows(
    lines,
    "Variables by Mentions (fewest first)",
    rankDefinitionRowsByMentions(languageRows(recordValue(payload.byMentions))),
  );
  lines.push("");
}

/** Appends variable definitions ranked by identifier length. */
function appendVariableNameLengthRows(lines: string[], rows: Row[]): void {
  if (rows.length === 0) {
    return;
  }
  lines.push("## Variables by Name Length (longest, then fewest mentions)");
  for (const row of rows) {
    lines.push(
      `- ${row.identifier ?? row.name}: characters=${String(row.name ?? "").length}, mentions=${numberValue(row.count)}`,
    );
  }
  lines.push("");
}

/** Appends long-function rows to text signal output. */
function appendLengths(lines: string[], lengths: Record<string, unknown>): void {
  lines.push("## Function Lengths");
  for (const [key, label] of [
    ["python", "Python"],
    ["typescript", "TypeScript"],
  ] as const) {
    const section = recordValue(lengths[key]);
    const items = arrayValue(section.items);
    if (items.length === 0) {
      continue;
    }
    lines.push(`- ${label}: ${numericStatsText(section)}`);
    const bins = binsText(recordValue(section.bins));
    if (bins) {
      lines.push(`  bins: ${bins}`);
    }
    for (const item of items) {
      lines.push(`  - ${item.identifier}: ${item.count} lines`);
    }
  }
  lines.push("");
}

/** Appends whole-population statistics before ranked signal rows. */
function appendSignalStats(lines: string[], stats: Record<string, unknown>): void {
  const groups = [
    ["function", recordValue(stats.functions)],
    ["variable", recordValue(stats.variables)],
  ] as const;
  const rows: Array<[string, Record<string, unknown>]> = [];
  for (const [groupLabel, group] of groups) {
    for (const [metric, value] of Object.entries(group)) {
      const metricStats = recordValue(value);
      if (Object.keys(metricStats).length > 0) {
        rows.push([`${groupLabel} ${metric}`, metricStats]);
      }
    }
  }
  if (rows.length === 0) {
    return;
  }
  lines.push("## Statistics");
  for (const [label, metricStats] of rows) {
    lines.push(`- ${label}: ${numericStatsText(metricStats)}`);
    const bins = binsText(recordValue(metricStats.bins));
    if (bins) {
      lines.push(`  bins: ${bins}`);
    }
  }
  lines.push("");
}

/** Formats pandas-like numeric statistics in stable field order. */
function numericStatsText(stats: Record<string, unknown>): string {
  return [
    ["count", stats.count],
    ["mean", stats.mean],
    ["std", stats.std],
    ["min", stats.min],
    ["p25", stats.p25],
    ["p50", stats.p50],
    ["p75", stats.p75],
    ["p90", stats.p90],
    ["max", stats.max],
  ]
    .map(([key, value]) => `${key}=${numberValue(value)}`)
    .join(", ");
}

/** Formats named numeric bins without implying chart output. */
function binsText(bins: Record<string, unknown>): string {
  return Object.entries(bins)
    .map(([label, count]) => `${label}=${numberValue(count)}`)
    .join(", ");
}

/** Appends file path rows to text signal output. */
function appendFiles(lines: string[], rows: Row[]): void {
  lines.push("## File Profiles");
  for (const item of rows) {
    lines.push(`- ${item.file}: ${denseFileCounters(item, { includeProfileDetails: true })}`);
  }
  lines.push("");
}

/** Appends compact docstring coverage and preview rows to signal output. */
function appendDocstringSignals(lines: string[], payload: Record<string, unknown>): void {
  lines.push("## Docstring Coverage");
  const fileDocstrings = recordValue(payload.file_docstrings);
  lines.push(
    `- files: ${valueOrDefault(payload.files_considered, 0)} considered (${valueOrDefault(payload.typescript_files_considered, 0)} TypeScript, ${valueOrDefault(payload.python_files_considered, 0)} Python)`,
  );
  lines.push(
    `- file docstrings: ${valueOrDefault(fileDocstrings.present, 0)}/${valueOrDefault(fileDocstrings.total, 0)}`,
  );
  appendDocstringPreviewRows(
    lines,
    "File Docstring Previews",
    arrayValue(payload.file_docstring_previews),
  );
  appendDocstringPreviewRows(
    lines,
    "Likely Main Function Docstrings",
    arrayValue(payload.likely_main_function_docstrings),
    { includeLine: true },
  );
  lines.push("");
}

/** Appends full docstring report rows with compact previews. */
function appendDocstrings(lines: string[], payload: Record<string, unknown>): void {
  lines.push("## Docstring Files");
  lines.push(
    `- files: ${valueOrDefault(payload.files, 0)} (${valueOrDefault(payload.typescript_files, 0)} TypeScript, ${valueOrDefault(payload.python_files, 0)} Python)`,
  );
  lines.push(
    `- definitions: ${valueOrDefault(payload.functions, 0)} functions, ${valueOrDefault(payload.class_methods, 0)} methods, ${valueOrDefault(payload.classes, 0)} classes`,
  );
  const reports = arrayValue(payload.file_reports);
  if (reports.length === 0) {
    lines.push("- none");
    lines.push("");
    return;
  }
  for (const report of reports) {
    const file = String(report.file ?? "");
    const preview = previewText(report.file_docstring_preview);
    lines.push(`- ${file}: file=${preview}`);
    appendDefinitionPreviewChildren(lines, arrayValue(report.functions), {
      prefix: "function",
    });
    appendDefinitionPreviewChildren(lines, arrayValue(report.classes), {
      prefix: "class",
    });
  }
  lines.push("");
}

/** Appends definition rows with lexical mentions to text output. */
function appendDefinitionRows(lines: string[], title: string, rows: Row[]): void {
  lines.push(`## ${title}`);
  if (rows.length === 0) {
    lines.push("- none");
    return;
  }
  for (const item of rows) {
    const identifier = item.identifier || item.name;
    const details = "lines" in item ? [`${item.lines} lines`] : [];
    if ("count" in item) {
      details.push(mentionsText(item.count));
    }
    if ("line" in item) {
      details.push(`line ${item.line}`);
    }
    if (item.exported) {
      details.push("exported");
    }
    if (item.moduleLevel) {
      details.push("module");
    }
    lines.push(`- ${identifier}: ${details.join(", ")}`);
  }
}

/** Appends rows that carry file/name/preview docstring fields. */
function appendDocstringPreviewRows(
  lines: string[],
  title: string,
  rows: Row[],
  { includeLine = false }: { includeLine?: boolean } = {},
): void {
  lines.push(`### ${title}`);
  if (rows.length === 0) {
    lines.push("- none");
    return;
  }
  for (const item of rows) {
    const file = String(item.file ?? "");
    const name = String(item.qualified_name ?? item.name ?? "").trim();
    const line = includeLine && item.line ? `:${item.line}` : "";
    const label = name ? `${file}${line} ${name}` : `${file}${line}`;
    lines.push(`- ${label}: ${previewText(item.docstring_preview ?? item.preview)}`);
  }
}

/** Appends nested function/class previews for one full docstring file report. */
function appendDefinitionPreviewChildren(
  lines: string[],
  rows: Row[],
  { prefix }: { prefix: string },
): void {
  for (const row of rows) {
    const name = String(row.qualified_name ?? row.name ?? "").trim();
    const line = row.line ? `:${row.line}` : "";
    lines.push(`  - ${prefix} ${name}${line}: ${previewText(row.docstring_preview)}`);
    if (prefix === "class") {
      appendDefinitionPreviewChildren(lines, arrayValue(row.methods), {
        prefix: "method",
      });
      appendDefinitionPreviewChildren(lines, arrayValue(row.nested_classes), {
        prefix: "class",
      });
    } else {
      appendDefinitionPreviewChildren(lines, arrayValue(row.nested_functions), {
        prefix,
      });
    }
  }
}

/** Formats a compact docstring preview fallback. */
function previewText(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "none";
}

/** Formats the dense-file counters shared by signals and inspect output. */
export function denseFileCounters(
  item: Row,
  { includeProfileDetails = false }: { includeProfileDetails?: boolean } = {},
): string {
  const counters = [
    includeProfileDetails
      ? `${denseFileScoreText(item)}${sourceLineDetail(item)}`
      : denseFileScoreText(item),
  ];
  appendKnownCounter(counters, item, "defines", "defines");
  appendKnownCounter(counters, item, "imports_local", "local_imports");
  appendKnownCounter(counters, item, "exports", "exports");
  appendKnownCounter(counters, item, "reexports_local", "reexports");
  if (includeProfileDetails) {
    appendKnownCounter(counters, item, "decorators", "decorators");
  }
  return counters.join(", ");
}

/** Appends a counter only when the payload includes that metric. */
function appendKnownCounter(counters: string[], item: Row, key: string, label: string): void {
  if (key in item) {
    counters.push(`${label}=${numberValue(item[key])}`);
  }
}

/** Formats the main dense-file score label. */
function denseFileScoreText(item: Row): string {
  const label = item.total_label === "lines" ? "lines" : "signals";
  return `${label}=${numberValue(item.total)}`;
}

/** Formats an optional source line-count detail for file profile rows. */
function sourceLineDetail(item: Row): string {
  const lines = Number(item.lines ?? 0);
  return lines > 0 ? `, lines=${lines}` : "";
}

/** Appends file-count rows to text signal output. */
function appendFileCountRows(lines: string[], title: string, rows: Row[]): void {
  if (rows.length === 0) {
    return;
  }
  lines.push(`### ${title}`);
  for (const item of rows) {
    lines.push(`- ${item.file}: ${item.count}`);
  }
}

/** Formats global lexical occurrence counts without calling them references. */
function mentionsText(value: unknown): string {
  const count = Number(value || 0);
  const label = count === 1 ? "mention" : "mentions";
  return `${count} ${label}`;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

/** Formats missing values with a fallback display string. */
function valueOrDefault(value: unknown, fallback: unknown): unknown {
  return value ?? fallback;
}

/** Reads a numeric field from untrusted row data. */
function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

/** Formats labels for output headings. */
function titleCase(value: string): string {
  return value.replace(
    /\w\S*/g,
    (word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`,
  );
}
