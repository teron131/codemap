/** Builds JSON signal payload sections for CLI output. */
import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";

export const STRUCTURAL_SUFFIXES = new Set([
	...PY_SUFFIXES,
	...TYPESCRIPT_SUFFIXES,
]);

type SignalExport = {
	sections?: Record<string, unknown>;
};

type Row = Record<string, unknown>;
type TopSignalPayload = {
	functions: Record<string, Row[]>;
	variables: Record<string, Row[]>;
	files: Record<string, Row[]>;
};

/** Selects and shapes signal sections for JSON output. */
export function buildSignalPayload(
	signalExport: SignalExport,
	{ limit, includeTests }: { limit: number; includeTests: boolean },
): Record<string, unknown> {
	const sections = recordValue(signalExport.sections);
	const usage = recordValue(sections.usage_signals);
	const usageTables = recordValue(usage.tables);
	const functionLengths = recordValue(sections.function_lengths);
	const fileRows = fileScopedRows(arrayValue(sections.file_profiles), {
		includeTests,
	}).filter((row) => isStructuralFileRow(row));

	const lengthRows = {
		python: limitedLengthSection(recordValue(functionLengths.python), limit, {
			includeTests,
		}),
		typescript: limitedLengthSection(
			recordValue(functionLengths.typescript),
			limit,
			{
				includeTests,
			},
		),
	};
	const payload = {
		relationships: sections.relationships ?? {},
		files: limitedRows(fileRows, limit),
		lengths: lengthRows,
		usage: { distribution: recordValue(usage.distribution) },
		functions: functionPayload(usageTables, limit, { includeTests }),
		variables: variablePayload(usageTables, limit, { includeTests }),
	};
	return {
		top: topPayload(
			{
				...payload,
				files: fileRows,
			},
			limit,
		),
		...payload,
	};
}

/** Builds JSON payload rows for function usage signals. */
export function functionPayload(
	usageTables: Record<string, unknown>,
	limit: number,
	{ includeTests }: { includeTests: boolean },
): Record<string, unknown> {
	const pythonCandidates = fileScopedRows(
		arrayValue(usageTables.python_function_candidates),
		{ includeTests },
	);
	const typescriptCandidates = fileScopedRows(
		arrayValue(usageTables.typescript_function_candidates),
		{ includeTests },
	);
	return {
		frequency: {
			python: highFrequencyRows(
				arrayValue(usageTables.python_functions),
				limit,
			),
			typescript: highFrequencyRows(
				arrayValue(usageTables.typescript_functions),
				limit,
			),
		},
		definitions: {
			python: functionPressureRows(pythonCandidates, limit),
			typescript: functionPressureRows(typescriptCandidates, limit),
		},
		lowUseDefinitions: {
			python: lowUseRows(pythonCandidates, limit),
			typescript: lowUseRows(typescriptCandidates, limit),
		},
	};
}

/** Builds JSON payload rows for variable usage signals. */
export function variablePayload(
	usageTables: Record<string, unknown>,
	limit: number,
	{ includeTests }: { includeTests: boolean },
): Record<string, unknown> {
	const pythonCandidates = fileScopedRows(
		arrayValue(usageTables.python_variable_candidates),
		{ includeTests },
	);
	const typescriptCandidates = fileScopedRows(
		arrayValue(usageTables.typescript_variable_candidates),
		{ includeTests },
	);
	return {
		frequency: {
			python: highFrequencyRows(
				arrayValue(usageTables.python_variables),
				limit,
			),
			typescript: highFrequencyRows(
				arrayValue(usageTables.typescript_variables),
				limit,
			),
		},
		definitions: {
			python: referenceCountRows(pythonCandidates, limit),
			typescript: referenceCountRows(typescriptCandidates, limit),
		},
		lowUseDefinitions: {
			python: lowUseRows(pythonCandidates, limit),
			typescript: lowUseRows(typescriptCandidates, limit),
		},
	};
}

/** Checks whether a file row belongs to structural source. */
export function isStructuralFileRow(row: Row): boolean {
	const filePath = rowFile(row);
	if (!filePath || filePath.endsWith("__init__.py")) {
		return false;
	}
	if (Number(row.total ?? 0) <= 0) {
		return false;
	}
	return [...STRUCTURAL_SUFFIXES].some((suffix) => filePath.endsWith(suffix));
}

/** Builds a capped table for the longest scanned code blocks. */
export function limitedLengthSection(
	section: Record<string, unknown>,
	limit: number,
	{ includeTests }: { includeTests: boolean },
): Record<string, unknown> {
	const rows = fileScopedRows(arrayValue(section.items), { includeTests });
	const counts = rows
		.map((row) => Number(row.count ?? 0))
		.sort((a, b) => a - b);
	if (counts.length === 0) {
		return { count: 0, median: 0, p90: 0, max: 0, items: [] };
	}
	const p90Index = Math.max(
		0,
		Math.min(counts.length - 1, Math.floor((counts.length * 9 + 9) / 10) - 1),
	);
	return {
		count: rows.length,
		median: counts[Math.floor(counts.length / 2)] ?? 0,
		p90: counts[p90Index] ?? 0,
		max: counts.at(-1) ?? 0,
		items: limitedRows(rows, limit),
	};
}

/** Filters signal rows to one source file. */
export function fileScopedRows(
	rows: Row[],
	{ includeTests }: { includeTests: boolean },
): Row[] {
	if (includeTests) {
		return rows;
	}
	return rows.filter((row) => !isTestPath(rowFile(row)));
}

/** Reads the source file path from a signal row. */
export function rowFile(row: Row): string {
	const filePath = row.file;
	if (filePath) {
		return String(filePath);
	}
	const identifier = String(row.identifier ?? "");
	return identifier.split("::", 1)[0] ?? "";
}

/** Checks whether a path looks like test code. */
export function isTestPath(filePath: string): boolean {
	const parts = filePath.split("/");
	const name = parts.at(-1) ?? filePath;
	return (
		parts.includes("tests") ||
		parts.includes("__tests__") ||
		name.startsWith("test_") ||
		name.includes("_test.") ||
		name.includes(".test.")
	);
}

/** Builds the top-signal payload section for summary output. */
export function topPayload(
	payload: Record<string, unknown>,
	limit: number,
): TopSignalPayload {
	const functions = recordValue(payload.functions);
	const variables = recordValue(payload.variables);
	return {
		functions: {
			longFunctions: limitedRows(
				languageRows(recordValue(functions.definitions)),
				limit,
			),
			lowUseDefinitions: limitedRows(
				languageRows(recordValue(functions.lowUseDefinitions)),
				limit,
			),
		},
		variables: {
			leastUsedDefinitions: limitedRows(
				languageRows(recordValue(variables.lowUseDefinitions)),
				limit,
			),
			broadNamePools: limitedRows(
				languageRows(recordValue(variables.frequency)),
				limit,
			),
		},
		files: {
			denseFiles: limitedRows(
				arrayValue(payload.files)
					.slice()
					.sort(
						(left, right) =>
							-Number(left.total ?? 0) - -Number(right.total ?? 0) ||
							compareText(String(left.file ?? ""), String(right.file ?? "")),
					),
				limit,
			),
		},
	};
}

/** Builds language-specific payload rows from signal sections. */
export function languageRows(
	payload: Record<string, unknown>,
	nestedKey: string | null = null,
): Row[] {
	const rows: Row[] = [];
	for (const language of ["python", "typescript"]) {
		const languagePayload = recordValue(payload[language]);
		const languageRows =
			nestedKey === null
				? arrayValue(payload[language])
				: arrayValue(languagePayload[nestedKey]);
		for (const row of languageRows) {
			rows.push({ language, ...row });
		}
	}
	return rows;
}

/** Sorts and caps metric rows for compact signal payload sections. */
export function limitedRows(rows: Row[], limit: number): Row[] {
	if (limit <= 0) {
		return rows;
	}
	return rows.slice(0, limit);
}

/** Selects the most frequently referenced signal rows. */
export function highFrequencyRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.slice()
			.sort(
				(left, right) =>
					-Number(left.count ?? 0) - -Number(right.count ?? 0) ||
					compareText(String(left.name ?? ""), String(right.name ?? "")),
			),
		limit,
	);
}

/** Selects the lowest-reference signal rows. */
export function lowUseRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.filter((row) => row.refactorCandidate)
			.sort(
				(left, right) =>
					Number(left.count ?? 0) - Number(right.count ?? 0) ||
					compareText(
						String(left.identifier ?? left.name ?? ""),
						String(right.identifier ?? right.name ?? ""),
					),
			),
		limit,
	);
}

/** Ranks functions by combined length and low-reference pressure. */
export function functionPressureRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.slice()
			.sort(
				(left, right) =>
					-Number(left.lines ?? 0) - -Number(right.lines ?? 0) ||
					Number(left.count ?? 0) - Number(right.count ?? 0) ||
					compareText(
						String(left.identifier ?? left.name ?? ""),
						String(right.identifier ?? right.name ?? ""),
					),
			),
		limit,
	);
}

/** Counts incoming reference edges for symbols in the graph. */
export function referenceCountRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.slice()
			.sort(
				(left, right) =>
					Number(left.count ?? 0) - Number(right.count ?? 0) ||
					compareText(
						String(left.identifier ?? left.name ?? ""),
						String(right.identifier ?? right.name ?? ""),
					),
			),
		limit,
	);
}

/** Selects one signal payload section by CLI section name. */
export function selectPayloadSection(
	payload: Record<string, unknown>,
	section: string,
): Record<string, unknown> {
	if (section === "all") {
		return payload;
	}
	return { [section]: payload[section] ?? {} };
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

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
