/** Checks TypeScript-family scanner edge cases. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanEntry } from "../src/codemap/source/extraction/index.js";
import { scanTypescriptFile } from "../src/codemap/source/scanner/index.js";

const workspaceRoot = process.cwd();
let workDir: string;

beforeEach(() => {
	workDir = path.join(
		workspaceRoot,
		"test",
		".work",
		`source-scanner-typescript-${process.pid}-${Date.now()}`,
	);
	mkdirSync(workDir, { recursive: true });
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

describe("TypeScript-family scanner", () => {
	it("labels JavaScript module suffixes as JavaScript inventory rows", () => {
		for (const suffix of [".mjs", ".cjs"]) {
			const filePath = path.join(workDir, `module${suffix}`);
			writeFileSync(filePath, "export const value = 1;\n", "utf8");

			expect(scanEntry(workDir, filePath)).toMatchObject({
				path: `module${suffix}`,
				language: "javascript",
				fileCategory: "code",
				sizeLines: 1,
			});
		}
	});

	it("parses JavaScript module suffixes", () => {
		for (const suffix of [".mjs", ".cjs"]) {
			const filePath = path.join(workDir, `module${suffix}`);
			writeFileSync(
				filePath,
				[
					"import fs from 'node:fs';",
					"",
					"export function run(value) {",
					"  const normalized = String(value).trim();",
					"  return fs.existsSync(normalized);",
					"}",
				].join("\n"),
				"utf8",
			);

			const metrics = scanTypescriptFile(filePath, {
				relPath: `module${suffix}`,
			});

			expect(metrics.lines).toBe(6);
			expect(metrics.importsLocal).toBe(0);
			expect(metrics.exports).toBe(1);
			expect(metrics.functionSpans).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "run",
					}),
				]),
			);
		}
	});
});
