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
	it("prints a concise note for sparse top signals", () => {
		const output = renderSignalText(
			{
				functionPressure: [],
				smallFunctions: [],
				longNames: [],
			},
			"top",
		);

		expect(output).toContain("No refactor signal rows.");
		expect(output).not.toContain("## Function Pressure");
		expect(output).not.toContain("## Small Low-Use Functions");
		expect(output).not.toContain("## Long Names");
	});

	it("keeps full docstring text output bounded", () => {
		const output = renderSignalText(
			{
				docstrings: {
					files: 21,
					typescript_files: 21,
					python_files: 0,
					functions: 9,
					class_methods: 0,
					classes: 0,
					file_reports: Array.from({ length: 21 }, (_, index) => ({
						file: `src/file${index}.ts`,
						file_docstring_preview: `File ${index}.`,
						functions:
							index === 0
								? Array.from({ length: 9 }, (_, functionIndex) => ({
										qualified_name: `fn${functionIndex}`,
										line: functionIndex + 1,
										docstring_preview: `Function ${functionIndex}.`,
									}))
								: [],
						classes: [],
					})),
				},
			},
			"docstrings",
		);

		expect(output).toContain("## Docstring Files");
		expect(output).toContain("- ... 1 more files");
		expect(output).toContain("  - ... 1 more functions");
		expect(output).not.toContain("src/file20.ts");
		expect(output).not.toContain("fn8");
	});

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
		expect(
			renderSignalText(payload.top as Record<string, unknown>, "top"),
		).toContain("No refactor signal rows.");

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

	it("prints compact docstring signal text", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"/** App module docs. */",
				"",
				"/** Runs the command flow. */",
				"export function run(value: string) {",
				"  return value;",
				"}",
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
				"docstring-signals",
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("# Docstring Signals");
		expect(result.stdout).toContain("- file docstrings: 1/1");
		expect(result.stdout).toContain("- src/app.ts: App module docs.");
		expect(result.stdout).toContain(
			"- src/app.ts:4 run: Runs the command flow.",
		);
	});

	it("prints full docstring payload JSON", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"/** App module docs. */",
				"",
				"/** Runs the command flow. */",
				"export function run(value: string) {",
				"  return value;",
				"}",
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
				"docstrings",
			],
			{ cwd: workspaceRoot, encoding: "utf8" },
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload.docstrings).toMatchObject({
			files: 1,
			typescript_files: 1,
			file_reports: [
				{
					file: "src/app.ts",
					file_docstring_preview: "App module docs.",
					functions: [
						{
							name: "run",
							docstring_preview: "Runs the command flow.",
						},
					],
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
		expect(payload).toEqual({
			freshness: "degraded",
			functionPressure: [],
			smallFunctions: [],
			longNames: [],
		});
		expect(result.stdout.length).toBeLessThan(500);
	});

	it("keeps test-only long names out unless tests are included", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"export const sourceIdentifierNameWithReviewPressure = 1;",
				"export const PORTFOLIO_NEWS_SUMMARY_RESPONSE_TICKER = 1;",
				"export const PortfolioNewsSummaryResponseTickerSchema = 1;",
				"export function readSourceIdentifierName() {",
				"  return sourceIdentifierNameWithReviewPressure;",
				"}",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			path.join(workDir, "src", "app.test.ts"),
			[
				"const testOnlyIdentifierNameWithReviewPressure = 1;",
				"export function readTestOnlyIdentifierName() {",
				"  return testOnlyIdentifierNameWithReviewPressure;",
				"}",
			].join("\n"),
			"utf8",
		);

		const defaultNames = longNameNames(signalTopJson());
		expect(defaultNames).toContain("sourceIdentifierNameWithReviewPressure");
		expect(defaultNames).not.toContain(
			"PORTFOLIO_NEWS_SUMMARY_RESPONSE_TICKER",
		);
		expect(defaultNames).not.toContain(
			"PortfolioNewsSummaryResponseTickerSchema",
		);
		expect(defaultNames).not.toContain(
			"testOnlyIdentifierNameWithReviewPressure",
		);

		const withTestsNames = longNameNames(signalTopJson("--include-tests"));
		expect(withTestsNames).toContain(
			"testOnlyIdentifierNameWithReviewPressure",
		);
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
	return (payload.files as Array<Record<string, unknown>>).map((row) =>
		String(row.file),
	);
}

function firstDenseRow(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	return (payload.files as Array<Record<string, unknown>>)[0] ?? {};
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

function longNameNames(payload: Record<string, unknown>): string[] {
	return (payload.longNames as Array<Record<string, unknown>>).map((row) =>
		String(row.name),
	);
}
