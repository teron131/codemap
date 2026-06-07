/** Defines persisted artifact fingerprint and refresh summary shapes. */
export const FINGERPRINT_STRUCTURE_KEYS = [
	"functions",
	"classes",
	"exports",
	"definitions",
	"services",
	"endpoints",
	"steps",
	"resources",
] as const;

export type FileFingerprint = {
	filePath?: string;
	contentHash?: string;
	imports?: string[];
	structureHash?: string;
	functions?: Array<Record<string, unknown>>;
	classes?: Array<Record<string, unknown>>;
	exports?: string[];
	definitions?: Array<Record<string, unknown>>;
	services?: Array<Record<string, unknown>>;
	endpoints?: Array<Record<string, unknown>>;
	steps?: Array<Record<string, unknown>>;
	resources?: Array<Record<string, unknown>>;
};

export type ArtifactFingerprints = {
	version: string | number;
	generatedAt: string;
	gitCommitHash: string | null;
	files: Record<string, FileFingerprint>;
};

export type ArtifactRefreshSummary = {
	added: string[];
	deleted: string[];
	structural: string[];
	cosmetic: string[];
	plan: Record<string, unknown>;
};
