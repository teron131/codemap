/** Defines CLI parsers and handlers for saved artifact commands. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Argument, type Command } from "commander";

import { createArtifacts, updateArtifacts } from "../artifacts/index.js";
import {
	canonicalDir,
	graphPath,
	readJson,
	resolveProjectRoot,
	viewsDir,
} from "../common.js";
import { addProjectRootArgument, parseIntegerOption } from "./options.js";

export const VIEW_CHOICES = [
	"architecture",
	"metrics",
	"update",
	"overview",
	"brief",
	"summary",
	"hotspots",
	"html",
] as const;

export const TEXT_VIEW_FILES: Record<string, string> = {
	brief: "agent-brief.md",
	hotspots: "hotspots.md",
	summary: "summary.md",
};

type ArtifactOptions = {
	projectRoot?: string;
	pretty?: boolean;
	maxChars?: string | number;
};

type RootOptions = {
	projectRoot?: string;
};

/** Registers artifact create, update, status, and view subcommands. */
export function addArtifactsParsers(program: Command): void {
	const artifacts = program
		.command("artifacts")
		.description("Create, update, status, or view saved artifacts.");

	const artifactCreate = artifacts
		.command("create")
		.description("Create saved .context-graph artifacts.")
		.action((options: ArtifactOptions) => {
			const exitCode = commandArtifactsCreate(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(artifactCreate);

	const artifactUpdate = artifacts
		.command("update")
		.description("Update saved artifacts when they exist.")
		.action((options: ArtifactOptions) => {
			const exitCode = commandArtifactsUpdate(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(artifactUpdate);

	const artifactStatus = artifacts
		.command("status")
		.description("Print saved artifact status.")
		.action((options: ArtifactOptions) => {
			const exitCode = commandArtifactsStatus(
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(artifactStatus);

	const artifactView = artifacts
		.command("view")
		.description("Print a saved artifact view.")
		.addArgument(new Argument("<view>").choices(VIEW_CHOICES))
		.option("--pretty")
		.option(
			"--max-chars <count>",
			"Maximum characters to print.",
			parseIntegerOption,
			6000,
		)
		.action((view: string, options: ArtifactOptions) => {
			const exitCode = commandArtifactsView(
				view,
				options,
				program.opts<RootOptions>(),
			);
			if (exitCode !== 0) {
				process.exitCode = exitCode;
			}
		});
	addProjectRootArgument(artifactView);
}

/** Runs artifact creation and prints saved artifact paths. */
export function commandArtifactsCreate(
	options: ArtifactOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const result = createArtifacts(root);
	console.log(result.message);
	console.log(result.graphPath);
	return 0;
}

/** Prints saved artifact freshness and fingerprint status. */
export function commandArtifactsStatus(
	options: ArtifactOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const currentGraphPath = graphPath(root);
	if (!existsSync(currentGraphPath)) {
		console.log(`No artifacts: ${currentGraphPath}`);
		return 1;
	}
	const graph = readJson(currentGraphPath) as Record<string, unknown>;
	const stats = recordValue(graph.stats);
	console.log(
		`${path.basename(root)}: ${String(stats.nodes ?? 0)} nodes, ${String(stats.edges ?? 0)} edges, ${String(stats.files ?? 0)} files`,
	);
	const metaPath = path.join(canonicalDir(root), "meta.json");
	const meta = existsSync(metaPath)
		? (readJson(metaPath) as Record<string, unknown>)
		: {};
	console.log(
		`generated: ${String(meta.lastUpdatedAt || meta.lastBuiltAt || "unknown")}`,
	);
	console.log(`canonical: ${currentGraphPath}`);
	console.log(`views: ${viewsDir(root)}`);
	const htmlPath = path.join(viewsDir(root), "index.html");
	if (existsSync(htmlPath)) {
		console.log(`report: ${htmlPath}`);
	}
	return 0;
}

/** Runs incremental artifact update and prints the refresh message. */
export function commandArtifactsUpdate(
	options: ArtifactOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	const result = updateArtifacts(root);
	console.log(result.message);
	return result.returncode;
}

/** Prints one saved artifact view in text, JSON, or HTML form. */
export function commandArtifactsView(
	viewName: string,
	options: ArtifactOptions,
	rootOptions: RootOptions = {},
): number {
	const root = resolveProjectRoot(
		options.projectRoot ?? rootOptions.projectRoot,
	);
	if (TEXT_VIEW_FILES[viewName]) {
		const filePath = path.join(viewsDir(root), TEXT_VIEW_FILES[viewName]);
		if (!existsSync(filePath)) {
			throw new Error(
				`No ${viewName} view: ${filePath}\nRun: codemap artifacts create --project-root ${root}`,
			);
		}
		console.log(readFileSync(filePath, "utf8").trim());
		return 0;
	}
	if (viewName === "html") {
		const filePath = path.join(viewsDir(root), "index.html");
		if (!existsSync(filePath)) {
			throw new Error(
				`No HTML report: ${filePath}\nRun: codemap artifacts create --project-root ${root}`,
			);
		}
		console.log(filePath);
		return 0;
	}
	const filePath = path.join(viewsDir(root), `${viewName}.json`);
	if (!existsSync(filePath)) {
		throw new Error(
			`No ${viewName} view: ${filePath}\nRun: codemap artifacts create --project-root ${root}`,
		);
	}
	const payload = readJson(filePath);
	const text = stringifyArtifactJson(payload, {
		pretty: Boolean(options.pretty),
	});
	console.log(truncateWithEllipsis(text, maxChars(options.maxChars)));
	return 0;
}

/** Parses and clamps the artifact view character limit. */
function maxChars(value: string | number | undefined): number {
	if (value === undefined) {
		return 6000;
	}
	const parsed =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isNaN(parsed) ? 6000 : parsed;
}

/** Trims artifact text and marks the cut visibly. */
function truncateWithEllipsis(text: string, limit: number): string {
	if (limit < 0 || text.length <= limit) {
		return text;
	}
	if (limit <= 3) {
		return "...".slice(0, limit);
	}
	return `${text.slice(0, limit - 3)}...`;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Serializes artifact JSON with compatibility key ordering. */
function stringifyArtifactJson(
	value: unknown,
	{ pretty, indent = 0 }: { pretty: boolean; indent?: number },
): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return "[]";
		}
		if (!pretty) {
			return `[${value.map((item) => stringifyArtifactJson(item, { pretty })).join(",")}]`;
		}
		const pad = " ".repeat(indent);
		const childPad = " ".repeat(indent + 2);
		return `[\n${value.map((item) => `${childPad}${stringifyArtifactJson(item, { pretty, indent: indent + 2 })}`).join(",\n")}\n${pad}]`;
	}

	const record = value as Record<string, unknown>;
	const keys = orderedJsonKeys(record).filter(
		(key) => record[key] !== undefined,
	);
	if (keys.length === 0) {
		return "{}";
	}
	if (!pretty) {
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyArtifactJson(record[key], { pretty })}`).join(",")}}`;
	}
	const pad = " ".repeat(indent);
	const childPad = " ".repeat(indent + 2);
	return `{\n${keys.map((key) => `${childPad}${JSON.stringify(key)}: ${stringifyArtifactJson(record[key], { pretty, indent: indent + 2 })}`).join(",\n")}\n${pad}}`;
}

/** Orders artifact JSON keys for stable output. */
function orderedJsonKeys(record: Record<string, unknown>): string[] {
	const usageBucketKeys = ["0_1", "2", "3_5", "6_plus"];
	if (usageBucketKeys.every((key) => Object.hasOwn(record, key))) {
		return usageBucketKeys;
	}
	return Object.keys(record);
}
