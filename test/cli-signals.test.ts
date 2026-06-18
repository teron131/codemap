/** Checks signals CLI JSON output on a small fixture project. */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderSignalText } from "../src/codemap/source/signals/index.js";
import { buildLightweightSignalPayload } from "../src/codemap/source/signals/lightweight.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`cli-signals-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

describe("signals CLI", () => {
	it("filters tests, bundles, and non-source files in lightweight signal rows", () => {
		const payload = buildLightweightSignalPayload(
			[
				scanEntry("src/app.ts", "typescript", 30),
				scanEntry("src/app.test.ts", "typescript", 500),
				scanEntry("libs/standard-tests/chat_models.py", "python", 700),
				scanEntry(
					"libs/langchain-core/src/load/import_map.ts",
					"typescript",
					1000,
				),
				scanEntry("src/a2ui.bundle.js", "javascript", 900),
				scanEntry("src/styles.css", "css", 800),
				scanEntry("src/worker.py", "python", 40),
			],
			{ includeTests: false },
		);

		expect(fileRows(payload)).toEqual(["src/worker.py", "src/app.ts"]);
		expect(firstDenseRow(payload).total_label).toBe("lines");
		expect(renderSignalText(payload, "top")).toContain(
			"line-ranked rows use lightweight fallback for ranking; top rows include bounded syntax details when available, and inspect gives the full local profile.",
		);

		const withTests = buildLightweightSignalPayload(
			[
				scanEntry("src/app.ts", "typescript", 30),
				scanEntry("src/app.test.ts", "typescript", 500),
			],
			{ includeTests: true },
		);

		expect(fileRows(withTests)).toEqual(["src/app.test.ts", "src/app.ts"]);
	});

	it("enriches top lightweight rows with bounded syntax details", () => {
		writeFileSync(
			path.join(workDir, "src", "large.ts"),
			[
				"import { helper } from './small';",
				"",
				"export function runLarge() {",
				"  return helper();",
				"}",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "small.ts"),
			"export function helper() { return 'ok'; }\n",
			"utf8",
		);

		const payload = buildLightweightSignalPayload(
			[
				scanEntry("src/large.ts", "typescript", 500),
				scanEntry("src/small.ts", "typescript", 20),
			],
			{ root: workDir },
		);
		const first = firstDenseRow(payload);

		expect(first).toMatchObject({
			file: "src/large.ts",
			total: 500,
			total_label: "lines",
			lines: 500,
			defines: 1,
			imports_local: 1,
			exports: 1,
		});
		expect(first.samples).toEqual(expect.arrayContaining(["runLarge"]));
	});

	it("prints selected signal payload JSON", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"/** App docs. */",
				"export function run(value: string) {",
				"  return helper(value);",
				"}",
				"function helper(value: string) {",
				"  return value;",
				"}",
			].join("\n"),
			"utf8",
		);
		mkdirSync(path.join(workDir, "src", "load"), { recursive: true });
		writeFileSync(
			path.join(workDir, "src", "load", "import_map.ts"),
			[
				"export const importMap = {",
				"  alpha: () => import('../app'),",
				"};",
			].join("\n"),
			"utf8",
		);

		const result = spawnSync(
			"pnpm",
			[
				"exec",
				"tsx",
				"src/codemap/cli.ts",
				"signals",
				"--project-root",
				workDir,
				"--json",
				"files",
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			files: [
				{
					file: "src/app.ts",
					total: 3,
					lines: 7,
					defines: 2,
					imports_local: 0,
					exports: 1,
					reexports_local: 0,
					extends: 0,
					inherits: 0,
					jsx_components: 0,
					decorators: 0,
					samples: ["run", "helper"],
				},
			],
		});
	});

	it("keeps the aggregate top signal payload small", () => {
		const functionBlocks = Array.from({ length: 24 }, (_, idx) =>
			[
				`export function candidate${idx}(value: string) {`,
				"  const next = value.trim();",
				"  return next;",
				"}",
			].join("\n"),
		).join("\n\n");
		writeFileSync(path.join(workDir, "src", "app.ts"), functionBlocks, "utf8");
		mkdirSync(path.join(workDir, "src", "load"), { recursive: true });
		writeFileSync(
			path.join(workDir, "src", "load", "import_map.ts"),
			[
				"export const importMap = {",
				"  alpha: () => import('../app'),",
				"};",
			].join("\n"),
			"utf8",
		);

		const result = spawnSync(
			"pnpm",
			[
				"exec",
				"tsx",
				"src/codemap/cli.ts",
				"signals",
				"--project-root",
				workDir,
				"--json",
				"top",
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload.top.functions.longFunctions).toHaveLength(20);
		expect(payload.top.functions.lowUseDefinitions.length).toBeLessThanOrEqual(
			20,
		);
		expect(
			payload.top.variables.leastUsedDefinitions.length,
		).toBeLessThanOrEqual(20);
		expect(payload.top.variables.broadNamePools.length).toBeLessThanOrEqual(20);
		expect(payload.top.files.denseFiles.length).toBeLessThanOrEqual(20);
	});

	it("keeps test-only broad names out unless tests are included", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"export const sourceSignalName = 1;",
				"export function readSourceSignalName() {",
				"  return sourceSignalName;",
				"}",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "app.test.ts"),
			[
				"const testOnlySignalName = 1;",
				"export function readTestOnlySignalName() {",
				"  return [",
				"    testOnlySignalName,",
				"    testOnlySignalName,",
				"    testOnlySignalName,",
				"    testOnlySignalName,",
				"  ];",
				"}",
			].join("\n"),
			"utf8",
		);

		const defaultNames = broadNamePoolNames(signalTopJson());
		expect(defaultNames).toContain("sourceSignalName");
		expect(defaultNames).not.toContain("testOnlySignalName");

		const withTestsNames = broadNamePoolNames(signalTopJson("--include-tests"));
		expect(withTestsNames).toContain("testOnlySignalName");
	});
});

function scanEntry(pathValue: string, language: string, sizeLines: number) {
	return {
		path: pathValue,
		language,
		fileCategory: "code",
		sizeLines,
	};
}

function fileRows(payload: Record<string, unknown>): string[] {
	const top = payload.top as Record<string, unknown>;
	const files = top.files as Record<string, unknown>;
	return (files.denseFiles as Array<Record<string, unknown>>).map((row) =>
		String(row.file),
	);
}

function firstDenseRow(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const top = payload.top as Record<string, unknown>;
	const files = top.files as Record<string, unknown>;
	return (files.denseFiles as Array<Record<string, unknown>>)[0] ?? {};
}

function signalTopJson(...args: string[]): Record<string, unknown> {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"tsx",
			"src/codemap/cli.ts",
			"signals",
			"--project-root",
			workDir,
			"--json",
			...args,
			"top",
		],
		{ cwd: workspaceRoot, encoding: "utf8" },
	);

	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	return JSON.parse(result.stdout) as Record<string, unknown>;
}

function broadNamePoolNames(payload: Record<string, unknown>): string[] {
	const top = payload.top as Record<string, unknown>;
	const variables = top.variables as Record<string, unknown>;
	return (variables.broadNamePools as Array<Record<string, unknown>>).map(
		(row) => String(row.name),
	);
}
