/** Re-exports saved-artifact creation, update, and persistence APIs. */
export { type ArtifactCreateResult, createArtifacts } from "./create.js";
export {
	buildFileFingerprint,
	buildFingerprints,
} from "./fingerprints.js";
export {
	type ArtifactChanges,
	artifactChanges,
	buildRefreshPlan,
	currentContentHashes,
} from "./patch.js";
export type {
	ArtifactFingerprints,
	ArtifactRefreshSummary,
	FileFingerprint,
} from "./schema.js";
export {
	type ArtifactUpdateResult,
	analyzeArtifactChanges,
	applyArtifactUpdate,
	changedCandidatePaths,
	loadUpdateState,
	refreshMessage,
	updateArtifacts,
	writeArtifactUpdate,
} from "./update.js";
export { normalizeCanonicalGraph, writeArtifacts } from "./write.js";
