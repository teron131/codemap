/** Summarizes signal exports into compact metric rows and candidate tables. */
import { buildSignalExport } from "./build.js";

export const SIGNAL_EXPORT_SECTIONS = [
	"relationships",
	"usage",
	"function-lengths",
	"file-profiles",
] as const;
export const USAGE_TABLE_LIMIT = 40;

type Row = Record<string, unknown>;

/** Builds the full signal export for a target path. */
export function runSignalsExport(root: string): Row {
	try {
		const payload = buildSignalExport(root, {
			sectionMode: [...SIGNAL_EXPORT_SECTIONS],
			expanded: false,
		});
		return {
			...payload,
			status: "ok",
		};
	} catch (error) {
		return {
			status: "error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Summarizes signal export sections into compact metrics. */
export function signalMetrics(signalsExport: Row): Row {
	const sections =
		signalsExport.status === "ok" ? recordValue(signalsExport.sections) : {};
	const usage = recordValue(sections.usage_signals);
	const usageTables = recordValue(usage.tables);
	const functionLengths = recordValue(sections.function_lengths);
	const pythonVariables = sortedUsageRows(
		arrayValue(usageTables.python_variables),
	);
	const typescriptVariables = sortedUsageRows(
		arrayValue(usageTables.typescript_variables),
	);
	const pythonCandidates = lowUsageCandidateRows(
		arrayValue(usageTables.python_function_candidates),
	);
	const typescriptCandidates = lowUsageCandidateRows(
		arrayValue(usageTables.typescript_function_candidates),
	);
	const pythonVariableCandidates = lowUsageCandidateRows(
		arrayValue(usageTables.python_variable_candidates),
	);
	const typescriptVariableCandidates = lowUsageCandidateRows(
		arrayValue(usageTables.typescript_variable_candidates),
	);
	return {
		relationships: sections.relationships ?? {},
		longFunctions: {
			python: arrayValue(recordValue(functionLengths.python).items).slice(
				0,
				20,
			),
			typescript: arrayValue(
				recordValue(functionLengths.typescript).items,
			).slice(0, 20),
		},
		usageSignals: {
			distribution: usage.distribution ?? {},
			lowUsageFunctions: {
				python: pythonCandidates.slice(0, USAGE_TABLE_LIMIT),
				typescript: typescriptCandidates.slice(0, USAGE_TABLE_LIMIT),
			},
			lowUsageVariables: {
				python: pythonVariableCandidates.slice(0, USAGE_TABLE_LIMIT),
				typescript: typescriptVariableCandidates.slice(0, USAGE_TABLE_LIMIT),
			},
			noisyVariables: {
				python: pythonVariables.slice(0, USAGE_TABLE_LIMIT),
				typescript: typescriptVariables.slice(0, USAGE_TABLE_LIMIT),
			},
		},
		fileProfiles: arrayValue(sections.file_profiles).slice(0, 40),
	};
}

/** Extracts language-specific metric items from signal output. */
export function languageMetricItems(section: Row): Row[] {
	return [...arrayValue(section.python), ...arrayValue(section.typescript)];
}

/** Sorts usage rows by reference count and name. */
export function sortedUsageRows(rows: Row[]): Row[] {
	return rows
		.slice()
		.sort(
			(left, right) => -numberValue(left.count) - -numberValue(right.count),
		);
}

/** Reads low-use candidate rows from signal metric tables. */
export function lowUsageCandidateRows(rows: Row[]): Row[] {
	return rows
		.slice()
		.sort(
			(left, right) =>
				numberValue(left.count) - numberValue(right.count) ||
				compareText(
					String(left.identifier ?? left.name ?? ""),
					String(right.identifier ?? right.name ?? ""),
				),
		)
		.filter((item) => item.refactorCandidate);
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

/** Reads a numeric field from untrusted row data. */
function numberValue(value: unknown): number {
	return Number(value ?? 0);
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
