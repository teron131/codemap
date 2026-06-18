/** Renders signal payload sections as readable text output. */
import { languageRows } from "./payload.js";
import type { SignalRow } from "./schema.js";

type Row = SignalRow;

/** Renders selected signal payload sections as text. */
export function renderSignalText(
	payload: Record<string, unknown>,
	section: string,
): string {
	const lines = [signalTitle(section), ""];
	if ("top" in payload) {
		appendTop(lines, recordValue(payload.top));
	}
	if ("relationships" in payload) {
		appendRelationships(lines, recordValue(payload.relationships));
	}
	if ("usage" in payload) {
		appendUsageDistribution(lines, recordValue(payload.usage));
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
export function signalTitle(section: string): string {
	if (section === "all") {
		return "# Refactor Signals";
	}
	const titles: Record<string, string> = {
		top: "# Refactor Signals",
		relationships: "# Relationship Signals",
		files: "# File Profile Signals",
		lengths: "# Function Length Signals",
		functions: "# Function Signals",
		variables: "# Variable Signals",
		usage: "# Usage Signals",
	};
	return (
		titles[section] ?? `# ${titleCase(section.replaceAll("-", " "))} Signals`
	);
}

/** Appends top refactor signal sections to text output. */
export function appendTop(lines: string[], top: Record<string, unknown>): void {
	const functions = recordValue(top.functions);
	const variables = recordValue(top.variables);
	const files = recordValue(top.files);
	lines.push("## Functions");
	appendDefinitionRows(
		lines,
		"Long Functions",
		arrayValue(functions.longFunctions),
		{
			heading: "###",
			skipEmpty: true,
		},
	);
	appendDefinitionRows(
		lines,
		"Low-Use Definitions",
		arrayValue(functions.lowUseDefinitions),
		{
			heading: "###",
			skipEmpty: true,
		},
	);
	lines.push("");
	lines.push("## Variables");
	appendDefinitionRows(
		lines,
		"Low-Use Definitions",
		arrayValue(variables.leastUsedDefinitions),
		{
			heading: "###",
			skipEmpty: true,
		},
	);
	appendNameRows(
		lines,
		"Broad Name Pools",
		arrayValue(variables.broadNamePools),
		{
			heading: "###",
			skipEmpty: true,
		},
	);
	lines.push("");
	lines.push("## Files");
	appendDenseFileRows(lines, arrayValue(files.denseFiles), {
		heading: "###",
		skipEmpty: true,
	});
	lines.push("");
}

/** Appends relationship and entrypoint summaries to text output. */
export function appendRelationships(
	lines: string[],
	relationships: Record<string, unknown>,
): void {
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

/** Appends usage bucket summaries to text output. */
export function appendUsageDistribution(
	lines: string[],
	usage: Record<string, unknown>,
): void {
	lines.push("## Usage Distribution");
	const distribution = recordValue(usage.distribution);
	for (const key of [
		"python_functions",
		"python_variables",
		"typescript_functions",
		"typescript_variables",
	]) {
		const buckets = recordValue(distribution[key]);
		lines.push(
			`- ${key}: 0-1=${valueOrDefault(buckets["0_1"], 0)}, 2=${valueOrDefault(buckets["2"], 0)}, 3-5=${valueOrDefault(buckets["3_5"], 0)}, 6+=${valueOrDefault(buckets["6_plus"], 0)}`,
		);
	}
	lines.push("");
}

/** Appends function usage candidate rows to text signal output. */
export function appendFunctionSignals(
	lines: string[],
	payload: Record<string, unknown>,
): void {
	const lowUseRows = languageRows(recordValue(payload.lowUseDefinitions));
	appendDefinitionRows(
		lines,
		"Long Functions",
		languageRows(recordValue(payload.definitions)),
	);
	lines.push("");
	appendDefinitionRows(lines, "Low-Use Function Definitions", lowUseRows, {
		skipEmpty: true,
	});
	if (lowUseRows.length > 0) {
		lines.push("");
	}
	appendNameRows(
		lines,
		"Broad Function Names",
		languageRows(recordValue(payload.frequency)),
	);
	lines.push("");
}

/** Appends variable usage candidate rows to text signal output. */
export function appendVariableSignals(
	lines: string[],
	payload: Record<string, unknown>,
): void {
	const lowUseRows = languageRows(recordValue(payload.lowUseDefinitions));
	appendDefinitionRows(
		lines,
		"Least-Used Variable Definitions",
		languageRows(recordValue(payload.definitions)),
	);
	lines.push("");
	appendDefinitionRows(lines, "Low-Use Variable Definitions", lowUseRows, {
		skipEmpty: true,
	});
	if (lowUseRows.length > 0) {
		lines.push("");
	}
	appendNameRows(
		lines,
		"Broad Name Pools",
		languageRows(recordValue(payload.frequency)),
	);
	lines.push("");
}

/** Appends long-function rows to text signal output. */
export function appendLengths(
	lines: string[],
	lengths: Record<string, unknown>,
): void {
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
		lines.push(
			`- ${label}: count=${valueOrDefault(section.count, 0)}, max=${valueOrDefault(section.max, 0)}`,
		);
		for (const item of items.slice(0, 10)) {
			lines.push(`  - ${item.identifier}: ${item.count} lines`);
		}
	}
	lines.push("");
}

/** Appends file path rows to text signal output. */
export function appendFiles(lines: string[], rows: Row[]): void {
	lines.push("## File Profiles");
	for (const item of rows) {
		lines.push(
			`- ${item.file}: ${denseFileCounters(item, { includeProfileDetails: true })}`,
		);
	}
	lines.push("");
}

/** Appends definition rows with references and samples to text output. */
export function appendDefinitionRows(
	lines: string[],
	title: string,
	rows: Row[],
	{
		heading = "##",
		skipEmpty = false,
	}: { heading?: string; skipEmpty?: boolean } = {},
): void {
	if (rows.length === 0 && skipEmpty) {
		return;
	}
	lines.push(`${heading} ${title}`);
	if (rows.length === 0) {
		lines.push("- none");
		return;
	}
	for (const item of rows) {
		const identifier = item.identifier || item.name;
		const details =
			"lines" in item
				? [`${item.lines} lines`, refsText(item.count ?? 0)]
				: [refsText(item.count ?? 0)];
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

/** Appends dense-file rows to text signal output. */
export function appendDenseFileRows(
	lines: string[],
	rows: Row[],
	{
		heading = "##",
		skipEmpty = false,
	}: { heading?: string; skipEmpty?: boolean } = {},
): void {
	if (rows.length === 0 && skipEmpty) {
		return;
	}
	lines.push(`${heading} Dense Files`);
	if (rows.length === 0) {
		lines.push("- none");
		return;
	}
	if (rows.some((item) => item.total_label === "lines")) {
		lines.push(
			"- note: line-ranked rows use lightweight fallback for ranking; top rows include bounded syntax details when available, and inspect gives the full local profile.",
		);
	}
	for (const item of rows) {
		lines.push(`- ${item.file}: ${denseFileCounters(item)}`);
	}
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
function appendKnownCounter(
	counters: string[],
	item: Row,
	key: string,
	label: string,
): void {
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

/** Appends name-frequency rows to text signal output. */
export function appendNameRows(
	lines: string[],
	title: string,
	rows: Row[],
	{
		heading = "##",
		skipEmpty = false,
	}: { heading?: string; skipEmpty?: boolean } = {},
): void {
	if (rows.length === 0 && skipEmpty) {
		return;
	}
	lines.push(`${heading} ${title}`);
	if (rows.length === 0) {
		lines.push("- none");
		return;
	}
	for (const item of rows) {
		lines.push(`- ${item.name}: ${refsText(item.count ?? 0)}`);
	}
}

/** Appends file-count rows to text signal output. */
export function appendFileCountRows(
	lines: string[],
	title: string,
	rows: Row[],
): void {
	if (rows.length === 0) {
		return;
	}
	lines.push(`### ${title}`);
	for (const item of rows) {
		lines.push(`- ${item.file}: ${item.count}`);
	}
}

/** Formats reference counts for signal text output. */
export function refsText(value: unknown): string {
	const count = Number(value || 0);
	const label = count === 1 ? "ref" : "refs";
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
