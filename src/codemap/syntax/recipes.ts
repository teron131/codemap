/** Defines reusable syntax rewrite recipes and result formatting. */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	printRewriteResults,
	printSyntaxMatches,
	ruleResults,
	type SyntaxMatch,
	type SyntaxRewriteResult,
	syntaxMatches,
	syntaxRewrite,
} from "../ast-grep/index.js";

export type SyntaxRecipeStep = {
	name: string;
	lang: string;
	pattern: string;
	rewrite?: string | null;
};

export type SyntaxRecipe = {
	name: string;
	summary: string;
	steps: SyntaxRecipeStep[];
	inlineRule?: string | null;
	applies?: boolean;
};

export const SYNTAX_RECIPES: Record<string, SyntaxRecipe> = {
	"python-none-comparison": {
		name: "python-none-comparison",
		summary:
			"Replace Python equality checks against None with identity checks.",
		steps: [
			{
				name: "none-equality",
				lang: "python",
				pattern: "$A == None",
				rewrite: "$A is None",
			},
			{
				name: "none-inequality",
				lang: "python",
				pattern: "$A != None",
				rewrite: "$A is not None",
			},
		],
	},
	"python-print-call": {
		name: "python-print-call",
		summary:
			"Find Python print calls before removing debug output or replacing logging.",
		steps: [],
		inlineRule:
			"id: python-print-call\nlanguage: python\nrule:\n  pattern: print($$$ARGS)",
	},
	"typescript-console-log": {
		name: "typescript-console-log",
		summary:
			"Find TypeScript console.log calls before removing debug output or replacing logging.",
		steps: [
			{
				name: "console-log",
				lang: "typescript",
				pattern: "console.log($$$ARGS)",
			},
		],
	},
	"react-fragment-shorthand": {
		name: "react-fragment-shorthand",
		summary:
			"Replace explicit React.Fragment wrappers with fragment shorthand in TSX.",
		steps: [
			{
				name: "react-fragment",
				lang: "tsx",
				pattern: "<React.Fragment>$$$CHILDREN</React.Fragment>",
				rewrite: "<>$$$CHILDREN</>",
			},
		],
	},
};

/** Reports whether every step in a syntax recipe is apply-capable. */
export function canApply(recipe: SyntaxRecipe): boolean {
	return Boolean(recipe.applies) || recipe.steps.some((step) => step.rewrite);
}

/** Prints available syntax recipes with apply support status. */
export function printRecipeCatalog(): void {
	console.log("Syntax recipes:");
	for (const recipe of Object.values(SYNTAX_RECIPES)) {
		const mode = canApply(recipe) ? "replace" : "search";
		console.log(`  - ${recipe.name} [${mode}]: ${recipe.summary}`);
	}
}

/** Runs a named syntax recipe against selected target files. */
export function runRecipe(
	root: string,
	recipe: SyntaxRecipe,
	paths: string[],
	{
		apply = false,
		jsonOutput = false,
	}: { apply?: boolean; jsonOutput?: boolean },
): number {
	if (recipe.inlineRule) {
		const [matches, rewrites] = runInlineRuleRecipe(root, recipe, paths, {
			apply,
		});
		if (jsonOutput) {
			console.log(
				JSON.stringify(
					inlineRuleJsonResult(recipe, matches, rewrites),
					null,
					2,
				),
			);
		} else {
			printInlineRuleResult(recipe, matches, rewrites);
		}
		return 0;
	}

	const results = [];
	let returncode = 0;
	for (const step of recipe.steps) {
		const [stepReturncode, stepResult] = runRecipeStep(
			root,
			recipe,
			step,
			paths,
			{
				apply,
				jsonOutput,
			},
		);
		if (stepReturncode === 127) {
			return 127;
		}
		returncode = Math.max(returncode, stepReturncode);
		if (jsonOutput && stepResult !== null) {
			results.push(stepResult);
		}
	}
	if (jsonOutput) {
		console.log(
			JSON.stringify(
				{ recipe: recipe.name, summary: recipe.summary, steps: results },
				null,
				2,
			),
		);
	}
	return returncode;
}

/** Runs one step in a syntax recipe. */
export function runRecipeStep(
	root: string,
	recipe: SyntaxRecipe,
	step: SyntaxRecipeStep,
	paths: string[],
	{
		apply = false,
		jsonOutput = false,
	}: { apply?: boolean; jsonOutput?: boolean },
): [number, Record<string, unknown> | null] {
	if (step.rewrite) {
		const rewriteResults = syntaxRewrite(
			root,
			step.lang,
			step.pattern,
			step.rewrite,
			paths,
			{ apply },
		);
		if (rewriteResults === null) {
			console.log("Unavailable: ast-grep-py not installed.");
			return [127, null];
		}
		const returncode = rewriteResults.length > 0 ? 0 : 1;
		if (!jsonOutput) {
			printRecipeStepResult(recipe, step, {
				matches: null,
				rewrites: rewriteResults,
			});
		}
		return [
			returncode,
			recipeJsonResult(recipe, step, {
				matches: null,
				rewrites: rewriteResults,
				returncode,
			}),
		];
	}

	const matches = syntaxMatches(root, step.lang, step.pattern, paths);
	if (matches === null) {
		console.log("Unavailable: ast-grep-py not installed.");
		return [127, null];
	}
	const returncode = matches.length > 0 ? 0 : 1;
	if (!jsonOutput) {
		printRecipeStepResult(recipe, step, { matches, rewrites: null });
	}
	return [
		returncode,
		recipeJsonResult(recipe, step, {
			matches,
			rewrites: null,
			returncode,
		}),
	];
}

/** Runs one inline ast-grep rule recipe step. */
export function runInlineRuleRecipe(
	root: string,
	recipe: SyntaxRecipe,
	paths: string[],
	{ apply = false }: { apply?: boolean },
): [SyntaxMatch[] | null, SyntaxRewriteResult[] | null, string] {
	const rulePath = path.join(root, ".codemap-inline-rule.yml");
	writeFileSync(rulePath, String(recipe.inlineRule), "utf8");
	try {
		return ruleResults(root, rulePath, paths, { apply });
	} finally {
		rmSync(rulePath, { force: true });
	}
}

/** Builds JSON output for one inline syntax rule recipe step. */
export function inlineRuleJsonResult(
	recipe: SyntaxRecipe,
	matches: SyntaxMatch[] | null,
	rewrites: SyntaxRewriteResult[] | null,
): Record<string, unknown> {
	return {
		recipe: recipe.name,
		summary: recipe.summary,
		backend: "ast-grep-inline-rule",
		returncode: 0,
		matches: (matches ?? []).map((match) => matchToJson(match)),
		rewrites: (rewrites ?? []).map((rewrite) => rewriteToJson(rewrite)),
	};
}

/** Builds JSON output for a full syntax recipe result. */
export function recipeJsonResult(
	recipe: SyntaxRecipe,
	step: SyntaxRecipeStep,
	{
		matches,
		rewrites,
		returncode,
	}: {
		matches: SyntaxMatch[] | null;
		rewrites: SyntaxRewriteResult[] | null;
		returncode: number;
	},
): Record<string, unknown> {
	return {
		recipe: recipe.name,
		step: step.name,
		language: step.lang,
		pattern: step.pattern,
		rewrite: step.rewrite ?? null,
		returncode,
		matches: (matches ?? []).map((match) => matchToJson(match)),
		rewrites: (rewrites ?? []).map((rewrite) => rewriteToJson(rewrite)),
	};
}

/** Prints one inline syntax rule recipe result. */
export function printInlineRuleResult(
	recipe: SyntaxRecipe,
	matches: SyntaxMatch[] | null,
	rewrites: SyntaxRewriteResult[] | null,
): void {
	console.log(`# ${recipe.name}`);
	console.log("- ast-grep inline rule");
	if (matches && matches.length > 0) {
		printSyntaxMatches(matches, { jsonOutput: false });
	} else if (rewrites && rewrites.length > 0) {
		printRewriteResults(rewrites);
	} else {
		console.log("No matches");
	}
}

/** Prints one syntax recipe step result. */
export function printRecipeStepResult(
	recipe: SyntaxRecipe,
	step: SyntaxRecipeStep,
	{
		matches,
		rewrites,
	}: {
		matches: SyntaxMatch[] | null;
		rewrites: SyntaxRewriteResult[] | null;
	},
): void {
	console.log(`# ${recipe.name}: ${step.name}`);
	console.log(`- ${step.lang}: ${step.pattern}`);
	if (step.rewrite) {
		console.log(`- rewrite: ${step.rewrite}`);
	}
	if (matches && matches.length > 0) {
		printSyntaxMatches(matches, { jsonOutput: false });
	} else if (rewrites && rewrites.length > 0) {
		printRewriteResults(rewrites);
	} else {
		console.log("No matches");
	}
}

/** Serializes a recipe syntax match for JSON output. */
export function matchToJson(match: SyntaxMatch): Record<string, unknown> {
	return {
		text: match.text,
		file: match.filePath,
		line: match.line,
		column: match.column,
		lines: match.lines,
	};
}

/** Serializes a recipe rewrite result for JSON output. */
export function rewriteToJson(
	rewrite: SyntaxRewriteResult,
): Record<string, unknown> {
	return {
		file: rewrite.filePath,
		matchCount: rewrite.matchCount,
		text: rewrite.text,
	};
}
