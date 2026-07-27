/** Checks shared signal path predicates. */
import { describe, expect, it } from "vitest";

import {
  isGeneratedSignalPath,
  isSupportedSignalPath,
  isTestPath,
} from "../src/codemap/source/signals/policy.js";

describe("signal path predicates", () => {
  it("detects conventional test files and directories without substring matches", () => {
    expect(isTestPath("tests/helpers.ts")).toBe(true);
    expect(isTestPath("src/__tests__/helpers.ts")).toBe(true);
    expect(isTestPath("src/unit-test/helpers.ts")).toBe(true);
    expect(isTestPath("libs/standard-tests/chat_models.py")).toBe(true);
    expect(isTestPath("scripts/e2e/probe.ts")).toBe(true);
    expect(isTestPath("ui/src/test-helpers/control.ts")).toBe(true);
    expect(isTestPath("scripts/test-support/probe.ts")).toBe(true);
    expect(isTestPath("src/app.test.ts")).toBe(true);
    expect(isTestPath("src/app.test-support.ts")).toBe(true);
    expect(isTestPath("src/app_spec.py")).toBe(true);
    expect(isTestPath("src/app.suite.ts")).toBe(true);
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
    expect(isGeneratedSignalPath("src/schema.generated.ts")).toBe(true);
    expect(isGeneratedSignalPath("src/app.min.js")).toBe(true);
    expect(isGeneratedSignalPath("src/load/import_map.ts")).toBe(true);

    expect(isGeneratedSignalPath("src/generator/api.ts")).toBe(false);
    expect(isGeneratedSignalPath("src/generatedness/api.ts")).toBe(false);
  });

  it("matches backend metric paths to the supported current-tree source surface", () => {
    expect(isSupportedSignalPath("src/app.ts")).toBe(true);
    expect(isSupportedSignalPath("src/app.py")).toBe(true);
    expect(isSupportedSignalPath(".github/scripts/check.mjs")).toBe(true);

    expect(isSupportedSignalPath("apps/android/Main.kt")).toBe(false);
    expect(isSupportedSignalPath(".agents/skills/check.mjs")).toBe(false);
    expect(isSupportedSignalPath("dist/app.js")).toBe(false);
  });
});
