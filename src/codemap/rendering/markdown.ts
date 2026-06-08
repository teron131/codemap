/** Renders current-tree summaries, hotspots, and briefs as markdown. */
import { languageMetricItems } from "../source/signals/index.js";

type Row = Record<string, unknown>;

/** Renders the agent-facing markdown brief for saved artifacts. */
export function renderAgentBrief(
	architecture: Row,
	metrics: Row,
	update: Row,
): string {
	const project = recordValue(architecture.project);
	const stats = recordValue(architecture.stats);
	const relationships = recordValue(architecture.relationships);
	const lines = [
		`# ${String(project.name ?? "project")} Context Graph`,
		"",
		`- Files: ${String(stats.files ?? 0)}`,
		`- Nodes: ${String(stats.nodes ?? 0)}`,
		`- Edges: ${String(stats.edges ?? 0)}`,
		"",
		"## Layers",
	];
	for (const layer of rowArray(architecture.layers).slice(0, 10)) {
		lines.push(
			`- ${String(layer.name)}: ${arrayValue(layer.nodeIds).length} files`,
		);
	}
	lines.push("");
	lines.push("## Relationships");
	lines.push(
		`- Python import edges: ${String(relationships.pythonImportEdges ?? 0)}`,
	);
	lines.push(
		`- TypeScript import edges: ${String(relationships.typescriptImportEdges ?? 0)}`,
	);
	lines.push(
		`- Entrypoint-like files: ${String(relationships.entrypointLikeFiles ?? 0)}`,
	);
	lines.push("");
	lines.push("## Long Functions");
	const longFunctions = recordValue(metrics.longFunctions);
	for (const item of languageMetricItems(longFunctions).slice(0, 10)) {
		lines.push(`- ${String(item.identifier)}: ${String(item.count)} lines`);
	}
	lines.push("");
	const usageSignals = recordValue(metrics.usageSignals);
	const lowUsageItems = languageMetricItems(
		recordValue(usageSignals.lowUsageFunctions),
	);
	if (lowUsageItems.length > 0) {
		lines.push("## Low-Use Internal Functions");
		for (const item of lowUsageItems.slice(0, 10)) {
			lines.push(
				`- ${String(item.identifier)}: ${String(item.count)} references`,
			);
		}
		lines.push("");
	}
	const lowUsageVariableItems = languageMetricItems(
		recordValue(usageSignals.lowUsageVariables),
	);
	if (lowUsageVariableItems.length > 0) {
		lines.push("## Low-Use Internal Variables");
		for (const item of lowUsageVariableItems.slice(0, 10)) {
			lines.push(
				`- ${String(item.identifier)}: ${String(item.count)} references`,
			);
		}
	}
	lines.push("");
	lines.push("## High-Use Variable Names");
	for (const item of languageMetricItems(
		recordValue(usageSignals.noisyVariables),
	).slice(0, 10)) {
		lines.push(`- ${String(item.name)}: ${String(item.count)} references`);
	}
	if (Object.keys(recordValue(update.refresh)).length > 0) {
		lines.push("");
		lines.push("## Last Artifact Update");
		const refresh = recordValue(update.refresh);
		for (const key of ["added", "deleted", "structural", "cosmetic"]) {
			lines.push(`- ${key}: ${arrayValue(refresh[key]).length}`);
		}
		const planSummary = recordValue(recordValue(update.refreshPlan).summary);
		if (Object.keys(planSummary).length > 0) {
			lines.push(
				`- import dependents: ${String(planSummary.importDependents ?? 0)}`,
			);
			lines.push(`- reanalyzed: ${String(planSummary.reanalyzed ?? 0)}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Renders hotspot rows for current-tree summary output. */
export function renderHotspotsText(metrics: Row): string {
	const longFunctions = recordValue(metrics.longFunctions);
	const usageSignals = recordValue(metrics.usageSignals);
	const lines = ["# Hotspots", "", "## Long Functions"];
	for (const item of languageMetricItems(longFunctions).slice(0, 15)) {
		lines.push(`- ${String(item.identifier)}: ${String(item.count)} lines`);
	}
	lines.push("");
	const lowUsageItems = languageMetricItems(
		recordValue(usageSignals.lowUsageFunctions),
	);
	if (lowUsageItems.length > 0) {
		lines.push("## Low-Use Internal Functions");
		for (const item of lowUsageItems.slice(0, 15)) {
			const identifier = item.identifier ?? item.name;
			lines.push(
				`- ${String(identifier)}: ${String(item.count ?? 0)} references`,
			);
		}
		lines.push("");
	}
	const lowUsageVariableItems = languageMetricItems(
		recordValue(usageSignals.lowUsageVariables),
	);
	if (lowUsageVariableItems.length > 0) {
		lines.push("## Low-Use Internal Variables");
		for (const item of lowUsageVariableItems.slice(0, 15)) {
			const identifier = item.identifier ?? item.name;
			lines.push(
				`- ${String(identifier)}: ${String(item.count ?? 0)} references`,
			);
		}
	}
	lines.push("");
	lines.push("## Dense Files");
	for (const item of rowArray(metrics.fileProfiles).slice(0, 15)) {
		const samples = arrayValue(item.samples)
			.slice(0, 4)
			.map((sample) => String(sample))
			.join(", ");
		const parts = [
			`signals ${String(item.total)}`,
			`defines ${String(item.defines)}`,
			`imports ${String(item.imports_local)}`,
		];
		lines.push(`- ${String(item.file)}: ${parts.join(", ")} (${samples})`);
	}
	lines.push("");
	lines.push("## High-Use Variable Names");
	for (const item of languageMetricItems(
		recordValue(usageSignals.noisyVariables),
	).slice(0, 15)) {
		lines.push(`- ${String(item.name)}: ${String(item.count)} references`);
	}
	return `${lines.join("\n")}\n`;
}

/** Renders current-tree summary markdown from graph views. */
export function renderSummaryText(
	overview: Row,
	architecture: Row,
	update: Row,
): string {
	const project = recordValue(overview.project);
	const counts = recordValue(overview.counts);
	const relationships = recordValue(overview.relationships);
	const inventory = recordValue(overview.inventory);
	const intent = recordValue(overview.intent);
	const fileCount = Number(counts.files ?? 0);
	const lines = [
		`# ${String(project.name ?? "project")}`,
		"",
		`${fileCount} ${fileCount === 1 ? "file" : "files"} analyzed from the current tree.`,
		"",
		"## Source Shape",
		`- Python imports: ${String(relationships.pythonImportEdges ?? 0)}`,
		`- TypeScript imports: ${String(relationships.typescriptImportEdges ?? 0)}`,
		`- Entrypoint-like files: ${String(relationships.entrypointLikeFiles ?? 0)}`,
		"",
		"## Inventory",
		`- Languages: ${formatCountItems(rowArray(inventory.languages))}`,
		`- Categories: ${formatCountItems(rowArray(inventory.categories))}`,
		`- Top roots: ${formatCountItems(rowArray(inventory.rootHotspots))}`,
		"",
		"## Likely Entries",
	];
	for (const entry of rowArray(architecture.likelyEntries).slice(0, 5)) {
		lines.push(`- ${String(entry.title)}: ${String(entry.description)}`);
	}
	const intentLines = intentSummaryLines(intent);
	if (intentLines.length > 0) {
		lines.push("");
		lines.push("## Intent Clues");
		lines.push(...intentLines);
	}
	const hotspotLines = [];
	for (const item of rowArray(overview.topLongFunctions).slice(0, 5)) {
		hotspotLines.push(
			`- long: ${String(item.identifier)} (${String(item.count)} lines)`,
		);
	}
	for (const item of rowArray(overview.topLowUseInternalFunctions).slice(
		0,
		5,
	)) {
		hotspotLines.push(
			`- low-use internal: ${String(item.identifier)} (${String(item.count)} refs)`,
		);
	}
	for (const item of rowArray(overview.topLowUseInternalVariables).slice(
		0,
		5,
	)) {
		hotspotLines.push(
			`- low-use private variable: ${String(item.identifier)} (${String(item.count)} refs)`,
		);
	}
	for (const item of rowArray(overview.topNoisyVariables).slice(0, 5)) {
		hotspotLines.push(
			`- high-use variable name: ${String(item.name)} (${String(item.count)} refs)`,
		);
	}
	if (hotspotLines.length > 0) {
		lines.push("");
		lines.push("## Hotspots");
		lines.push(...hotspotLines);
	}
	const refresh = recordValue(update.refresh);
	if (Object.keys(refresh).length > 0) {
		const plan = recordValue(recordValue(update.refreshPlan).summary);
		lines.push("");
		lines.push("## Artifact Update");
		lines.push(`- structural: ${arrayValue(refresh.structural).length}`);
		lines.push(`- cosmetic: ${arrayValue(refresh.cosmetic).length}`);
		lines.push(`- reanalyzed: ${String(plan.reanalyzed ?? 0)}`);
	}
	return `${lines.join("\n")}\n`;
}

/** Formats count rows for markdown output. */
export function formatCountItems(items: Row[]): string {
	if (items.length === 0) {
		return "none";
	}
	return items
		.slice(0, 6)
		.map((item) => `${String(item.name)}: ${String(item.count)}`)
		.join(", ");
}

/** Formats README intent clues for markdown summaries. */
export function intentSummaryLines(intent: Row): string[] {
	const lines = [];
	const readmePreview = intent.readmePreview;
	if (readmePreview) {
		lines.push(`- README: ${String(readmePreview)}`);
	}
	const previews = rowArray(intent.filePreviews).sort((left, right) =>
		compareText(String(left.file ?? ""), String(right.file ?? "")),
	);
	for (const item of previews.slice(0, 5)) {
		lines.push(`- ${String(item.file)}: ${String(item.preview)}`);
	}
	return lines;
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Reads an array field from untrusted JSON-like data. */
function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Reads table rows from unknown section data. */
function rowArray(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

/** Sorts text values with stable lexical ordering. */
function compareText(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}
