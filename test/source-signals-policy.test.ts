/** Checks shared signal path predicates. */
import { describe, expect, it } from "vitest";

import { isGeneratedSignalPath, isTestPath } from "../src/codemap/source/signals/policy.js";

describe("signal path predicates", () => {
  it("detects conventional test files and directories without substring matches", () => {
    expect(isTestPath("tests/helpers.ts")).toBe(true);
    expect(isTestPath("src/__tests__/helpers.ts")).toBe(true);
    expect(isTestPath("src/unit-test/helpers.ts")).toBe(true);
    expect(isTestPath("libs/standard-tests/chat_models.py")).toBe(true);
    expect(isTestPath("src/app.test.ts")).toBe(true);
    expect(isTestPath("src/app_spec.py")).toBe(true);
    expect(isTestPath("src/test_app.py")).toBe(true);

    expect(isTestPath("src/contest/solver.ts")).toBe(false);
    expect(isTestPath("src/latest/models.ts")).toBe(false);
    expect(isTestPath("src/attestation/index.py")).toBe(false);
  });

  it("detects generated and bundled paths across path positions and case", () => {
    expect(isGeneratedSignalPath("generated/api.ts")).toBe(true);
    expect(isGeneratedSignalPath(".generated/api.ts")).toBe(true);
    expect(isGeneratedSignalPath("src/generated/api.ts")).toBe(true);
    expect(isGeneratedSignalPath("SRC/GENERATED/api.ts")).toBe(true);
    expect(isGeneratedSignalPath("src\\__generated__\\api.ts")).toBe(true);
    expect(isGeneratedSignalPath("src/app.bundle.js")).toBe(true);
    expect(isGeneratedSignalPath("src/app.min.js")).toBe(true);
    expect(isGeneratedSignalPath("src/load/import_map.ts")).toBe(true);

    expect(isGeneratedSignalPath("src/generator/api.ts")).toBe(false);
    expect(isGeneratedSignalPath("src/generatedness/api.ts")).toBe(false);
  });
});
