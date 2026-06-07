/** Builds stable file fingerprints for artifact refresh decisions. */
import path from "node:path";

import {
	fileHash,
	GRAPH_VERSION,
	gitCommit,
	sha256Text,
	utcNow,
} from "../common.js";
import {
	type ArtifactFingerprints,
	FINGERPRINT_STRUCTURE_KEYS,
	type FileFingerprint,
} from "./schema.js";

/** Builds content and structure hashes for one scanned file. */
export function buildFileFingerprint(
	relPath: string,
	root: string,
	structure: Record<string, unknown> | null | undefined,
	imports: string[],
): FileFingerprint {
	const payload: FileFingerprint = {
		filePath: relPath,
		contentHash: fileHash(path.join(root, relPath)),
		imports: imports.slice().sort(compareText),
	};
	if (structure) {
		for (const key of FINGERPRINT_STRUCTURE_KEYS) {
			const value = structure[key];
			if (truthyPython(value)) {
				(payload as Record<string, unknown>)[key] = value;
			}
		}
	}
	const stable = Object.fromEntries(
		Object.entries(payload).filter(([key]) => key !== "contentHash"),
	);
	payload.structureHash = sha256Text(pythonJsonDumps(sortJsonKeys(stable)));
	return payload;
}

/** Builds artifact fingerprints for all scanned files. */
export function buildFingerprints(
	root: string,
	scan: Record<string, unknown>,
	structure: Record<string, unknown>,
	importMap: Record<string, string[] | undefined>,
): ArtifactFingerprints {
	const structureByPath = Object.fromEntries(
		arrayRows(structure.results).map((structureEntry) => [
			String(structureEntry.path),
			structureEntry,
		]),
	);
	const files: Record<string, FileFingerprint> = {};
	for (const scanEntry of arrayRows(scan.files)) {
		const relPath = String(scanEntry.path);
		try {
			files[relPath] = buildFileFingerprint(
				relPath,
				root,
				structureByPath[relPath],
				importMap[relPath] ?? [],
			);
		} catch {}
	}
	return {
		version: GRAPH_VERSION,
		generatedAt: utcNow(),
		gitCommitHash: gitCommit(root),
		files,
	};
}

/** Reads an array of record rows from JSON-like payload data. */
function arrayRows(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/** Formats a boolean value using Python spelling. */
function truthyPython(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	return Boolean(value);
}

/** Recursively sorts object keys for stable JSON output. */
function sortJsonKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJsonKeys(item));
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value as Record<string, unknown>)
				.sort(compareText)
				.map((key) => [
					key,
					sortJsonKeys((value as Record<string, unknown>)[key]),
				]),
		);
	}
	return value;
}

/** Formats fingerprint payloads as Python literals for inline examples. */
function pythonJsonDumps(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => pythonJsonDumps(item)).join(", ")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.map(([key, item]) => `${JSON.stringify(key)}: ${pythonJsonDumps(item)}`)
			.join(", ")}}`;
	}
	return JSON.stringify(value);
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
