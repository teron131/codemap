/** Checks compact text rendering for syntax matches. */
import { describe, expect, it, vi } from "vitest";

import { printSyntaxMatches } from "../src/codemap/ast-grep/index.js";

describe("ast-grep text rendering", () => {
	it("marks hidden continuation lines with an ellipsis", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			printSyntaxMatches(
				[
					{
						filePath: "src/app.ts",
						line: 10,
						column: 3,
						endLine: 12,
						endColumn: 4,
						text: "console.log(\n  value,\n)",
						lines: "console.log(\n  value,\n)",
					},
				],
				{ jsonOutput: false },
			);
			expect(logSpy.mock.calls.map((call) => call.join(" "))).toEqual([
				"src/app.ts:10:3: console.log( ...",
			]);
		} finally {
			logSpy.mockRestore();
		}
	});
});
