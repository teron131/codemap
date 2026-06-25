/** Builds focused target cards for likely path or symbol search hits. */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { runScan } from "../source/extraction/index.js";
import {
	currentTreeInspectGraph,
	normalizeTarget,
	renderInspection,
} from "../source/inspection/index.js";
import type { SourceMatch } from "./source.js";

export const AUTO_TARGET_CARD_FILE_LIMIT = 5_000;

/** Builds a focused target card when search text names a known target. */
export function searchTargetCard(
	root: string,
	searchText: string,
	matches: SourceMatch[],
	{ limit }: { limit: number },
): string | null {
	const target = inferredSearchTarget(root, searchText, matches);
	if (target === null) {
		return null;
	}
	const scan = runScan(root);
	const fileCount = scan.files.length;
	if (fileCount > AUTO_TARGET_CARD_FILE_LIMIT) {
		const command = `codemap inspect --project-root ${shQuote(root)} ${shQuote(target)}`;
		return `Focused target skipped: ${fileCount} files\nRun: ${command}`;
	}
	const [graph, metrics] = currentTreeInspectGraph(root, target);
	const inspection = renderInspection(root, graph, metrics, target, { limit });
	if (inspection === null) {
		return null;
	}
	return `Focused target:\n${inspection}`;
}

/** Infers whether search text names a path or symbol target. */
export function inferredSearchTarget(
	root: string,
	searchText: string,
	matches: SourceMatch[],
): string | null {
	const pathTarget = inferredPathTarget(root, searchText, matches);
	if (pathTarget !== null) {
		return pathTarget;
	}
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(searchText)) {
		return null;
	}
	const structuralMatches = matches.filter(
		(item) => item.engine === "ast-grep",
	);
	if (structuralMatches.length === 0 || structuralMatches.length > 3) {
		return null;
	}
	return searchText;
}

/** Infers a target-card path from search text and matches. */
export function inferredPathTarget(
	root: string,
	searchText: string,
	matches: SourceMatch[],
): string | null {
	const normalized = normalizeTarget(root, searchText);
	const candidate = path.join(root, normalized);
	if (isFile(candidate)) {
		return normalized;
	}
	const basenameMatches = new Set(
		matches
			.filter(
				(item) =>
					item.filePath === normalized ||
					path.basename(item.filePath) === searchText,
			)
			.map((item) => item.filePath),
	);
	if (basenameMatches.size === 1) {
		return [...basenameMatches][0] ?? null;
	}
	return null;
}

/** Checks whether a path exists and is a file. */
function isFile(filePath: string): boolean {
	try {
		return existsSync(filePath) && statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/** Quotes a path or argument for display in shell commands. */
function shQuote(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
