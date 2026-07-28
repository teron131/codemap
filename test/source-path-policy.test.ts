/** Checks source path classification shared across Codemap capabilities. */
import { describe, expect, it } from "vitest";

import {
  isGeneratedPath,
  isSupportedSourcePath,
  isTestPath,
} from "../src/codemap/source/scanner/path-policy.js";

describe("source path policy", () => {
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
    expect(isGeneratedPath("generated/api.ts")).toBe(true);
    expect(isGeneratedPath(".generated/api.ts")).toBe(true);
    expect(isGeneratedPath("src/generated/api.ts")).toBe(true);
    expect(isGeneratedPath("SRC/GENERATED/api.ts")).toBe(true);
    expect(isGeneratedPath("src\\__generated__\\api.ts")).toBe(true);
    expect(isGeneratedPath("src/app.bundle.js")).toBe(true);
    expect(isGeneratedPath("src/schema.generated.ts")).toBe(true);
    expect(isGeneratedPath("src/app.min.js")).toBe(true);
    expect(isGeneratedPath("src/load/import_map.ts")).toBe(true);

    expect(isGeneratedPath("src/generator/api.ts")).toBe(false);
    expect(isGeneratedPath("src/generatedness/api.ts")).toBe(false);
  });

  it("matches backend metric paths to the supported current-tree source surface", () => {
    expect(isSupportedSourcePath("src/app.ts")).toBe(true);
    expect(isSupportedSourcePath("src/app.py")).toBe(true);
    expect(isSupportedSourcePath(".github/scripts/check.mjs")).toBe(true);

    expect(isSupportedSourcePath("apps/android/Main.kt")).toBe(false);
    expect(isSupportedSourcePath(".agents/skills/check.mjs")).toBe(false);
    expect(isSupportedSourcePath("dist/app.js")).toBe(false);
  });
});
