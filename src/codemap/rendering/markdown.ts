/** Renders the concise current-tree summary as Markdown. */

type Row = Record<string, unknown>;

/** Renders current-tree summary markdown from graph views. */
export function renderSummaryText(architecture: Row): string {
	const project = recordValue(architecture.project);
	const stats = recordValue(architecture.stats);
	const relationships = recordValue(architecture.relationships);
	const inventory = recordValue(architecture.inventory);
	const intent = recordValue(architecture.intent);
	const fileCount = Number(stats.files ?? 0);
	const lines = [
		`# ${String(project.name ?? "project")}`,
		"",
		`${fileCount} ${fileCount === 1 ? "file" : "files"} analyzed from the current tree.`,
		"",
		"## Source Shape",
		`- Python imports: ${relationshipCount(relationships, "pythonImportEdges")}`,
		`- TypeScript imports: ${relationshipCount(relationships, "typescriptImportEdges")}`,
		`- Entrypoint-like files: ${String(relationships.entrypointLikeFiles ?? 0)}`,
	];
	appendRelationshipFallback(lines, relationships);
	lines.push(
		"",
		"## Inventory",
		`- Languages: ${formatCountItems(rowArray(inventory.languages))}`,
		`- Categories: ${formatCountItems(rowArray(inventory.categories))}`,
		`- Top roots: ${formatCountItems(rowArray(inventory.rootHotspots))}`,
		"",
		"## Likely Entries",
	);
	for (const entry of rowArray(architecture.likelyEntries).slice(0, 5)) {
		const roleBits = [entry.role, entry.reason]
			.filter(Boolean)
			.map((value) => String(value));
		const role = roleBits.length > 0 ? ` (${roleBits.join("; ")})` : "";
		lines.push(`- ${String(entry.title)}${role}: ${String(entry.description)}`);
	}
	const intentLines = intentSummaryLines(intent);
	if (intentLines.length > 0) {
		lines.push("");
		lines.push("## Intent Clues");
		lines.push(...intentLines);
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
	for (const item of previews
		.filter((preview) => isUsefulIntentPreview(preview.preview))
		.slice(0, 5)) {
		lines.push(`- ${String(item.file)}: ${String(item.preview)}`);
	}
	return lines;
}

/** Checks whether a preview carries real intent evidence. */
function isUsefulIntentPreview(preview: unknown): boolean {
	return Boolean(preview) && preview !== "none";
}

/** Reads a record field from untrusted JSON-like data. */
function recordValue(value: unknown): Row {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Row)
		: {};
}

/** Reads table rows from unknown section data. */
function rowArray(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}

/** Formats relationship counts that are unavailable in lightweight fallback mode. */
function relationshipCount(relationships: Row, key: string): string {
	if (relationships.importCountsUnavailable === true) {
		return "unknown (fallback)";
	}
	return String(relationships[key] ?? 0);
}

/** Appends a concise fallback note when relationship graph counts were skipped. */
function appendRelationshipFallback(lines: string[], relationships: Row): void {
	if (relationships.importCountsUnavailable !== true) {
		return;
	}
	const note = String(
		relationships.importCountsNote || "relationship graph skipped",
	);
	lines.push(`- Fallback: ${note}`);
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
