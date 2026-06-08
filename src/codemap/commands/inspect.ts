/** Defines CLI behavior for focused source inspection targets. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";

import { DETAILED_ANALYSIS_FILE_LIMIT, resolveProjectRoot } from "../common.js";
import { runScan, type ScanEntry } from "../source/extraction/index.js";
import {
	currentTreeInspectGraph,
	renderInspection,
} from "../source/inspection/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type InspectOptions = {
	projectRoot?: string;
	limit?: string | number;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers the inspect command and its output options. */
export function addInspectParser(program: Command): void {
	const inspect = program
		.command("inspect")
		.description(
			"Inspect one known file, function, class, variable, or symbol target.",
		)
		.argument("<target>")
		.option(
			"--limit <count>",
			"Maximum rows per section.",
			parseIntegerOption,
			8,
		)
		.action((target: string, options: InspectOptions) => {
			const exitCode = commandInspect(
				target,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(inspect);
}

/** Runs focused inspection for a path, symbol, or directory target. */
export function commandInspect(
	target: string,
	options: InspectOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const limit = inspectLimit(options.limit);
	if (isDirectoryTarget(root, target)) {
		const scan = runScan(root, { persist: false });
		if (scan.files.length > DETAILED_ANALYSIS_FILE_LIMIT) {
			console.log(
				lightweightDirectoryInspection(root, target, scan.files, { limit }),
			);
			return 0;
		}
	}
	const [graph, metrics] = currentTreeInspectGraph(root, target);
	const inspection = renderInspection(root, graph, metrics, target, {
		limit,
	});
	if (inspection === null) {
		console.log(`No match: ${target}`);
		console.log(
			`Run: codemap search --project-root ${root} ${pythonRepr(target)}`,
		);
		return 1;
	}
	console.log(inspection);
	return 0;
}

/** Checks whether an inspect target names a directory. */
function isDirectoryTarget(root: string, target: string): boolean {
	const targetPath = path.resolve(root, target);
	try {
		return existsSync(targetPath) && statSync(targetPath).isDirectory();
	} catch {
		return false;
	}
}

/** Renders directory inspection from scan data when graph artifacts are absent. */
function lightweightDirectoryInspection(
	root: string,
	target: string,
	files: ScanEntry[],
	{ limit }: { limit: number },
): string {
	const relTarget = directoryRelTarget(root, target);
	const rows =
		relTarget === "."
			? files
			: files.filter((entry) => entry.path.startsWith(`${relTarget}/`));
	const title = relTarget === "." ? "." : relTarget.replace(/\/+$/, "");
	const lines = [
		`# ${title}/`,
		"",
		`Directory profile: ${rows.length} scanned files.`,
		`Fallback: detailed graph skipped above ${DETAILED_ANALYSIS_FILE_LIMIT} files.`,
	];
	const denseRows = rows
		.slice()
		.sort(
			(left, right) =>
				-Number(left.sizeLines ?? 0) - -Number(right.sizeLines ?? 0) ||
				compareText(left.path, right.path),
		)
		.slice(0, limit);
	if (denseRows.length > 0) {
		lines.push("");
		lines.push("## Largest Files");
		for (const item of denseRows) {
			lines.push(
				`- ${item.path}: ${item.sizeLines} lines, ${item.language}, ${item.fileCategory}`,
			);
		}
	}
	return lines.join("\n").trim();
}

/** Formats a directory target relative to the display root. */
function directoryRelTarget(root: string, target: string): string {
	const resolved = path.resolve(root, target);
	const relative = path.relative(root, resolved).split(path.sep).join("/");
	return relative || ".";
}

/** Parses the inspect output limit option. */
function inspectLimit(value: string | number | undefined): number {
	if (value === undefined) {
		return 8;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? 8 : parsed;
}

/** Formats values using Python-style repr for CLI compatibility. */
function pythonRepr(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
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
