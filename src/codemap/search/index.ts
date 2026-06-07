/** Re-exports source, structural, graph, semantic, and target-card search APIs. */
export { graphMatches, renderGraphMatchLines } from "./graph.js";
export {
	appendMatch,
	astGrepMatch,
	astGrepSymbolMatches,
	IDENTIFIER_RE,
	ripgrepMatch,
	ripgrepMatches,
	type SourceMatch,
	SYMBOL_KINDS_BY_LANGUAGE,
	sourceMatches,
	streamedJsonMatches,
	symbolMatchConfig,
} from "./source.js";
export {
	callMatches,
	resolveTargetPaths,
	searchRuleMatches,
	structuralMatches,
} from "./structural.js";
export {
	AUTO_TARGET_CARD_FILE_LIMIT,
	inferredPathTarget,
	inferredSearchTarget,
	searchTargetCard,
} from "./target-cards.js";
