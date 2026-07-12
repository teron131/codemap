/** Resolves Python import statements to project-relative source paths. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { relativePath } from "../scanner/index.js";

type PythonModuleIndex = Map<string, string[]>;

type PythonImportStatement =
	| { kind: "import"; names: string[] }
	| { kind: "from"; level: number; module: string; names: string[] };

/** Reads Python source text when the file can be parsed for imports. */
export function parsePythonTree(filePath: string): string | null {
	try {
		return readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}

/** Resolves imports in one Python file against the project module index. */
export function pythonImportTargets(
	filePath: string,
	root: string,
	filePaths: Set<string>,
	moduleIndex: PythonModuleIndex,
	{ tree = null }: { tree?: string | null } = {},
): string[] {
	const source = tree ?? parsePythonTree(filePath);
	if (source === null) {
		return [];
	}
	const targets = new Set<string>();
	const relPath = relativePath(filePath, { displayRoot: root });
	const packageParts = path.posix.dirname(toPosixPath(relPath)).split("/");
	for (const statement of pythonImportStatements(source)) {
		if (statement.kind === "import") {
			for (const name of statement.names) {
				for (const target of targetsForModule(name.split("."))) {
					targets.add(target);
				}
			}
			continue;
		}
		const moduleParts = statement.module ? statement.module.split(".") : [];
		const baseParts =
			statement.level > 0
				? packageParts
						.slice(0, Math.max(0, packageParts.length - statement.level + 1))
						.filter((part) => part && part !== ".")
				: [];
		const baseModuleParts = [...baseParts, ...moduleParts.filter(Boolean)];
		const moduleTargets = targetsForModule(baseModuleParts);
		const importedFromTargets: string[] = [];
		for (const name of statement.names) {
			if (name === "*") {
				continue;
			}
			importedFromTargets.push(...targetsForModule([...baseModuleParts, name]));
		}
		const chosenTargets =
			importedFromTargets.length === 0 ? moduleTargets : importedFromTargets;
		for (const target of chosenTargets) {
			targets.add(target);
		}
	}
	return [...targets].sort();

	/** Resolves a dotted Python module reference to candidate files. */
	function targetsForModule(parts: string[]): string[] {
		return resolvePythonModule(parts.filter(Boolean), filePaths, moduleIndex);
	}
}

/** Builds a dotted-module lookup for Python package files. */
export function pythonModuleIndex(filePaths: Set<string>): PythonModuleIndex {
	const initDirs = new Set(
		[...filePaths]
			.filter((filePath) => path.posix.basename(filePath) === "__init__.py")
			.map((filePath) => path.posix.dirname(toPosixPath(filePath))),
	);
	const topPackageDirs = [...initDirs]
		.filter((dirPath) => !initDirs.has(path.posix.dirname(dirPath)))
		.sort();
	const modules: PythonModuleIndex = new Map();
	for (const relPath of [...filePaths]
		.filter((filePath) => filePath.endsWith(".py"))
		.sort()) {
		for (const packageDir of topPackageDirs) {
			if (
				relPath !== `${packageDir}/__init__.py` &&
				!relPath.startsWith(`${packageDir}/`)
			) {
				continue;
			}
			const packageName = path.posix.basename(packageDir);
			const inner = stripSuffix(
				path.posix.relative(packageDir, toPosixPath(relPath)),
				".py",
			).split("/");
			let moduleParts = [packageName, ...inner];
			if (moduleParts.at(-1) === "__init__") {
				moduleParts = moduleParts.slice(0, -1);
			}
			if (moduleParts.length > 0) {
				const key = moduleKey(moduleParts);
				modules.set(key, [...(modules.get(key) ?? []), relPath]);
			}
			break;
		}
	}
	return modules;
}

/** Resolves Python module parts to source files in the project. */
export function resolvePythonModule(
	parts: string[],
	filePaths: Set<string>,
	moduleIndex: PythonModuleIndex,
): string[] {
	if (parts.length === 0) {
		return [];
	}
	const modulePath = parts.join("/");
	const candidates = [`${modulePath}.py`, `${modulePath}/__init__.py`];
	const exactMatches = candidates.filter((candidate) =>
		filePaths.has(candidate),
	);
	if (exactMatches.length > 0) {
		return exactMatches;
	}
	return moduleIndex.get(moduleKey(parts)) ?? [];
}

/** Parses simple Python import and from-import statements. */
function pythonImportStatements(source: string): PythonImportStatement[] {
	const statements: PythonImportStatement[] = [];
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		const importMatch = /^import\s+(.+)$/.exec(line);
		if (importMatch) {
			statements.push({
				kind: "import",
				names: splitImportNames(importMatch[1] ?? ""),
			});
			continue;
		}
		const fromMatch = /^from\s+([.\w]+)\s+import\s+(.+)$/.exec(line);
		if (fromMatch) {
			const rawModule = fromMatch[1] ?? "";
			const level = rawModule.match(/^\.+/)?.[0].length ?? 0;
			statements.push({
				kind: "from",
				level,
				module: rawModule.slice(level),
				names: splitImportNames(fromMatch[2] ?? ""),
			});
		}
	}
	return statements;
}

/** Splits comma-separated imported names and drops aliases. */
function splitImportNames(rawNames: string): string[] {
	return rawNames
		.split(",")
		.map(
			(name) =>
				name
					.trim()
					.split(/\s+as\s+/)[0]
					?.trim() ?? "",
		)
		.filter(Boolean);
}

/** Encodes dotted Python module parts for lookup-map keys. */
function moduleKey(parts: string[]): string {
	return parts.join("\0");
}

/** Removes a matched Python path suffix while resolving modules. */
function stripSuffix(value: string, suffix: string): string {
	return suffix && value.endsWith(suffix)
		? value.slice(0, -suffix.length)
		: value;
}

/** Normalizes Python module paths to slash-separated project keys. */
function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}
