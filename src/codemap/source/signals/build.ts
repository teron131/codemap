/** Builds full signal exports from scanned files and selected sections. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import {
	discoverFiles,
	type FileMetrics,
	type FunctionSpan,
	PY_SUFFIXES,
	relativePath,
	scanFile,
	TYPESCRIPT_SUFFIXES,
} from "../scanner/index.js";
import {
	buildSignalFocusEntries,
	fileProfileRow,
	functionLengthSection,
	topHubs,
	topInheritanceHubs,
} from "./analysis.js";
import {
	buildDocstringSignals,
	buildDocstringsData,
	buildFilePreviews,
	DOCSTRING_SUFFIXES,
} from "./docstrings/index.js";
import type { DenseFileRow, SignalFocusEntry, SignalRow } from "./schema.js";
import { buildUsageSection } from "./usage.js";

export const SUMMARY_SECTIONS = [
	"filesystem",
	"relationships",
	"docstring-signals",
	"likely-main",
	"usage",
	"function-lengths",
] as const;

export const ALL_SECTIONS = [
	"filesystem",
	"relationships",
	"docstring-signals",
	"likely-main",
	"file-profiles",
	"usage",
	"function-lengths",
	"docstrings",
] as const;

type Row = SignalRow;

/** Expands signal section modes into concrete section names. */
export function selectedSections(sectionMode: string | string[]): string[] {
	const requestedModes = Array.isArray(sectionMode)
		? sectionMode
		: [sectionMode];
	const sections: string[] = [];
	for (const mode of requestedModes) {
		const candidates =
			mode === "summary"
				? SUMMARY_SECTIONS
				: mode === "all"
					? ALL_SECTIONS
					: [mode];
		for (const section of candidates) {
			if (!sections.includes(section)) {
				sections.push(section);
			}
		}
	}
	return sections;
}

/** Summarizes selected files by directories, extensions, and root folders. */
export function buildFilesystemSection(displayFiles: string[]): Row {
	const dirPaths = new Set(
		displayFiles.map((filePath) => {
			const dirname = path.dirname(filePath);
			return dirname === "." ? "." : dirname;
		}),
	);
	const fileTypes = new Map<string, number>();
	const rootHotspots = new Map<string, number>();
	for (const filePath of displayFiles) {
		const basename = path.basename(filePath);
		const ext = basename.includes(".")
			? (basename.split(".").at(-1) ?? "")
			: "no_ext";
		fileTypes.set(ext, (fileTypes.get(ext) ?? 0) + 1);
		const root = filePath.includes("/")
			? (filePath.split("/", 1)[0] ?? ".")
			: ".";
		rootHotspots.set(root, (rootHotspots.get(root) ?? 0) + 1);
	}
	return {
		dir_count: dirPaths.size,
		file_count: displayFiles.length,
		file_types: sortedCounterRows(fileTypes, "ext"),
		root_hotspots: sortedCounterRows(rootHotspots, "root"),
		files: displayFiles,
	};
}

/** Summarizes import, entrypoint, AGENTS, and reference relationship counts. */
export function buildRelationshipsSection(
	displayFiles: string[],
	scannedFiles: FileMetrics[],
	fileProfileRows: DenseFileRow[],
	entrypoints: Set<string>,
): Row {
	return {
		counts: {
			module_agents_files: displayFiles.filter((filePath) =>
				filePath.endsWith("AGENTS.md"),
			).length,
			typescript_import_edges: sumLengths(
				scannedFiles,
				"typescriptImportTargets",
			),
			typescript_relative_imports: sumLengths(
				scannedFiles,
				"typescriptLocalImportTargets",
			),
			typescript_reexport_edges: sumLengths(
				scannedFiles,
				"typescriptReexportTargets",
			),
			typescript_local_reexports: sumLengths(
				scannedFiles,
				"typescriptLocalReexportTargets",
			),
			typescript_extends_edges: sumLengths(
				scannedFiles,
				"typescriptExtendsBases",
			),
			python_import_edges: sumLengths(scannedFiles, "pyImportTargets"),
			python_relative_imports: sumLengths(scannedFiles, "pyLocalImportTargets"),
			python_inheritance_edges: sumLengths(scannedFiles, "pyBases"),
			entrypoint_like_files: entrypoints.size,
		},
		entrypoint_like_files: [...entrypoints].sort(),
		top_local_import_hubs: topHubs(fileProfileRows, { key: "imports_local" }),
		top_inheritance_hubs: topInheritanceHubs(fileProfileRows),
	};
}

/** Builds the empty docstring signal payload shape. */
export function buildEmptyDocstringSignals(): Row {
	return {
		files_considered: 0,
		python_files_considered: 0,
		typescript_files_considered: 0,
		file_docstrings: { present: 0, total: 0 },
		file_docstring_previews: [],
		likely_main_function_docstrings: [],
	};
}

/** Collects function spans for files matching a language suffix set. */
export function functionSpans(
	scannedFiles: FileMetrics[],
	suffixes: Set<string>,
): FunctionSpan[] {
	const spans: FunctionSpan[] = [];
	for (const metrics of scannedFiles) {
		if (suffixes.has(metrics.suffix)) {
			spans.push(...metrics.functionSpans);
		}
	}
	return spans;
}

/** Separates TypeScript and Python function-length hotspots. */
export function buildFunctionLengthsSection(scannedFiles: FileMetrics[]): Row {
	return {
		typescript: functionLengthSection(
			functionSpans(scannedFiles, TYPESCRIPT_SUFFIXES),
		),
		python: functionLengthSection(functionSpans(scannedFiles, PY_SUFFIXES)),
	};
}

/** Finds README-like files that explain signal focus entries. */
function signalFocusDocFilesFor(
	targetPath: string,
	displayRoot: string,
	signalFocusEntries: SignalFocusEntry[],
): string[] {
	if (isFile(targetPath) && DOCSTRING_SUFFIXES.has(path.extname(targetPath))) {
		return [relativePath(targetPath, { displayRoot })];
	}
	const docFiles: string[] = [];
	for (const entry of signalFocusEntries) {
		const filePath = String(entry.file);
		if (DOCSTRING_SUFFIXES.has(path.extname(filePath))) {
			docFiles.push(filePath);
		}
	}
	return docFiles;
}

/** Builds the compact docstring signal section for signal focus files. */
export function buildDocstringSignalSection(
	targetPath: string,
	signalFocusDocFiles: string[],
): Row {
	const signalFocus = signalFocusDocFiles.slice(0, 3);
	if (signalFocus.length === 0) {
		return buildEmptyDocstringSignals();
	}
	return buildDocstringSignals(targetPath, {
		focusFiles: signalFocus,
		maxFiles: 3,
		maxFunctions: 6,
	});
}

/** Builds docstring preview text keyed by signal focus files. */
export function docPreviewsByFile(
	targetPath: string,
	signalFocusDocFiles: string[],
): Row {
	if (signalFocusDocFiles.length === 0) {
		return {};
	}
	return Object.fromEntries(
		buildFilePreviews(targetPath, {
			focusFiles: signalFocusDocFiles,
			maxFiles: 0,
		}).map((item) => [item.file, item.preview]),
	);
}

/** Attaches short documentation previews to the signal payload. */
export function attachDocPreviews(
	signalFocusEntries: SignalFocusEntry[],
	previewsByFile: Row,
): void {
	for (const entry of signalFocusEntries) {
		const preview = previewsByFile[String(entry.file)];
		if (preview !== undefined) {
			entry.doc_preview = preview;
		}
	}
}

/** Builds metadata for a full signal export payload. */
export function signalExportMeta(
	targetPath: string,
	displayRoot: string,
	scannedFiles: FileMetrics[],
	sectionMode: string | string[],
	expanded: boolean,
): Row {
	return {
		section_mode: sectionMode,
		expanded,
		module_path: targetPath,
		module_target_kind: isDir(targetPath) ? "directory" : "file",
		module_display_root_path: displayRoot,
		module_abs: path.resolve(targetPath),
		analyzed_file_count: scannedFiles.length,
		notes: [],
	};
}

/** Builds the selected signal sections for a target path. */
export function buildSignalExport(
	targetPath: string,
	{
		sectionMode,
		expanded = false,
	}: { sectionMode: string | string[]; expanded?: boolean },
): Row {
	const displayRoot = isDir(targetPath) ? targetPath : path.dirname(targetPath);
	const allFiles = discoverFiles(targetPath);
	const displayFiles = allFiles.map((filePath) =>
		relativePath(filePath, { displayRoot }),
	);
	const scannedFiles = allFiles.map((filePath) =>
		scanFile(filePath, { displayRoot }),
	);
	const fileProfileRows = scannedFiles.map((metrics) =>
		fileProfileRow(metrics),
	);
	fileProfileRows.sort(
		(left, right) =>
			-Number(left.total ?? 0) - -Number(right.total ?? 0) ||
			compareText(String(left.file), String(right.file)),
	);
	const entrypoints = new Set(
		scannedFiles
			.filter((metrics) => metrics.entrypointHint)
			.map((metrics) => metrics.relPath),
	);
	const signalFocusEntries = buildSignalFocusEntries(fileProfileRows, {
		entrypoints,
	});
	const signalFocusDocFiles = signalFocusDocFilesFor(
		targetPath,
		displayRoot,
		signalFocusEntries,
	);
	const selected = selectedSections(sectionMode);
	const docstringSignals = selected.includes("docstring-signals")
		? buildDocstringSignalSection(targetPath, signalFocusDocFiles)
		: null;
	attachDocPreviews(
		signalFocusEntries,
		docPreviewsByFile(targetPath, signalFocusDocFiles),
	);

	const sections: Row = {};
	if (selected.includes("filesystem")) {
		sections.filesystem = buildFilesystemSection(displayFiles);
	}
	if (selected.includes("relationships")) {
		sections.relationships = buildRelationshipsSection(
			displayFiles,
			scannedFiles,
			fileProfileRows,
			entrypoints,
		);
	}
	if (selected.includes("docstring-signals")) {
		sections.docstring_signals = docstringSignals;
	}
	if (selected.includes("likely-main")) {
		sections.likely_main_entries = signalFocusEntries;
	}
	if (selected.includes("file-profiles")) {
		sections.file_profiles = fileProfileRows;
	}
	if (selected.includes("usage")) {
		sections.usage_signals = buildUsageSection(allFiles, scannedFiles);
	}
	if (selected.includes("function-lengths")) {
		sections.function_lengths = buildFunctionLengthsSection(scannedFiles);
	}
	if (selected.includes("docstrings")) {
		sections.docstrings = buildDocstringsData(targetPath);
	}
	return {
		meta: signalExportMeta(
			targetPath,
			displayRoot,
			scannedFiles,
			sectionMode,
			expanded,
		),
		sections,
	};
}

/** Builds sorted count rows from a counter map. */
function sortedCounterRows(counter: Map<string, number>, key: string): Row[] {
	return [...counter.entries()]
		.sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))
		.map(([value, count]) => ({ [key]: value, count }));
}

/** Totals line counts from rows that expose a numeric length field. */
function sumLengths(
	scannedFiles: FileMetrics[],
	key:
		| "typescriptImportTargets"
		| "typescriptLocalImportTargets"
		| "typescriptReexportTargets"
		| "typescriptLocalReexportTargets"
		| "typescriptExtendsBases"
		| "pyImportTargets"
		| "pyLocalImportTargets"
		| "pyBases",
): number {
	return scannedFiles.reduce(
		(total, metrics) => total + metrics[key].length,
		0,
	);
}

/** Checks whether a path exists and is a file. */
function isFile(filePath: string): boolean {
	return existsSync(filePath) && statSync(filePath).isFile();
}

/** Checks whether a path exists and is a directory. */
function isDir(filePath: string): boolean {
	return existsSync(filePath) && statSync(filePath).isDirectory();
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
