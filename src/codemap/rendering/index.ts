/** Re-exports artifact rendering helpers and view builders. */
export {
	buildIntentView,
	buildInventoryView,
	readmeFirstLine,
	readmeIntentLine,
	relationshipCountsFromGraph,
	topCountItems,
} from "./architecture.js";
export {
	buildLayers,
	buildViews,
	FILE_NODE_TYPES,
	STRUCTURE_HASH_DESCRIPTION,
	topGroup,
} from "./build.js";
export {
	htmlList,
	htmlTable,
	metricGridHtml,
	REPORT_STYLE,
	refreshPanelItems,
	relationshipsAndUpdateHtml,
	renderHtmlReport,
	splitTableSectionHtml,
	tableSectionHtml,
} from "./html-report.js";
export {
	buildLikelyEntries,
	buildPathRankedLikelyEntries,
} from "./likely-entries.js";
export {
	formatCountItems,
	intentSummaryLines,
	renderAgentBrief,
	renderHotspotsText,
	renderSummaryText,
} from "./markdown.js";
export {
	buildOverviewView,
	compactRefreshPlan,
	samplePaths,
} from "./overview.js";
