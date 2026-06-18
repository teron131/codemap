/** Renders saved artifact summaries as HTML report sections. */
type Row = Record<string, unknown>;

export const REPORT_STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f7f4ed;
  --fg: #1f2933;
  --muted: #687076;
  --line: #d7d0c3;
  --panel: #fffdf7;
  --accent: #245f73;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101418;
    --fg: #e6edf2;
    --muted: #9aa7b2;
    --line: #2d3840;
    --panel: #151b20;
    --accent: #7ab7c7;
  }
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
main {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 20px 56px;
}
h1, h2 {
  margin: 0;
  line-height: 1.15;
}
h1 {
  font-size: 32px;
}
h2 {
  font-size: 18px;
  margin-bottom: 12px;
}
.muted {
  color: var(--muted);
}
.grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}
.metric {
  font-size: 28px;
  font-weight: 700;
}
.metric-label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
}
section {
  margin-top: 22px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  border-bottom: 1px solid var(--line);
  padding: 8px 6px;
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
}
ul {
  margin: 0;
  padding-left: 18px;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
@media (max-width: 760px) {
  .split {
    grid-template-columns: 1fr;
  }
}
`;

/** Renders an HTML unordered list. */
export function htmlList(items: string[]): string {
	const body = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
	return `<ul>${body}</ul>`;
}

/** Renders an HTML table from row records. */
export function htmlTable(headers: string[], rows: unknown[][]): string {
	const head = headers
		.map((header) => `<th>${escapeHtml(header)}</th>`)
		.join("");
	const renderedRows = rows.map((row) => {
		const cells = row
			.map((cell) => `<td>${escapeHtml(String(cell))}</td>`)
			.join("");
		return `<tr>${cells}</tr>`;
	});
	const body = renderedRows.join("\n");
	return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Builds HTML panel rows for artifact refresh status. */
export function refreshPanelItems(update: Row): string[] {
	const refresh = recordValue(update.refresh);
	const refreshKeys = ["added", "deleted", "structural", "cosmetic"];
	const refreshItems =
		Object.keys(refresh).length > 0
			? refreshKeys.map((key) => `${key}: ${arrayValue(refresh[key]).length}`)
			: ["no artifact update changes recorded"];
	const planSummary = recordValue(recordValue(update.refreshPlan).summary);
	if (Object.keys(planSummary).length > 0) {
		refreshItems.push(
			`import dependents: ${String(planSummary.importDependents ?? 0)}`,
			`import dependencies: ${String(planSummary.importDependencies ?? 0)}`,
			`reanalyzed: ${String(planSummary.reanalyzed ?? 0)}`,
		);
	}
	return refreshItems;
}

/** Renders graph metric cards for the HTML report. */
export function metricGridHtml(counts: Row): string {
	return `
  <section class="grid">
    <div class="panel"><div class="metric">${String(counts.files ?? 0)}</div><div class="metric-label">Files</div></div>
    <div class="panel"><div class="metric">${String(counts.nodes ?? 0)}</div><div class="metric-label">Nodes</div></div>
    <div class="panel"><div class="metric">${String(counts.edges ?? 0)}</div><div class="metric-label">Edges</div></div>
    <div class="panel"><div class="metric">${String(counts.layers ?? 0)}</div><div class="metric-label">Layers</div></div>
  </section>`;
}

/** Renders graph relationship counts and refresh update details. */
export function relationshipsAndUpdateHtml(
	relationships: Row,
	update: Row,
): string {
	const relationshipItems = [
		`Python import edges: ${String(relationships.pythonImportEdges ?? 0)}`,
		`TypeScript import edges: ${String(relationships.typescriptImportEdges ?? 0)}`,
		`Entrypoint-like files: ${String(relationships.entrypointLikeFiles ?? 0)}`,
	];
	return `
  <section class="split">
    <div class="panel">
      <h2>Relationships</h2>
      ${htmlList(relationshipItems)}
    </div>
    <div class="panel">
      <h2>Artifact Update</h2>
      ${htmlList(refreshPanelItems(update))}
    </div>
  </section>`;
}

/** Renders likely entrypoints and intent clues for navigation. */
export function navigationEvidenceHtml(overview: Row): string {
	const likelyEntries = rowArray(overview.likelyEntries);
	const intent = recordValue(overview.intent);
	const entryRows = likelyEntries.map((entry) => [
		entry.title,
		entry.role ?? "",
		entry.reason ?? "",
		entry.description,
	]);
	const intentItems = intentHtmlItems(intent);
	return `
  <section class="split">
    <div class="panel">
      <h2>Likely Entries</h2>
      ${htmlTable(["Path", "Role", "Why", "Evidence"], entryRows)}
    </div>
    <div class="panel">
      <h2>Intent Clues</h2>
      ${htmlList(intentItems)}
    </div>
  </section>`;
}

/** Renders one titled HTML table section. */
export function tableSectionHtml(
	title: string,
	headers: string[],
	rows: unknown[][],
): string {
	return `
  <section class="panel">
    <h2>${escapeHtml(title)}</h2>
    ${htmlTable(headers, rows)}
  </section>`;
}

/** Renders paired table sections in HTML. */
export function splitTableSectionHtml(
	leftTitle: string,
	leftHeaders: string[],
	leftRows: unknown[][],
	rightTitle: string,
	rightHeaders: string[],
	rightRows: unknown[][],
): string {
	return `
  <section class="split">
    <div class="panel">
      <h2>${escapeHtml(leftTitle)}</h2>
      ${htmlTable(leftHeaders, leftRows)}
    </div>
    <div class="panel">
      <h2>${escapeHtml(rightTitle)}</h2>
      ${htmlTable(rightHeaders, rightRows)}
    </div>
  </section>`;
}

/** Renders the complete saved artifact HTML report. */
export function renderHtmlReport(overview: Row, update: Row): string {
	const project = recordValue(overview.project);
	const counts = recordValue(overview.counts);
	const relationships = recordValue(overview.relationships);
	const topLayers = rowArray(overview.topLayers);
	const longFunctions = rowArray(overview.topLongFunctions);
	const lowUsage = rowArray(overview.topLowUseInternalFunctions);
	const lowUsageVariables = rowArray(overview.topLowUseInternalVariables);
	const noisyVariables = rowArray(overview.topNoisyVariables);
	const layerRows = topLayers.map((item) => [item.name, item.files]);
	const longRows = longFunctions.map((item) => [item.identifier, item.count]);
	const lowUsageRows = lowUsage.map((item) => [item.identifier, item.count]);
	const lowUsageVariableRows = lowUsageVariables.map((item) => [
		item.identifier,
		item.count,
	]);
	const variableRows = noisyVariables.map((item) => [item.name, item.count]);
	const longAndLowUsageHtml = splitTableSectionHtml(
		"Long Functions",
		["Function", "Lines"],
		longRows,
		"Low-Use Internal Functions",
		["Function", "References"],
		lowUsageRows,
	);
	const projectName = String(project.name ?? "Context Graph");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(projectName)}</title>
<style>
${REPORT_STYLE}
</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(projectName)}</h1>
    <p class="muted">Canonical data lives in <code>canonical/</code>; this report is an artifact view.</p>
  </header>

${metricGridHtml(counts)}
${relationshipsAndUpdateHtml(relationships, update)}
${navigationEvidenceHtml(overview)}
${tableSectionHtml("Layers", ["Layer", "Files"], layerRows)}
${longAndLowUsageHtml}
${tableSectionHtml("Low-Use Internal Variables", ["Variable", "References"], lowUsageVariableRows)}
${tableSectionHtml("High-Use Variable Names", ["Variable", "References"], variableRows)}
</main>
</body>
</html>
`;
}

/** Escapes text for safe HTML report rendering. */
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const replacements: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#x27;",
		};
		return replacements[character] ?? character;
	});
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

/** Formats README and focused file previews for HTML intent clues. */
function intentHtmlItems(intent: Row): string[] {
	const items = [];
	if (intent.readmePreview) {
		items.push(`README: ${String(intent.readmePreview)}`);
	}
	for (const preview of rowArray(intent.filePreviews)) {
		if (!isUsefulIntentPreview(preview.preview)) {
			continue;
		}
		items.push(`${String(preview.file)}: ${String(preview.preview)}`);
		if (items.length >= 6) {
			break;
		}
	}
	return items.length > 0 ? items : ["no intent clues found"];
}

/** Checks whether a preview carries real intent evidence. */
function isUsefulIntentPreview(preview: unknown): boolean {
	return Boolean(preview) && preview !== "none";
}

/** Reads table rows from unknown section data. */
function rowArray(value: unknown): Row[] {
	return Array.isArray(value) ? (value as Row[]) : [];
}
