/** Re-exports signal analysis builders, payloads, and renderers. */
export {
	countIdentifierOccurrences,
	fileProfileRow,
	functionLengthSection,
	functionUsageRows,
	IDENTIFIER_RE,
	isAllCapsName,
	isDunderName,
	isLowUsageRefactorCandidate,
	isLowUsageVariableRefactorCandidate,
	isPascalCaseName,
	LOW_USAGE_MAX_MENTIONS,
	topHubs,
	topInheritanceHubs,
	usageBucket,
	usageDistribution,
	usageRows,
	variableUsageRows,
} from "./analysis.js";
export { buildSignalExport } from "./build.js";
export { runSignalsExport } from "./export.js";
export {
	buildSignalPayload,
	selectPayloadSection,
} from "./payload.js";
export {
	isGeneratedSignalPath,
	isTestPath,
	SIGNAL_OUTPUT_ROW_LIMIT,
	SIGNAL_SECTION_CHOICES,
	SIGNAL_TOP_ROW_LIMIT,
} from "./policy.js";
export { renderSignalText } from "./render.js";
export type {
	DefinitionRow,
	DenseFileRow,
	FileCountRow,
	FileProfileRow,
	FileSignalCounters,
	FunctionLengthItem,
	FunctionLengthSection,
	LanguageRows,
	NameFrequencyRow,
	SignalFocusEntry,
	SignalLanguage,
	SignalRow,
} from "./schema.js";
export { buildUsageSection, metricNames } from "./usage.js";
