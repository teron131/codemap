/** `search match`, `search calls`, and `search rule`: explicit ast-grep searches. Exit code 1 means no match, 2 invalid input, such as a pattern or rule ast-grep rejects with its reason on stderr, and 127 a language call search has no patterns for. */
import type { Command } from "commander";

import { AstGrepRuleError } from "../ast-grep.js";
import {
  callMatches,
  resolveProjectFile,
  resolveTargetPaths,
  searchRuleMatches,
  type SyntaxMatch,
  SyntaxSearch,
} from "../search/index.js";
import {
  addProjectRootArgument,
  DEFAULT_ROW_LIMIT,
  parseIntegerOption,
  resolveProjectRoot,
} from "./options.js";

type SearchMatchOptions = {
  projectRoot?: string | undefined;
  lang?: string | undefined;
  pattern: string;
  paths?: string[] | undefined;
  json?: boolean | undefined;
};

type SearchCallsOptions = {
  projectRoot?: string | undefined;
  lang?: string | undefined;
  name: string;
  paths?: string[] | undefined;
  json?: boolean | undefined;
  limit?: number | undefined;
};

type SearchRuleOptions = {
  projectRoot?: string | undefined;
  rule: string;
  paths?: string[] | undefined;
  json?: boolean | undefined;
};

export function addSearchMatchParser(command: Command): void {
  addProjectRootArgument(command);
  command
    .option("--lang <lang>")
    .requiredOption("--pattern <pattern>")
    .argument("[paths...]", "Project-relative target paths.")
    .option("--json")
    .action((paths: string[], options: Omit<SearchMatchOptions, "paths">) => {
      process.exitCode = commandSearchMatch({
        ...options,
        paths,
        projectRoot: rootOption(options, command),
      });
    });
}

export function addSearchCallsParser(command: Command): void {
  command.description(
    "Find call sites: invocations like print(...), logger.info(...), or console.log(...).",
  );
  addProjectRootArgument(command);
  command
    .option("--lang <lang>")
    .argument("<name>", "Function or dotted method being called, such as print or console.log.")
    .argument("[paths...]", "Project-relative target paths.")
    .option("--limit <count>", "Maximum call sites.", parseIntegerOption)
    .option("--json")
    .action(
      (name: string, paths: string[], options: Omit<SearchCallsOptions, "name" | "paths">) => {
        process.exitCode = commandSearchCalls({
          ...options,
          name,
          paths,
          projectRoot: rootOption(options, command),
        });
      },
    );
}

export function addSearchRuleParser(command: Command): void {
  addProjectRootArgument(command);
  command
    .requiredOption("--rule <rule>", "ast-grep YAML rule file.")
    .argument("[paths...]", "Project-relative target paths. Defaults to the project root.")
    .option("--json", "Print compact JSON output.")
    .action(async (paths: string[], options: Omit<SearchRuleOptions, "paths">) => {
      process.exitCode = await commandSearchRule({
        ...options,
        paths,
        projectRoot: rootOption(options, command),
      });
    });
}

function commandSearchMatch(options: SearchMatchOptions): number {
  const root = resolveProjectRoot(options);
  const paths = resolveTargetPaths(root, options.paths ?? []);
  const search = new SyntaxSearch(root, paths);
  const languages = options.lang ? [options.lang] : search.languages();
  if (languages.length === 0) {
    printNoSyntaxTargets(paths);
    return 1;
  }
  const matches = [];
  let searchedLanguages = 0;
  for (const language of languages) {
    try {
      matches.push(...search.patternMatches(language, options.pattern));
      searchedLanguages += 1;
    } catch (error) {
      if (!(error instanceof AstGrepRuleError)) {
        throw error;
      }
      console.error(`ast-grep rejected the pattern for ${language}:\n${error.message}`);
    }
  }
  if (searchedLanguages === 0) {
    return 2;
  }
  printSyntaxMatches(matches, { jsonOutput: Boolean(options.json) });
  if (matches.length === 0 && !options.json) {
    console.log("No matches");
  }
  return matches.length > 0 ? 0 : 1;
}

function commandSearchCalls(options: SearchCallsOptions): number {
  const limit = options.limit ?? DEFAULT_ROW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    console.log("Call-site limit must be a positive integer.");
    return 2;
  }
  const root = resolveProjectRoot(options);
  const paths = resolveTargetPaths(root, options.paths ?? []);
  const search = new SyntaxSearch(root, paths);
  const languages = options.lang ? [options.lang] : search.languages();
  if (languages.length === 0) {
    printNoSyntaxTargets(paths);
    return 1;
  }
  const matches = [];
  for (const language of languages) {
    const languageMatches = callMatches(search, language, options.name);
    if (languageMatches === null) {
      console.log(
        `Unavailable: call search has no grammar for ${language}. Use search match --lang ${language} with a call pattern, or inspect <symbol> for callers.`,
      );
      return 127;
    }
    matches.push(...languageMatches);
  }
  const visibleMatches = matches.slice(0, limit);
  if (options.json) {
    console.log(
      JSON.stringify({
        total: matches.length,
        matches: visibleMatches.map((match) => matchJson(match)),
      }),
    );
  } else {
    printSyntaxMatches(visibleMatches, { jsonOutput: false });
  }
  if (matches.length === 0 && !options.json) {
    console.log("No matches");
  } else if (matches.length > visibleMatches.length && !options.json) {
    console.log(`... ${matches.length - visibleMatches.length} more call sites`);
  }
  return matches.length > 0 ? 0 : 1;
}

async function commandSearchRule(options: SearchRuleOptions): Promise<number> {
  const root = resolveProjectRoot(options);
  const paths = resolveTargetPaths(root, options.paths ?? []);
  const rulePath = resolveProjectFile(root, options.rule);
  let matches;
  try {
    matches = await searchRuleMatches(root, rulePath, paths);
  } catch (error) {
    if (!(error instanceof AstGrepRuleError)) {
      throw error;
    }
    console.error(`ast-grep rejected the rule:\n${error.message}`);
    return 2;
  }
  if (options.json) {
    console.log(
      JSON.stringify({
        rule: rulePath,
        matches: matches.map((match) => matchJson(match)),
      }),
    );
  } else if (matches.length > 0) {
    printSyntaxMatches(matches, { jsonOutput: false });
  } else {
    console.log("No matches");
  }
  return matches.length > 0 ? 0 : 1;
}

function printSyntaxMatches(matches: SyntaxMatch[], { jsonOutput }: { jsonOutput: boolean }): void {
  if (jsonOutput) {
    console.log(JSON.stringify(matches.map((match) => matchJson(match))));
    return;
  }
  for (const match of matches) {
    const lines = match.text.trimEnd().split(/\r?\n/);
    const text = lines.length > 1 ? `${lines[0] ?? ""} ...` : (lines[0] ?? "");
    console.log(`${match.filePath}:${match.line}:${match.column}: ${text}`);
  }
}

/** JSON ranges are zero-based, unlike the one-based positions in text output. */
function matchJson(match: SyntaxMatch): Record<string, unknown> {
  return {
    text: match.text,
    range: {
      start: { line: match.line - 1, column: match.column - 1 },
      end: { line: match.endLine - 1, column: match.endColumn - 1 },
    },
    file: match.filePath,
    lines: match.lines,
    engine: match.engine,
  };
}

function rootOption(
  options: { projectRoot?: string | undefined },
  command: Command,
): string | undefined {
  return options.projectRoot ?? command.optsWithGlobals<{ projectRoot?: string }>().projectRoot;
}

function printNoSyntaxTargets(paths: string[]): void {
  console.log("No supported syntax files found.");
  console.log(`Searched: ${paths.length === 0 ? "." : paths.join(", ")}`);
  console.log("Add --lang when the target path is generated or unsuffixed.");
}
