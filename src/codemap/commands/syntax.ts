/** Defines CLI parsers for syntax search, preview, rewrite, and recipes. */
import { Argument, type Command, Option } from "commander";

import { SYNTAX_RECIPES } from "../syntax/index.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";
import {
	addSearchCallsParser,
	addSearchMatchParser,
} from "./search-structural.js";
import {
	commandSyntaxDebug,
	commandSyntaxPreview,
	commandSyntaxRecipe,
	commandSyntaxRecipes,
	commandSyntaxRename,
	commandSyntaxReplace,
	commandSyntaxReplaceCall,
	commandSyntaxRule,
	DEBUG_FORMAT_CHOICES,
	type SyntaxDebugOptions,
	type SyntaxPreviewOptions,
	type SyntaxRecipeOptions,
	type SyntaxRewriteOptions,
	type SyntaxRuleOptions,
} from "./syntax-handlers.js";

type RootOptions = {
	projectRoot?: string;
};

/** Registers syntax search, recipe, rewrite, preview, and rule commands. */
export function addSyntaxParsers(program: Command): void {
	const syntax = program
		.command("syntax")
		.description(
			"Run project-scoped syntax rewrite, preview, debug, and recipe helpers.",
		);
	addSyntaxSearchParser(syntax);
	addSyntaxCallParsers(syntax);
	addSyntaxDebugParser(syntax);
	addSyntaxRecipeParsers(syntax);
	addSyntaxRewriteParsers(syntax);
	addSyntaxRuleParser(syntax);
}

/** Registers the deprecated syntax search alias for compatibility. */
export function addSyntaxSearchParser(command: Command): void {
	const syntaxSearch = command
		.command("search")
		.description("Deprecated alias for `codemap search match`.");
	addSearchMatchParser(syntaxSearch);
}

/** Registers syntax call-site search compatibility commands. */
export function addSyntaxCallParsers(command: Command): void {
	const syntaxCalls = command
		.command("calls")
		.description("Deprecated alias for `codemap search calls`.");
	addSearchCallsParser(syntaxCalls);

	const syntaxReplaceCall = command
		.command("replace-call")
		.description("Preview or apply a call-site rewrite while preserving args.")
		.option("--lang <lang>")
		.argument("<old_name>", "Function or dotted method target to replace.")
		.argument("<new_name>", "Replacement function or dotted method target.")
		.argument("[paths...]", "Project-relative target paths.")
		.option("--apply")
		.option("--yes", "Required with --apply.")
		.option("--allow-empty", "Exit 0 when no matches are found.")
		.option("--full", "Print full rewritten files instead of changed hunks.")
		.action(
			(
				oldName: string,
				newName: string,
				paths: string[],
				options: Omit<SyntaxRewriteOptions, "oldName" | "newName" | "paths">,
			) => {
				const exitCode = commandSyntaxReplaceCall({
					...options,
					oldName,
					newName,
					paths,
					projectRoot: rootOption(options, command),
				});
				if (exitCode !== 0) {
					process.exitCode = exitCode;
				}
			},
		);
	addProjectRootArgument(syntaxReplaceCall);
}

/** Registers syntax pattern debug and AST preview commands. */
export function addSyntaxDebugParser(command: Command): void {
	const syntaxDebug = command
		.command("debug")
		.description("Inspect how ast-grep parses a syntax pattern.")
		.requiredOption("--lang <lang>")
		.requiredOption("--pattern <pattern>")
		.addOption(
			new Option("--format <format>", "Output format.")
				.choices(DEBUG_FORMAT_CHOICES)
				.default("cst"),
		)
		.action((options: SyntaxDebugOptions) => {
			const exitCode = commandSyntaxDebug({
				...options,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(syntaxDebug);

	const syntaxPreview = command
		.command("preview")
		.description("Preview a rewrite against a snippet file or stdin.")
		.option("--lang <lang>")
		.requiredOption("--pattern <pattern>")
		.requiredOption("--rewrite <rewrite>")
		.option(
			"--code-file <codeFile>",
			"Snippet file to test. Reads stdin when omitted.",
		)
		.option("--full", "Print full rewritten file instead of changed hunks.")
		.action((options: SyntaxPreviewOptions) => {
			const exitCode = commandSyntaxPreview({
				...options,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(syntaxPreview);
}

/** Registers syntax recipe listing and execution commands. */
export function addSyntaxRecipeParsers(command: Command): void {
	const syntaxRecipes = command
		.command("recipes")
		.description("List curated syntax recipes.")
		.action(() => {
			const exitCode = commandSyntaxRecipes();
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(syntaxRecipes);

	const syntaxRecipe = command
		.command("recipe")
		.description("Preview or apply a curated syntax recipe.")
		.addArgument(
			new Argument(
				"<name>",
				`Recipe name: ${Object.keys(SYNTAX_RECIPES).sort().join(", ")}`,
			).choices(Object.keys(SYNTAX_RECIPES).sort()),
		)
		.argument("[paths...]", "Project-relative target paths.")
		.option(
			"--limit <count>",
			"Maximum text matches per step.",
			parseIntegerOption,
		)
		.option("--json")
		.option("--apply")
		.option("--yes", "Required with --apply.")
		.action(
			(
				name: string,
				paths: string[],
				options: Omit<SyntaxRecipeOptions, "name" | "paths">,
			) => {
				const exitCode = commandSyntaxRecipe({
					...options,
					name,
					paths,
					projectRoot: rootOption(options, command),
				});
				if (exitCode !== 0) {
					process.exitCode = exitCode;
				}
			},
		);
	addProjectRootArgument(syntaxRecipe);
}

/** Registers syntax rewrite, rename, and replace-call commands. */
export function addSyntaxRewriteParsers(command: Command): void {
	const syntaxReplace = command
		.command("replace")
		.description("Preview or apply a mechanical syntax rewrite.")
		.option("--lang <lang>")
		.requiredOption("--pattern <pattern>")
		.requiredOption("--rewrite <rewrite>")
		.argument("[paths...]", "Project-relative target paths.")
		.option("--apply")
		.option("--yes", "Required with --apply.")
		.option("--allow-empty", "Exit 0 when no matches are found.")
		.option("--full", "Print full rewritten files instead of changed hunks.")
		.action((paths: string[], options: Omit<SyntaxRewriteOptions, "paths">) => {
			const exitCode = commandSyntaxReplace({
				...options,
				paths,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(syntaxReplace);

	const syntaxRename = command
		.command("rename")
		.description("Preview or apply a simple syntax-level identifier rename.")
		.option("--lang <lang>")
		.argument("<old_name>")
		.argument("<new_name>")
		.argument("[paths...]", "Project-relative target paths.")
		.option("--apply")
		.option("--yes", "Required with --apply.")
		.option("--allow-empty", "Exit 0 when no matches are found.")
		.option("--full", "Print full rewritten files instead of changed hunks.")
		.action(
			(
				oldName: string,
				newName: string,
				paths: string[],
				options: Omit<SyntaxRewriteOptions, "oldName" | "newName" | "paths">,
			) => {
				const exitCode = commandSyntaxRename({
					...options,
					oldName,
					newName,
					paths,
					projectRoot: rootOption(options, command),
				});
				if (exitCode !== 0) {
					process.exitCode = exitCode;
				}
			},
		);
	addProjectRootArgument(syntaxRename);
}

/** Registers apply-capable ast-grep YAML rule execution. */
export function addSyntaxRuleParser(command: Command): void {
	const syntaxRule = command
		.command("rule")
		.description("Run a project-specific ast-grep YAML rule.")
		.requiredOption("--rule <rule>", "ast-grep YAML rule file.")
		.argument(
			"[paths...]",
			"Project-relative target paths. Defaults to the project root.",
		)
		.option("--json", "Print compact JSON output.")
		.option("--apply", "Apply rule fixes.")
		.option("--yes", "Required with --apply.")
		.action((paths: string[], options: Omit<SyntaxRuleOptions, "paths">) => {
			const exitCode = commandSyntaxRule({
				...options,
				paths,
				projectRoot: rootOption(options, command),
			});
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(syntaxRule);
}

/** Resolves command-local or global project-root options. */
function rootOption(
	options: { projectRoot?: string | undefined },
	command: Command,
): string | undefined {
	return (
		options.projectRoot ?? command.optsWithGlobals<RootOptions>().projectRoot
	);
}
