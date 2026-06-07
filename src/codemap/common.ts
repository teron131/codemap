/** Provides shared path, JSON, hashing, and project-root helpers. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.dirname(moduleDir);
export const GRAPH_DIR_NAME = ".context-graph";
export const GRAPH_VERSION = "0.2.0";
export const GENERATED_PREFIXES = ".context-graph/";
export const REFRESH_SAMPLE_LIMIT = 8;
export const DETAILED_ANALYSIS_FILE_LIMIT = 5_000;

/** Returns an ISO UTC timestamp in the artifact metadata format. */
export function utcNow(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Reads and parses a JSON file from disk. */
export function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Writes stable JSON to disk with sorted object keys. */
export function writeJson(filePath: string, payload: unknown): void {
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(
		`${filePath}`,
		`${JSON.stringify(sortJsonKeys(payload), null, 2)}\n`,
		"utf8",
	);
}

/** Hashes text with SHA-256 for artifact fingerprints. */
export function sha256Text(text: string): string {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Hashes file content for freshness tracking. */
export function fileHash(filePath: string): string {
	const digest = createHash("sha256");
	const handle = openSync(filePath, "r");
	const buffer = Buffer.alloc(1024 * 1024);

	try {
		let bytesRead = 0;
		do {
			bytesRead = readSync(handle, buffer, 0, buffer.length, null);
			if (bytesRead > 0) {
				digest.update(buffer.subarray(0, bytesRead));
			}
		} while (bytesRead > 0);
	} finally {
		closeSync(handle);
	}

	return digest.digest("hex");
}

/** Resolves and validates the project root path. */
export function resolveProjectRoot(raw: string | null | undefined): string {
	let root = expandUser(raw ?? ".");
	if (!path.isAbsolute(root)) {
		root = path.resolve(process.cwd(), root);
	}
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`Project root is not a directory: ${root}`);
	}
	return root;
}

/** Locates the hidden codemap artifact directory under a project root. */
export function graphDir(root: string): string {
	return path.join(root, GRAPH_DIR_NAME);
}

/** Locates the canonical graph artifact directory under a project root. */
export function canonicalDir(root: string): string {
	return path.join(graphDir(root), "canonical");
}

/** Builds the saved artifact views directory path. */
export function viewsDir(root: string): string {
	return path.join(graphDir(root), "views");
}

/** Locates persisted semantic search artifacts under a project root. */
export function semanticDir(root: string): string {
	return path.join(graphDir(root), "semantic");
}

/** Locates intermediate analysis artifacts under a project root. */
export function intermediateDir(root: string): string {
	return path.join(graphDir(root), "intermediate");
}

/** Builds the canonical graph artifact path. */
export function graphPath(root: string): string {
	return path.join(canonicalDir(root), "graph.json");
}

/** Builds the canonical file-fingerprint artifact path. */
export function fingerprintsPath(root: string): string {
	return path.join(canonicalDir(root), "fingerprints.json");
}

/** Builds the persisted semantic vector index artifact path. */
export function semanticIndexPath(root: string): string {
	return path.join(semanticDir(root), "index.json");
}

/** Reads the current git commit for artifact metadata. */
export function gitCommit(root: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	});

	return result.status === 0 ? result.stdout.trim() : "unknown";
}

/** Expands tilde-prefixed filesystem paths. */
function expandUser(raw: string): string {
	if (raw === "~") {
		return homedir();
	}
	if (raw.startsWith("~/")) {
		return path.join(homedir(), raw.slice(2));
	}
	return raw;
}

/** Recursively sorts object keys for stable JSON output. */
function sortJsonKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJsonKeys(item));
	}
	if (isPlainObject(value)) {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortJsonKeys(value[key])]),
		);
	}
	return value;
}

/** Checks whether a value is a non-array object record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}
