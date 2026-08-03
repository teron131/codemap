/** Defines CLI behavior for the focused repository-orientation summary. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import { buildRepositorySummary, renderSummaryText } from "../summary/index.js";
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

/** Builds and prints current-tree context enriched by native architecture facts. */
export function commandSummary(options: SummaryOptions, rootOptions: RootOptions = {}): number {
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  console.log(renderSummaryText(buildRepositorySummary(root)).trim());
  return 0;
}
