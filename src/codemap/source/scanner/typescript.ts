/** Scans TypeScript-family source with ast-grep for imports and definitions. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Lang, parse, type SgNode } from "@ast-grep/napi";

import {
	ENTRYPOINT_BASENAMES,
	TYPESCRIPT_LANG_BY_SUFFIX,
} from "./constants.js";
import {
	addSample,
	addVariableSignal,
	codeSignalIdentifier,
	createFileMetrics,
	type FileMetrics,
	sourceLineCount,
} from "./metrics.js";

/** Walks ast-grep syntax nodes depth-first. */
export function walkSg(node: SgNode): SgNode[] {
	const nodes = [node];
	for (const child of node.children()) {
		nodes.push(...walkSg(child));
	}
	return nodes;
}

/** Finds a direct ast-grep child node by kind. */
export function directChild(node: SgNode, ...kinds: string[]): SgNode | null {
	return (
		node.children().find((child) => kinds.includes(String(child.kind()))) ??
		null
	);
}

/** Finds a descendant ast-grep node by kind. */
export function descendant(
	node: SgNode | null,
	...kinds: string[]
): SgNode | null {
	if (node === null) {
		return null;
	}
	for (const child of node.children()) {
		if (kinds.includes(String(child.kind()))) {
			return child;
		}
		const nested = descendant(child, ...kinds);
		if (nested !== null) {
			return nested;
		}
	}
	return null;
}

/** Reads string text from an ast-grep node. */
export function stringValue(node: SgNode | null): string {
	if (node === null) {
		return "";
	}
	const text = node.text();
	if (
		text.length >= 2 &&
		["'", '"', "`"].includes(text[0] ?? "") &&
		text.at(-1) === text[0]
	) {
		return text.slice(1, -1);
	}
	const fragment = descendant(node, "string_fragment");
	return fragment?.text() ?? text;
}

/** Builds a function span from an ast-grep node range. */
export function spanFor(node: SgNode): number {
	const nodeRange = node.range();
	return Math.max(1, nodeRange.end.line - nodeRange.start.line + 1);
}

/** Finds the one-based start line for an ast-grep node. */
export function startLineFor(node: SgNode): number {
	return node.range().start.line + 1;
}

/** Records TypeScript import specifiers on file metrics. */
export function addTypescriptImport(
	metrics: FileMetrics,
	target: string,
): void {
	if (!target) {
		return;
	}
	metrics.typescriptImportTargets.push(target);
	if (target.startsWith("./") || target.startsWith("../")) {
		metrics.typescriptLocalImportTargets.push(target);
		metrics.importsLocal += 1;
		addSample(metrics.samples, target);
	}
}

/** Records TypeScript re-export specifiers on file metrics. */
export function addTypescriptReexport(
	metrics: FileMetrics,
	target: string,
): void {
	if (!target) {
		return;
	}
	metrics.typescriptReexportTargets.push(target);
	if (target.startsWith("./") || target.startsWith("../")) {
		metrics.typescriptLocalReexportTargets.push(target);
		metrics.reexportsLocal += 1;
		addSample(metrics.samples, target);
	}
}

/** Records a TypeScript exported symbol on file metrics. */
export function addExportedName(metrics: FileMetrics, name: string): void {
	if (name && !metrics.exportedNames.includes(name)) {
		metrics.exportedNames.push(name);
	}
}

/** Records a TypeScript function-like definition span on file metrics. */
export function addTypescriptFunction(
	metrics: FileMetrics,
	relPath: string,
	name: string,
	node: SgNode,
): void {
	if (!name) {
		return;
	}
	metrics.functionNames.push(name);
	metrics.functionSpans.push({
		name,
		identifier: codeSignalIdentifier(relPath, name),
		span: spanFor(node),
		startLine: startLineFor(node),
	});
	metrics.defines += 1;
	addSample(metrics.samples, name);
}

/** Checks whether a TypeScript declaration is module-level state. */
export function isTypescriptModuleLevelVariable(node: SgNode): boolean {
	const ancestors = node.ancestors().map((ancestor) => ancestor.kind());
	return (
		ancestors.includes("program") && !ancestors.includes("statement_block")
	);
}

/** Collects TypeScript exported names from export syntax nodes. */
export function collectTypescriptExportNames(
	metrics: FileMetrics,
	node: SgNode,
): void {
	for (const child of node.children()) {
		const kind = child.kind();
		if (kind === "function_declaration") {
			const name = directChild(child, "identifier");
			if (name !== null) {
				addExportedName(metrics, name.text());
			}
		} else if (kind === "class_declaration") {
			const name = directChild(child, "type_identifier", "identifier");
			if (name !== null) {
				addExportedName(metrics, name.text());
			}
		} else if (
			kind === "lexical_declaration" ||
			kind === "variable_declaration"
		) {
			for (const descendantNode of walkSg(child)) {
				if (descendantNode.kind() === "variable_declarator") {
					const name = directChild(descendantNode, "identifier");
					if (name !== null) {
						addExportedName(metrics, name.text());
					}
				}
			}
		} else if (kind === "export_clause") {
			for (const descendantNode of walkSg(child)) {
				if (descendantNode.kind() === "export_specifier") {
					const name = directChild(descendantNode, "identifier");
					if (name !== null) {
						addExportedName(metrics, name.text());
					}
				}
			}
		}
	}
}

/** Scans TypeScript-family source with ast-grep syntax nodes. */
export function scanTypescriptWithAstGrep({
	source,
	filePath,
	relPath,
	metrics,
}: {
	source: string;
	filePath: string;
	relPath: string;
	metrics: FileMetrics;
}): boolean {
	let root: SgNode;
	try {
		root = parse(
			astGrepLanguageForSuffix(path.extname(filePath)),
			source,
		).root();
	} catch {
		return false;
	}

	for (const node of walkSg(root)) {
		const kind = node.kind();
		if (kind === "import_statement") {
			addTypescriptImport(metrics, stringValue(directChild(node, "string")));
		} else if (kind === "call_expression") {
			const callee = directChild(node, "identifier");
			if (callee !== null && callee.text() === "require") {
				addTypescriptImport(metrics, stringValue(descendant(node, "string")));
			}
		} else if (kind === "export_statement") {
			metrics.exports += 1;
			addTypescriptReexport(metrics, stringValue(directChild(node, "string")));
			collectTypescriptExportNames(metrics, node);
		} else if (kind === "class_declaration") {
			const name = directChild(node, "type_identifier", "identifier");
			if (name !== null) {
				metrics.defines += 1;
				addSample(metrics.samples, name.text());
			}
			const heritage = directChild(node, "class_heritage");
			const base =
				heritage === null
					? null
					: descendant(heritage, "identifier", "type_identifier");
			if (base !== null) {
				metrics.extends += 1;
				metrics.typescriptExtendsBases.push(base.text());
				addSample(metrics.samples, base.text());
			}
		} else if (kind === "function_declaration") {
			const name = directChild(node, "identifier");
			if (name !== null) {
				addTypescriptFunction(metrics, relPath, name.text(), node);
			}
		} else if (kind === "variable_declarator") {
			const name = directChild(node, "identifier");
			if (name !== null) {
				metrics.variableNames.push(name.text());
				addVariableSignal(metrics, relPath, name.text(), {
					startLine: startLineFor(node),
					moduleLevel: isTypescriptModuleLevelVariable(node),
				});
				const initializer =
					node
						.children()
						.find(
							(child) =>
								child.kind() === "arrow_function" ||
								child.kind() === "function_expression",
						) ?? null;
				if (initializer !== null) {
					addTypescriptFunction(metrics, relPath, name.text(), initializer);
				}
			}
		} else if (kind === "jsx_element") {
			metrics.jsxComponents += 1;
		}
	}
	return true;
}

/** Scans one TypeScript-family file into source metrics. */
export function scanTypescriptFile(
	filePath: string,
	{ relPath }: { relPath: string },
): FileMetrics {
	const metrics = createFileMetrics({
		path: filePath,
		relPath,
		suffix: path.extname(filePath),
	});
	let source: string;
	try {
		source = readFileSync(filePath, "utf8");
	} catch {
		return metrics;
	}

	metrics.lines = sourceLineCount(source);
	metrics.entrypointHint =
		ENTRYPOINT_BASENAMES.has(path.basename(filePath)) ||
		source.includes("require.main === module");
	scanTypescriptWithAstGrep({ source, filePath, relPath, metrics });
	return metrics;
}

/** Maps TypeScript-family file suffixes to ast-grep languages. */
function astGrepLanguageForSuffix(suffix: string): Lang | string {
	const language = TYPESCRIPT_LANG_BY_SUFFIX[suffix];
	if (language === "javascript") {
		return Lang.JavaScript;
	}
	if (language === "typescript") {
		return Lang.TypeScript;
	}
	if (language === "tsx") {
		return Lang.Tsx;
	}
	return language ?? Lang.TypeScript;
}
