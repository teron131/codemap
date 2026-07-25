/** Defines CLI behavior for focused source inspection targets. */
import type { Command } from "commander";

import { resolveProjectRoot } from "../common.js";
import {
  codebaseMemoryInspect,
  inspectPathTargetKind,
  renderCodebaseMemoryInspect,
  renderCurrentTreeInspection,
} from "../source/inspection/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

type InspectOptions = {
  projectRoot?: string;
  limit?: string | number;
  backend?: boolean;
  local?: boolean;
};

type RootOptions = {
  projectRoot?: string;
};

/** Registers the inspect command and its output options. */
export function addInspectParser(program: Command): void {
  const inspect = program
    .command("inspect")
    .description("Inspect one known file, function, class, variable, or symbol target.")
    .argument("<target>")
    .option("--limit <count>", "Maximum rows per section.", parseIntegerOption, 8)
    .option("--backend", "Use Codebase Memory backend inspection only.")
    .option("--local", "Use current-tree local inspection only.")
    .action((target: string, options: InspectOptions) => {
      const exitCode = commandInspect(target, options, program.opts<RootOptions>());
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
  addProjectRootArgument(inspect);
}

/** Runs focused inspection for a path, symbol, or directory target. */
export function commandInspect(
  target: string,
  options: InspectOptions,
  rootOptions: RootOptions = {},
): number {
  const root = resolveProjectRoot(options.projectRoot ?? rootOptions.projectRoot);
  const limit = inspectLimit(options.limit);
  if (options.backend && options.local) {
    console.log("Choose only one inspect lane: --backend or --local.");
    return 2;
  }
  if (!options.backend && inspectPathTargetKind(root, target) !== null) {
    const inspection = renderCurrentTreeInspection(root, target, { limit });
    if (inspection !== null) {
      console.log(inspection);
      return 0;
    }
  }
  if (!options.local) {
    const backendInspection = codebaseMemoryInspect(root, target, limit);
    if (backendInspection !== null) {
      console.log(renderCodebaseMemoryInspect(backendInspection, { limit }));
      return 0;
    }
  }
  if (options.backend) {
    console.log(`No backend match: ${target}`);
    console.log("Backend: Codebase Memory");
    return 1;
  }
  const inspection = renderCurrentTreeInspection(root, target, { limit });
  if (inspection === null) {
    const quotedTarget = `'${target.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    console.log(`No match: ${target}`);
    console.log(`Run: codemap search --project-root ${root} ${quotedTarget}`);
    return 1;
  }
  console.log(inspection);
  return 0;
}

/** Parses the inspect output limit option. */
function inspectLimit(value: string | number | undefined): number {
  if (value === undefined) {
    return 8;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? 8 : parsed;
}
