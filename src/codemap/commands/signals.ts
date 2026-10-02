/** Defines CLI behavior for ranked source-metric output. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import {
  buildSignalView,
  isSignalSection,
  renderSignalText,
  SIGNAL_SECTION_CHOICES,
} from "../signals/index.js";
import { addProjectRootArgument, type ProjectRootOptions } from "./options.js";

type SignalOptions = {
  projectRoot?: string;
  includeTests?: boolean;
  json?: boolean;
};

/** Registers ranked source-metric commands and output modes. */
export function addSignalsParser(program: Command): void {
  const signals = program
    .command("signals")
    .description("Print compact ranked metrics from the backend and current tree.")
    .argument("[section]", "Signal section to print.", "top")
    .option("--include-tests", "Include likely test files in file-specific signal rows.")
    .option("--json", "Print signal tables as JSON for jq, scripts, and agent pipelines.")
    .action((section: string, options: SignalOptions) => {
      process.exitCode = commandSignals(section, options, program.opts<ProjectRootOptions>());
    });
  addProjectRootArgument(signals);
}

/** Runs source-metric analysis and prints text or JSON output. */
export function commandSignals(
  section: string,
  options: SignalOptions,
  rootOptions: ProjectRootOptions = {},
): number {
  if (!isSignalSection(section)) {
    console.error(
      `error: argument section: invalid choice: '${section}' (choose from ${SIGNAL_SECTION_CHOICES.map((choice) => `'${choice}'`).join(", ")})`,
    );
    return 2;
  }
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  let selected: Record<string, unknown>;
  try {
    selected = buildSignalView(root, section, {
      includeTests: Boolean(options.includeTests),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (options.json) {
    console.log(JSON.stringify(selected));
  } else {
    console.log(renderSignalText(selected, section).trim());
  }
  return 0;
}
