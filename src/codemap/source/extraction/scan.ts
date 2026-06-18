/** Scans project files into language, category, and path inventory rows. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	GENERATED_PREFIXES,
	intermediateDir,
	writeJson,
} from "../../common.js";
import { discoverFiles, relativePath } from "../scanner/index.js";

export type ScanEntry = {
	path: string;
	language: string;
	fileCategory: string;
	sizeLines: number;
};

export type ScanPayload = {
	files: ScanEntry[];
	filteredByTool: number;
	stats: {
		filesScanned: number;
		byCategory: Record<string, number>;
		byLanguage: Record<string, number>;
	};
};

export const LANGUAGE_BY_SUFFIX: Record<string, string> = {
	".c": "c",
	".cc": "cpp",
	".cjs": "javascript",
	".conf": "config",
	".cpp": "cpp",
	".css": "css",
	".eex": "eex",
	".erl": "erlang",
	".ex": "elixir",
	".exs": "elixir",
	".go": "go",
	".graphql": "graphql",
	".h": "c-header",
	".heex": "heex",
	".hpp": "cpp-header",
	".hrl": "erlang-header",
	".html": "html",
	".java": "java",
	".js": "javascript",
	".jsx": "jsx",
	".json": "json",
	".jsonc": "jsonc",
	".livemd": "markdown",
	".md": "markdown",
	".mjs": "javascript",
	".mmd": "mermaid",
	".prisma": "prisma",
	".proto": "protobuf",
	".py": "python",
	".rs": "rust",
	".rules": "rules",
	".sh": "shell",
	".sql": "sql",
	".toml": "toml",
	".ts": "typescript",
	".tsx": "tsx",
	".yaml": "yaml",
	".yml": "yaml",
};

export const CONFIG_BASENAMES = new Set([
	".env",
	".gitignore",
	"Cargo.toml",
	"Dockerfile",
	"go.mod",
	"package.json",
	"pnpm-lock.yaml",
	"pyproject.toml",
	"ruff.toml",
	"tsconfig.json",
	"uv.lock",
]);

/** Scans project files into inventory rows and optional persisted output. */
export function runScan(
	root: string,
	{ persist = false }: { persist?: boolean } = {},
): ScanPayload {
	const files = discoverFiles(root).map((filePath) =>
		scanEntry(root, filePath),
	);
	const scan = filterScan({ files });
	if (persist) {
		writeJson(path.join(intermediateDir(root), "scan.json"), scan);
	}
	return scan;
}

/** Builds one scan inventory entry from a project-relative path. */
export function scanEntry(root: string, filePath: string): ScanEntry {
	const relPath = relativePath(filePath, { displayRoot: root });
	const suffix = path.extname(filePath);
	return {
		path: relPath,
		language:
			LANGUAGE_BY_SUFFIX[suffix] ?? (suffix.replace(/^\./, "") || "unknown"),
		fileCategory: categoryForPath(relPath),
		sizeLines: countLines(filePath),
	};
}

/** Counts newline-delimited lines in source text. */
export function countLines(filePath: string): number {
	let text: string;
	try {
		text = readFileSync(filePath, "utf8");
	} catch {
		return 0;
	}
	if (!text) {
		return 0;
	}
	return text.split("\n").length - 1 + (text.endsWith("\n") ? 0 : 1);
}

/** Classifies a project path as code, docs, config, or data. */
export function categoryForPath(relPath: string): string {
	const lowerPath = relPath.toLowerCase();
	const name = path.basename(relPath);
	if (
		lowerPath.endsWith(".md") ||
		lowerPath.endsWith(".rst") ||
		lowerPath.endsWith(".txt")
	) {
		return "docs";
	}
	if (
		CONFIG_BASENAMES.has(name) ||
		lowerPath.endsWith(".json") ||
		lowerPath.endsWith(".toml") ||
		lowerPath.endsWith(".yaml") ||
		lowerPath.endsWith(".yml")
	) {
		return "config";
	}
	if (
		lowerPath.startsWith(".github/") ||
		lowerPath.startsWith("deploy/") ||
		lowerPath.startsWith("infra/") ||
		lowerPath.startsWith("infrastructure/") ||
		name === "Dockerfile" ||
		name === "docker-compose.yml"
	) {
		return "infra";
	}
	if (
		lowerPath.endsWith(".csv") ||
		lowerPath.endsWith(".db") ||
		lowerPath.endsWith(".parquet") ||
		lowerPath.endsWith(".proto") ||
		lowerPath.endsWith(".graphql") ||
		lowerPath.endsWith(".prisma") ||
		lowerPath.endsWith(".sql")
	) {
		return "data";
	}
	return "code";
}

/** Filters scan payload files to a selected path subset. */
export function filterScan(scan: { files?: ScanEntry[] }): ScanPayload {
	const originalFiles = scan.files ?? [];
	const files = originalFiles.filter(
		(entry) => !String(entry.path ?? "").startsWith(GENERATED_PREFIXES),
	);
	const byCategory = countBy(files, (entry) =>
		String(entry.fileCategory ?? "unknown"),
	);
	const byLanguage = countBy(files, (entry) =>
		String(entry.language ?? "unknown"),
	);
	return {
		files,
		filteredByTool: originalFiles.length - files.length,
		stats: {
			filesScanned: files.length,
			byCategory,
			byLanguage,
		},
	};
}

/** Counts rows by a derived key. */
function countBy<T>(
	items: T[],
	keyFor: (item: T) => string,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const key = keyFor(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

/** Checks whether a scan payload has been written for a project. */
export function scanExists(filePath: string): boolean {
	return existsSync(filePath);
}
