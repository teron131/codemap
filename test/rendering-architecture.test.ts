/** Checks architecture intent extraction helpers. */
import { describe, expect, it } from "vitest";

import { readmeIntentLine } from "../src/codemap/rendering/index.js";
import { isIgnorableFileComment } from "../src/codemap/source/signals/docstrings/index.js";

describe("architecture intent extraction", () => {
	it("skips decorative README markup and extracts heading text", () => {
		expect(readmeIntentLine('<div align="center">')).toBe("");
		expect(readmeIntentLine('<img alt="Logo" src="logo.svg">')).toBe("");
		expect(readmeIntentLine("<h3>The agent engineering platform.</h3>")).toBe(
			"The agent engineering platform.",
		);
		expect(readmeIntentLine("# Hermes Agent")).toBe("# Hermes Agent");
	});

	it("ignores TypeScript tool directives as file intent", () => {
		expect(isIgnorableFileComment("oxlint-disable no-explicit-any")).toBe(true);
		expect(isIgnorableFileComment("eslint-disable no-console")).toBe(true);
		expect(isIgnorableFileComment("Core middleware")).toBe(false);
	});
});
