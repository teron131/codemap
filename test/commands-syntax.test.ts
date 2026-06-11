/** Checks syntax command handler output controls. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildParser,
	commandSyntaxRecipe,
	commandSyntaxRename,
	dispatch,
} from "../src/codemap/commands/index.js";

const workspaceRoot = process.cwd();
let workDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	process.exitCode = undefined;
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`commands-syntax-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
	logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	logSpy.mockRestore();
	rmSync(workDir, { recursive: true, force: true });
});

describe("syntax command handlers", () => {
	it("limits recipe text matches and marks hidden rows", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"console.log('one');",
				"console.log('two');",
				"console.log('three');",
			].join("\n"),
			"utf8",
		);

		expect(
			commandSyntaxRecipe({
				projectRoot: workDir,
				name: "typescript-console-log",
				paths: ["src"],
				limit: "2",
			}),
		).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("console.log('one')");
		expect(output).toContain("console.log('two')");
		expect(output).not.toContain("console.log('three')");
		expect(output).toContain("\n...");
	});

	it("wires recipe limit through the CLI parser", async () => {
		writeFileSync(
			path.join(workDir, "src", "parser.ts"),
			[
				"console.log('one');",
				"console.log('two');",
				"console.log('three');",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"recipe",
				"typescript-console-log",
				"--project-root",
				workDir,
				"--limit",
				"2",
				"src",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("console.log('one')");
		expect(output).toContain("console.log('two')");
		expect(output).not.toContain("console.log('three')");
		expect(output).toContain("\n...");
	});

	it("renames TypeScript identifiers in type positions", () => {
		writeFileSync(
			path.join(workDir, "src", "app.ts"),
			[
				"type ModelStatsSelectedModel = { value: number };",
				"const buildLlmStatsModels = 1;",
				"function use(model: ModelStatsSelectedModel) {",
				"  return buildLlmStatsModels + model.value;",
				"}",
			].join("\n"),
			"utf8",
		);

		expect(
			commandSyntaxRename({
				projectRoot: workDir,
				lang: "ts",
				oldName: "ModelStatsSelectedModel",
				newName: "LlmStatsModel",
				paths: ["src/app.ts"],
			}),
		).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("+ type LlmStatsModel = { value: number };");
		expect(output).toContain("+ function use(model: LlmStatsModel) {");
	});

	it("infers language for rename from target files", async () => {
		writeFileSync(
			path.join(workDir, "src", "inferred.ts"),
			[
				"type OldModel = { value: number };",
				"function use(model: OldModel) {",
				"  return model.value;",
				"}",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"rename",
				"--project-root",
				workDir,
				"OldModel",
				"NewModel",
				"src/inferred.ts",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("+ type NewModel = { value: number };");
		expect(output).toContain("+ function use(model: NewModel) {");
	});

	it("accepts cwd-relative syntax target paths when project root is inferred", async () => {
		const cwd = process.cwd();
		const nestedDir = path.join(workDir, "src", "nested");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(
			path.join(nestedDir, "local.ts"),
			[
				"type OldModel = { value: number };",
				"function use(model: OldModel) {",
				"  return model.value;",
				"}",
			].join("\n"),
			"utf8",
		);

		try {
			process.chdir(nestedDir);
			await expect(
				dispatch(buildParser(), [
					"node",
					"codemap",
					"syntax",
					"rename",
					"OldModel",
					"NewModel",
					"local.ts",
				]),
			).resolves.toBe(0);
		} finally {
			process.chdir(cwd);
		}

		const output = logLines().join("\n");
		expect(output).toContain("+ type NewModel = { value: number };");
		expect(output).toContain("+ function use(model: NewModel) {");
	});

	it("infers language for call target replacement", async () => {
		writeFileSync(
			path.join(workDir, "src", "calls.ts"),
			[
				"oldFn('one');",
				"const value = oldFn('two');",
				"const untouched = oldFn;",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"replace-call",
				"--project-root",
				workDir,
				"oldFn",
				"newFn",
				"src/calls.ts",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("+ newFn('one');");
		expect(output).toContain("+ const value = newFn('two');");
		expect(output).toContain("const untouched = oldFn;");
	});

	it("preserves object keys when renaming shorthand identifiers", () => {
		writeFileSync(
			path.join(workDir, "src", "shorthand.ts"),
			[
				"const oldName = 1;",
				"const output = { oldName };",
				"const { oldName } = output;",
				"console.log(oldName);",
			].join("\n"),
			"utf8",
		);

		expect(
			commandSyntaxRename({
				projectRoot: workDir,
				lang: "ts",
				oldName: "oldName",
				newName: "newName",
				paths: ["src/shorthand.ts"],
			}),
		).toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("+ const newName = 1;");
		expect(output).toContain("+ const output = { oldName: newName };");
		expect(output).toContain("+ const { oldName: newName } = output;");
		expect(output).toContain("+ console.log(newName);");
	});

	it("can print full rewritten files for rename previews", async () => {
		writeFileSync(
			path.join(workDir, "src", "full.ts"),
			[
				"type OldModel = { value: number };",
				"const untouched = true;",
				"function use(model: OldModel) {",
				"  return model.value;",
				"}",
			].join("\n"),
			"utf8",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"rename",
				"--project-root",
				workDir,
				"--full",
				"OldModel",
				"NewModel",
				"src/full.ts",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain("type NewModel = { value: number };");
		expect(output).toContain("const untouched = true;");
		expect(output).not.toContain("+ type NewModel");
	});

	it("prints no matches and can allow empty rename batches", async () => {
		writeFileSync(path.join(workDir, "src", "empty.ts"), "const value = 1;\n");

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"rename",
				"--project-root",
				workDir,
				"--lang",
				"ts",
				"--allow-empty",
				"missingName",
				"newName",
				"src",
			]),
		).resolves.toBe(0);

		const output = logLines().join("\n");
		expect(output).toContain(
			"No matches for syntax rename: missingName -> newName",
		);
		expect(output).toContain("Searched: src");
	});

	it("prints no supported syntax files when language inference has no targets", async () => {
		writeFileSync(path.join(workDir, "src", "notes.txt"), "OldModel\n");

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"rename",
				"--project-root",
				workDir,
				"OldModel",
				"NewModel",
				"src/notes.txt",
			]),
		).resolves.toBe(1);

		const output = logLines().join("\n");
		expect(output).toContain("No supported syntax files found.");
		expect(output).toContain("Add --lang");
	});

	it("prints no matches for preview misses", async () => {
		writeFileSync(
			path.join(workDir, "src", "preview.ts"),
			"const value = 1;\n",
		);

		await expect(
			dispatch(buildParser(), [
				"node",
				"codemap",
				"syntax",
				"preview",
				"--project-root",
				workDir,
				"--pattern",
				"missingName",
				"--rewrite",
				"newName",
				"--code-file",
				"src/preview.ts",
			]),
		).resolves.toBe(1);

		const output = logLines().join("\n");
		expect(output).toContain("No matches for syntax preview: missingName");
		expect(output).toContain("Searched: src/preview.ts");
	});
});

/** Collects mocked console output as printable test lines. */
function logLines(): string[] {
	return logSpy.mock.calls.map((call: unknown[]) => call.join(" "));
}
