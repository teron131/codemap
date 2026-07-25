/** Defines CLI behavior for backend-first source summary output. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import { codebaseMemoryArchitectureSummary } from "../rendering/architecture.js";
import { buildSummaryText } from "../rendering/index.js";
import { currentTreeSummaryGraph } from "../source/graph/index.js";
import { addProjectRootArgument } from "./options.js";

type SummaryOptions = {
  projectRoot?: string;
};

type RootOptions = {
  projectRoot?: string;
};

/** Registers the current-tree summary command. */
export function addSummaryParser(program: Command): void {
  const summary = program
    .command("summary")
    .description("Print the concise Markdown summary view.")
    .action((options: SummaryOptions) => {
      const exitCode = commandSummary(options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(summary);
}

/** Builds and prints backend architecture or current-tree fallback output. */
export function commandSummary(options: SummaryOptions, rootOptions: RootOptions = {}): number {
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  const backendSummary = codebaseMemoryArchitectureSummary(root);
  if (backendSummary !== null) {
    console.log(backendSummary);
    return 0;
  }
  console.log(buildSummaryText(currentTreeSummaryGraph(root), { root }).trim());
  return 0;
}
