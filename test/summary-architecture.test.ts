/** Checks README extraction, source resolution, and shared docstring filtering. */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isIgnorableFileComment } from "../src/codemap/source/docstrings/index.js";
import {
  buildSourceContext,
  resolveSourceSymbol,
} from "../src/codemap/summary/architecture/source-context.js";
import { readmeSummaryFromText } from "../src/codemap/summary/index.js";

const workspaceRoot = process.cwd();
let workDir: string | null = null;

afterEach(() => {
  if (workDir !== null) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe("README summary extraction", () => {
  it("respects longer fences and reference-style links without inventing headings", () => {
    const sections = readmeSummaryFromText(
      [
        "# [Project][home]",
        "",
        "Read [the guide](https://example.com/path(with-parentheses)).",
        "",
        "````markdown",
        "```typescript",
        "## Inside code",
        "```",
        "````",
        "",
        "## Architecture",
        "Real content.",
        "",
        "[home]: https://example.com",
      ].join("\n"),
    );
    expect(sections.map((section) => section.title)).toEqual(["Project", "Architecture"]);
    expect(sections[0]?.content).toContain("Read the guide.");
  });
  it("keeps a three-level outline and content from only the first two useful sections", () => {
    const sections = readmeSummaryFromText(
      [
        '<p align="center"><img alt="Logo" src="logo.svg"></p>',
        "[![build](badge.svg)](actions)",
        "",
        "# Pi Agent Harness",
        "",
        "A self-extensible coding agent.",
        "",
        "## Packages",
        "",
        "The workspace contains three public packages.",
        "",
        "### Agent Runtime",
        "",
        "Tool calling and state management.",
        "",
        "## Installation",
        "",
        "Do not include this.",
        "",
        "### npm",
        "",
        "npm install pi",
        "",
        "## Architecture",
        "",
        "A fourth section should appear only in the outline.",
        "",
        "```ts",
        "const decorativeExample = true;",
        "```",
        "",
        "## Contributing",
        "See CONTRIBUTING.md.",
        "",
        "## License",
        "MIT",
      ].join("\n"),
    );

    expect(sections.map(({ level, outline, title }) => ({ level, outline, title }))).toEqual([
      { level: 1, outline: true, title: "Pi Agent Harness" },
      { level: 2, outline: true, title: "Packages" },
      { level: 3, outline: true, title: "Agent Runtime" },
      { level: 2, outline: true, title: "Architecture" },
    ]);
    expect(sections[0]?.content).toContain("A self-extensible coding agent.");
    expect(sections[1]?.content).toContain("The workspace contains three public packages.");
    expect(sections[2]?.content).toEqual([]);
    expect(sections[3]?.content).toEqual([]);
    expect(JSON.stringify(sections)).not.toContain("decorativeExample");
    expect(JSON.stringify(sections)).not.toContain("npm install");
  });

  it("supports setext headings", () => {
    expect(
      readmeSummaryFromText("Project\n=======\n\nPurpose.\n\nAPI\n---\n\nCalls."),
    ).toMatchObject([
      { level: 1, title: "Project", content: ["Purpose."] },
      { level: 2, title: "API", content: ["Calls."] },
    ]);
  });

  it("keeps semantic HTML headings while stripping their tags", () => {
    expect(readmeSummaryFromText('<h1 align="center">Project</h1>\n\nPurpose.')).toMatchObject([
      { level: 1, outline: true, title: "Project", content: ["Purpose."] },
    ]);
  });

  it("keeps unheaded introductory prose without inventing an outline heading", () => {
    const sections = readmeSummaryFromText(
      [
        '<p align="center">',
        '<a href="demo">Live Demo</a>',
        "</p>",
        "",
        "BuildingAI is an enterprise agent platform.",
        "It provides agents, RAG, and model aggregation.",
        "",
        "## Quick Start",
        "Install it with Docker.",
        "",
        "### Troubleshooting",
        "Setup details.",
        "",
        "## Key Features",
        "Production capabilities.",
      ].join("\n"),
    );

    expect(sections).toMatchObject([
      {
        level: 0,
        outline: false,
        title: "Introduction",
        content: [
          "BuildingAI is an enterprise agent platform.",
          "It provides agents, RAG, and model aggregation.",
        ],
      },
      {
        level: 2,
        outline: true,
        title: "Key Features",
        content: ["Production capabilities."],
      },
    ]);
  });

  it("normalizes multiline HTML headings and filters common heading variants", () => {
    const sections = readmeSummaryFromText(
      [
        '<h4 align="center">',
        "<p>English | 中文 | 한국어</p>",
        "</h4>",
        '<h3 align="center">',
        "<p>State-of-the-art models for inference and training</p>",
        "</h3>",
        "",
        "Transformers defines models across frameworks.",
        "",
        "## Installation",
        "Install details.",
        "",
        "## Quickstart",
        "Setup details.",
        "",
        "## Screenshots",
        "Images.",
        "",
        "## Citation",
        "Paper.",
        "",
        "## Architecture",
        "Runtime structure.",
      ].join("\n"),
    );

    expect(sections).toMatchObject([
      {
        level: 3,
        outline: true,
        title: "State-of-the-art models for inference and training",
        content: ["Transformers defines models across frameworks."],
      },
      {
        level: 2,
        outline: true,
        title: "Architecture",
        content: ["Runtime structure."],
      },
    ]);
  });
});

describe("summary source resolution", () => {
  it("uses backend qualification to distinguish the same export name across files", () => {
    workDir = path.join(
      workspaceRoot,
      "test",
      ".work",
      `summary-source-${process.pid}-${Date.now()}`,
    );
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    writeFileSync(
      path.join(workDir, "src", "function.ts"),
      "export function Shared() { return true; }\n",
    );
    writeFileSync(
      path.join(workDir, "src", "type.ts"),
      "export interface Shared { enabled: boolean }\n",
    );

    const source = buildSourceContext(workDir);

    expect(resolveSourceSymbol(source, "Shared", "src.type.Shared")).toMatchObject({
      file: "src/type.ts",
    });
  });
});

describe("docstring filtering", () => {
  it("ignores TypeScript tool directives as file intent", () => {
    expect(isIgnorableFileComment("oxlint-disable no-explicit-any")).toBe(true);
    expect(isIgnorableFileComment("eslint-disable no-console")).toBe(true);
    expect(isIgnorableFileComment('/ <reference path="./ambient.d.ts" />')).toBe(true);
    expect(isIgnorableFileComment("Core middleware")).toBe(false);
  });
});
