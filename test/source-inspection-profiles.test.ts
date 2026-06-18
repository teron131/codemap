/** Checks inspection profile rendering helpers. */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	appendFileProfileRow,
	renderDirectoryProfile,
} from "../src/codemap/source/inspection/profiles.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`source-inspection-profiles-${process.pid}-${Date.now()}`,
	);
	mkdirSync(path.join(workDir, "src"), { recursive: true });
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

describe("inspection profile rendering", () => {
	it("shows source line counts in file profiles", () => {
		const lines: string[] = [];

		appendFileProfileRow(lines, [
			{
				file: "src/large.ts",
				total: 0,
				lines: 420,
				defines: 0,
				imports_local: 0,
				exports: 0,
			},
		]);

		expect(lines.join("\n")).toContain(
			"- signals=0, lines=420, defines=0, local_imports=0, exports=0",
		);
	});

	it("shows source line counts in directory profiles", () => {
		const output = renderDirectoryProfile(
			workDir,
			{
				stats: {
					files: 0,
					nodes: 0,
					edges: 0,
					nodeTypes: {},
					edgeTypes: {},
					languages: {},
					categories: {},
				},
				nodes: [],
				edges: [],
				evidence: {
					importMap: {},
				},
			},
			{
				fileProfiles: [
					{
						file: "src/large.ts",
						total: 0,
						lines: 420,
						defines: 0,
						imports_local: 0,
					},
				],
			},
			"src",
			{ limit: 4 },
		);

		expect(output).toContain(
			"- src/large.ts: signals=0, lines=420, defines=0, local_imports=0",
		);
	});
});
