/** Builds JSON signal payload sections for CLI output. */
import { PY_SUFFIXES, TYPESCRIPT_SUFFIXES } from "../scanner/index.js";
import { isAllCapsName, isPascalCaseName } from "./analysis.js";
import {
	isGeneratedSignalPath,
	isTestPath,
	SIGNAL_TOP_ROW_LIMIT,
} from "./policy.js";
import type {
	FunctionLengthSection,
	LanguageRows,
	SignalRow,
} from "./schema.js";

const STRUCTURAL_SUFFIXES = new Set([...PY_SUFFIXES, ...TYPESCRIPT_SUFFIXES]);
const LONG_IDENTIFIER_MIN_CHARACTERS = 30;
const LOCAL_FUNCTION_PRESSURE_MIN_LINES = 20;
const SMALL_FUNCTION_MAX_LINES = 8;

type SignalExport = {
	sections?: Record<string, unknown>;
};

type Row = SignalRow;
type TopSignalPayload = {
	functionPressure: Row[];
	smallFunctions: Row[];
	longNames: Row[];
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
	const payload: Record<string, unknown> = {
		relationships: sections.relationships ?? {},
		files: limitedRows(fileRows, limit),
		lengths: lengthRows,
		usage: { distribution: recordValue(usage.distribution) },
		functions: functionPayload(usageTables, limit, { includeTests }),
		variables: variablePayload(usageTables, limit, { includeTests }),
	};
	if ("docstring_signals" in sections) {
		payload.docstring_signals = sections.docstring_signals ?? {};
	}
	return {
		top: topPayload(
			{
				...payload,
				files: fileRows,
			},
			Math.min(limit, SIGNAL_TOP_ROW_LIMIT),
		),
		...payload,
	};
}

/** Builds JSON payload rows for function usage signals. */
function functionPayload(
	usageTables: Record<string, unknown>,
	limit: number,
	{ includeTests }: { includeTests: boolean },
): Record<string, LanguageRows> {
	const pythonCandidates = fileScopedRows(
		arrayValue(usageTables.python_function_candidates),
		{ includeTests },
	);
	const typescriptCandidates = fileScopedRows(
		arrayValue(usageTables.typescript_function_candidates),
		{ includeTests },
	);
	return {
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
function variablePayload(
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
		definitions: {
			python: mentionCountRows(pythonCandidates, limit),
			typescript: mentionCountRows(typescriptCandidates, limit),
		},
		lowUseDefinitions: {
			python: lowUseRows(pythonCandidates, limit),
			typescript: lowUseRows(typescriptCandidates, limit),
		},
		longNames: longIdentifierRows(
			[
				...pythonCandidates.map((row) => ({ language: "python", ...row })),
				...typescriptCandidates.map((row) => ({
					language: "typescript",
					...row,
				})),
			],
			limit,
		),
	};
}

/** Checks whether a file row belongs to structural source. */
function isStructuralFileRow(row: Row): boolean {
	const filePath = rowFile(row);
	if (!filePath || filePath.endsWith("__init__.py")) {
		return false;
	}
	if (Number(row.total ?? 0) <= 0) {
		return false;
	}
	if (isGeneratedSignalPath(filePath)) {
		return false;
	}
	return [...STRUCTURAL_SUFFIXES].some((suffix) => filePath.endsWith(suffix));
}

/** Builds a capped table for the longest scanned code blocks. */
function limitedLengthSection(
	section: Record<string, unknown>,
	limit: number,
	{ includeTests }: { includeTests: boolean },
): FunctionLengthSection<Row> {
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
function fileScopedRows(
	rows: Row[],
	{ includeTests }: { includeTests: boolean },
): Row[] {
	if (includeTests) {
		return rows;
	}
	return rows.filter((row) => !isTestPath(rowFile(row)));
}

/** Reads the source file path from a signal row. */
function rowFile(row: Row): string {
	const filePath = row.file;
	if (filePath) {
		return String(filePath);
	}
	const identifier = String(row.identifier ?? "");
	return identifier.split("::", 1)[0] ?? "";
}

/** Builds the top-signal payload section for summary output. */
function topPayload(
	payload: Record<string, unknown>,
	limit: number,
): TopSignalPayload {
	const functions = recordValue(payload.functions);
	const variables = recordValue(payload.variables);
	return {
		functionPressure: compactLocalFunctionPressureRows(
			languageRows(recordValue(functions.definitions)),
			limit,
		),
		smallFunctions: compactSmallFunctionRows(
			languageRows(recordValue(functions.lowUseDefinitions)),
			limit,
		),
		longNames: compactLongNameRows(arrayValue(variables.longNames), limit),
	};
}

/** Compacts locally ranked function size and mention evidence for fallback. */
function compactLocalFunctionPressureRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows.filter(
			(row) => Number(row.lines ?? 0) >= LOCAL_FUNCTION_PRESSURE_MIN_LINES,
		),
		limit,
	).map((row) => ({
		name: String(row.name ?? ""),
		path: String(row.file ?? ""),
		...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
		lines: Number(row.lines ?? 0),
		mentions: Number(row.count ?? 0),
		...(row.exported === true ? { exported: true } : {}),
	}));
}

/** Selects small private functions with few lexical mentions. */
function compactSmallFunctionRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.filter((row) => {
				const lines = Number(row.lines ?? 0);
				return lines > 0 && lines <= SMALL_FUNCTION_MAX_LINES;
			})
			.sort(
				(left, right) =>
					Number(left.count ?? 0) - Number(right.count ?? 0) ||
					Number(left.lines ?? 0) - Number(right.lines ?? 0) ||
					compareText(
						String(left.identifier ?? ""),
						String(right.identifier ?? ""),
					),
			)
			.map(compactSmallFunctionRow),
		limit,
	);
}

/** Selects unusually long variable-like identifiers. */
function longIdentifierRows(rows: Row[], limit: number): Row[] {
	return limitedRows(
		rows
			.filter((row) => {
				const name = String(row.name ?? "");
				return (
					name.length >= LONG_IDENTIFIER_MIN_CHARACTERS &&
					!isAllCapsName(name) &&
					!isPascalCaseName(name)
				);
			})
			.sort(
				(left, right) =>
					String(right.name ?? "").length - String(left.name ?? "").length ||
					Number(left.count ?? 0) - Number(right.count ?? 0) ||
					compareText(
						String(left.identifier ?? ""),
						String(right.identifier ?? ""),
					),
			),
		limit,
	);
}

/** Compacts long-name rows to the facts needed for review. */
function compactLongNameRows(rows: Row[], limit: number): Row[] {
	return limitedRows(rows, limit).map((row) => ({
		name: String(row.name ?? ""),
		path: String(row.file ?? ""),
		...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
		characters: String(row.name ?? "").length,
		mentions: Number(row.count ?? 0),
	}));
}

/** Compacts one small-function row to location and lexical evidence. */
function compactSmallFunctionRow(row: Row): Row {
	return {
		name: String(row.name ?? ""),
		path: String(row.file ?? ""),
		...(Number(row.line ?? 0) > 0 ? { line: Number(row.line) } : {}),
		lines: Number(row.lines ?? 0),
		mentions: Number(row.count ?? 0),
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
function limitedRows(rows: Row[], limit: number): Row[] {
	if (limit <= 0) {
		return rows;
	}
	return rows.slice(0, limit);
}

/** Selects the lowest-mention signal rows. */
function lowUseRows(rows: Row[], limit: number): Row[] {
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

/** Ranks functions by combined length and low-mention pressure. */
function functionPressureRows(rows: Row[], limit: number): Row[] {
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

/** Sorts definitions by lexical mention count. */
function mentionCountRows(rows: Row[], limit: number): Row[] {
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
	if (section === "top") {
		return recordValue(payload.top);
	}
	const key = payloadKeyForSection(section);
	return { [key]: payload[key] ?? {} };
}

/** Maps CLI section names to payload field names. */
function payloadKeyForSection(section: string): string {
	if (section === "docstring-signals") {
		return "docstring_signals";
	}
	return section;
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
