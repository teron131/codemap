/** Defines CLI behavior for the focused repository-orientation summary. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import { buildRepositorySummary, renderSummaryText } from "../summary/index.js";
import { addProjectRootArgument, type ProjectRootOptions } from "./options.js";

/** Registers the current-tree summary command. */
export function addSummaryParser(program: Command): void {
  const summary = program
    .command("summary")
    .description("Print the concise Markdown summary view.")
    .action((options: ProjectRootOptions) => {
      process.exitCode = commandSummary(options, program.opts<ProjectRootOptions>());
    });
  addProjectRootArgument(summary);
}

/** Builds and prints current-tree context enriched by native architecture facts. */
export function commandSummary(
  options: ProjectRootOptions,
  rootOptions: ProjectRootOptions = {},
): number {
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  console.log(renderSummaryText(buildRepositorySummary(root)).trim());
  return 0;
}
