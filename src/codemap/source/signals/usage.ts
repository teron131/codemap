/** Builds usage-signal tables from scanned source metrics. */
import path from "node:path";

import {
	type FileMetrics,
	PY_SUFFIXES,
	TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import {
	countIdentifierOccurrences,
	functionUsageRows,
	usageDistribution,
	usageRows,
	variableUsageRows,
} from "./analysis.js";
import type {
	DefinitionRow,
	NameFrequencyRow,
	SignalLanguage,
	SignalRow,
} from "./schema.js";

type Row = SignalRow;

type UsageLanguageRows = {
	functionRows: NameFrequencyRow[];
	variableRows: NameFrequencyRow[];
	functionCandidates: DefinitionRow[];
	variableCandidates: DefinitionRow[];
};

/** Collects metric names for files matching a language suffix set. */
export function metricNames(
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
	attrName: "functionNames" | "variableNames",
): string[] {
	const names: string[] = [];
	for (const metrics of scannedFiles) {
		if (suffixes.has(metrics.suffix)) {
			names.push(...metrics[attrName]);
		}
	}
	return names;
}

/** Builds usage distributions and low-use candidate tables. */
export function buildUsageSection(
	allFiles: string[],
	scannedFiles: FileMetrics[],
): Row {
	const python = buildLanguageUsageRows(
		allFiles,
		scannedFiles,
		PY_SUFFIXES,
		"python",
	);
	const typescript = buildLanguageUsageRows(
		allFiles,
		scannedFiles,
		TYPESCRIPT_SUFFIXES,
		"typescript",
	);
	return {
		distribution: {
			typescript_functions: usageDistribution(typescript.functionRows),
			typescript_variables: usageDistribution(typescript.variableRows),
			python_functions: usageDistribution(python.functionRows),
			python_variables: usageDistribution(python.variableRows),
		},
		tables: {
			typescript_function_candidates: typescript.functionCandidates,
			typescript_variable_candidates: typescript.variableCandidates,
			python_function_candidates: python.functionCandidates,
			python_variable_candidates: python.variableCandidates,
		},
	};
}

/** Builds frequency and candidate rows for one source language. */
function buildLanguageUsageRows(
	allFiles: string[],
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
	language: SignalLanguage,
): UsageLanguageRows {
	const files = filesBySuffix(allFiles, suffixes);
	const occurrences = countIdentifierOccurrences(files);
	const functionRows = usageRows(
		metricNames(scannedFiles, suffixes, "functionNames"),
		occurrences,
	);
	const variableRows = usageRows(
		metricNames(scannedFiles, suffixes, "variableNames"),
		occurrences,
	);
	return {
		functionRows,
		variableRows,
		functionCandidates: functionUsageRows(scannedFiles, suffixes, occurrences, {
			language,
		}),
		variableCandidates: variableUsageRows(scannedFiles, suffixes, occurrences, {
			language,
		}),
	};
}

/** Selects files with a suffix handled by one language scanner. */
function filesBySuffix(allFiles: string[], suffixes: Set<string>): string[] {
	return allFiles.filter((filePath) => suffixes.has(path.extname(filePath)));
}
